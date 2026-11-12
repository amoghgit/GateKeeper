import type { AnnouncementInput, ApartmentInput, BuildingInput, CommunitySettingsInput } from "@/shared/schemas";
import type { Announcement, Apartment, Building, Community, Page } from "@/shared/types";
import { type Actor, requireRole } from "../auth/actor";
import { badRequest, conflict, isConditionFailed, notFound } from "../errors";
import { newId } from "../lib/ids";
import type { Deps } from "../ports";
import { AnnouncementRepo } from "../repositories/activity-repo";
import { CommunityRepo, PropertyRepo } from "../repositories/community-repo";
import { UserRepo } from "../repositories/user-repo";
import type { AuditService } from "./audit-service";
import type { NotificationService } from "./notification-service";

export class PropertyService {
  private readonly communities: CommunityRepo;
  private readonly property: PropertyRepo;

  constructor(
    private readonly deps: Deps,
    private readonly audit: AuditService,
  ) {
    this.communities = new CommunityRepo(deps.table);
    this.property = new PropertyRepo(deps.table);
  }

  async community(actor: Actor): Promise<Community> {
    const c = await this.communities.get(actor.communityId);
    if (!c) throw notFound("Community");
    return c;
  }

  async updateCommunity(actor: Actor, input: CommunitySettingsInput): Promise<Community> {
    requireRole(actor, "ADMIN");
    const current = await this.community(actor);
    const updated = await this.communities.update(actor.communityId, {
      ...(input.name ? { name: input.name } : {}),
      ...(input.address ? { address: input.address } : {}),
      ...(input.contactEmail ? { contactEmail: input.contactEmail } : {}),
      ...(input.contactPhone ? { contactPhone: input.contactPhone } : {}),
      ...(input.settings ? { settings: { ...current.settings, ...input.settings } } : {}),
    });
    await this.audit.record(actor, "COMMUNITY_UPDATED", "Community", actor.communityId, { fields: Object.keys(input).join(",") });
    return updated;
  }

  listBuildings(actor: Actor) {
    return this.property.listBuildings(actor.communityId);
  }

  async saveBuilding(actor: Actor, input: BuildingInput, buildingId?: string): Promise<Building> {
    requireRole(actor, "ADMIN");
    const existing = buildingId ? await this.property.getBuilding(actor.communityId, buildingId) : null;
    if (buildingId && !existing) throw notFound("Building");
    const building: Building = {
      buildingId: existing?.buildingId ?? newId("bld"),
      communityId: actor.communityId,
      name: input.name,
      floors: input.floors,
      blocks: [...new Set(input.blocks.map((b) => b.trim()).filter(Boolean))],
      createdAt: existing?.createdAt ?? this.deps.clock().toISOString(),
    };
    await this.property.putBuilding(building, !existing);
    await this.audit.record(actor, existing ? "BUILDING_UPDATED" : "BUILDING_CREATED", "Building", building.buildingId, { name: building.name });
    return building;
  }

  async deleteBuilding(actor: Actor, buildingId: string) {
    requireRole(actor, "ADMIN");
    const b = await this.property.getBuilding(actor.communityId, buildingId);
    if (!b) throw notFound("Building");
    if ((await this.property.countApartments(actor.communityId, buildingId)) > 0) {
      throw conflict("Remove this building's apartments before deleting it.", "HAS_APARTMENTS");
    }
    await this.property.deleteBuilding(actor.communityId, buildingId);
    await this.audit.record(actor, "BUILDING_DELETED", "Building", buildingId, { name: b.name });
  }

  listApartments(actor: Actor, buildingId?: string) {
    return this.property.listApartments(actor.communityId, buildingId);
  }

  async createApartment(actor: Actor, input: ApartmentInput): Promise<Apartment> {
    requireRole(actor, "ADMIN");
    const building = await this.property.getBuilding(actor.communityId, input.buildingId);
    if (!building) throw badRequest("Choose a valid building.", { buildingId: ["Unknown building"] });
    if (input.floor > building.floors) throw badRequest(`${building.name} has ${building.floors} floors.`, { floor: ["Floor exceeds building height"] });
    if (input.block && !building.blocks.includes(input.block)) throw badRequest("Unknown block for this building.", { block: ["Unknown block"] });
    const apartment: Apartment = {
      apartmentId: newId("apt"),
      communityId: actor.communityId,
      buildingId: building.buildingId,
      buildingName: building.name,
      block: input.block ?? null,
      floor: input.floor,
      unitNumber: input.unitNumber,
      createdAt: this.deps.clock().toISOString(),
    };
    try {
      await this.property.createApartment(apartment);
    } catch (err) {
      if (isConditionFailed(err)) throw conflict(`Unit ${input.unitNumber} already exists in ${building.name}.`, "UNIT_EXISTS");
      throw err;
    }
    await this.audit.record(actor, "APARTMENT_CREATED", "Apartment", apartment.apartmentId, { unit: apartment.unitNumber });
    return apartment;
  }

  async deleteApartment(actor: Actor, apartmentId: string) {
    requireRole(actor, "ADMIN");
    const apt = await this.property.getApartment(actor.communityId, apartmentId);
    if (!apt) throw notFound("Apartment");
    if ((await this.property.residentIds(actor.communityId, apartmentId)).length > 0) {
      throw conflict("Reassign or deactivate this apartment's residents first.", "HAS_RESIDENTS");
    }
    await this.property.deleteApartment(apt);
    await this.audit.record(actor, "APARTMENT_DELETED", "Apartment", apartmentId, { unit: apt.unitNumber });
  }
}

export class AnnouncementService {
  private readonly repo: AnnouncementRepo;
  private readonly users: UserRepo;

  constructor(
    private readonly deps: Deps,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {
    this.repo = new AnnouncementRepo(deps.table);
    this.users = new UserRepo(deps.table);
  }

  list(actor: Actor, opts: { limit: number; cursor?: string }): Promise<Page<Announcement>> {
    return this.repo.list(actor.communityId, opts);
  }

  async publish(actor: Actor, input: AnnouncementInput): Promise<Announcement> {
    requireRole(actor, "ADMIN");
    const now = this.deps.clock();
    const a: Announcement = {
      announcementId: newId("ann", now.getTime()),
      communityId: actor.communityId,
      title: input.title,
      content: input.content,
      priority: input.priority,
      createdBy: actor.userId,
      createdByName: actor.fullName,
      createdAt: now.toISOString(),
    };
    await this.repo.put(a);
    await this.audit.record(actor, "ANNOUNCEMENT_PUBLISHED", "Announcement", a.announcementId, { priority: a.priority });
    // Fan-out to residents and guards. Suitable for community-sized audiences; see ARCHITECTURE.md.
    const recipients: string[] = [];
    for (const role of ["RESIDENT", "SECURITY"] as const) {
      let cursor: string | undefined;
      do {
        const page = await this.users.listByRole(actor.communityId, role, { status: "ACTIVE", limit: 100, cursor });
        recipients.push(...page.items.map((u) => u.userId));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    }
    await this.notifications.notify(actor.communityId, recipients, {
      type: "ANNOUNCEMENT",
      title: a.priority === "IMPORTANT" ? `Important: ${a.title}` : a.title,
      message: a.content.length > 180 ? `${a.content.slice(0, 177)}…` : a.content,
      link: "/resident/notifications",
      dedupeKey: `announcement:${a.announcementId}`,
    });
    return a;
  }

  async remove(actor: Actor, id: string) {
    requireRole(actor, "ADMIN");
    try {
      await this.repo.delete(actor.communityId, id);
    } catch (err) {
      if (isConditionFailed(err)) throw notFound("Announcement");
      throw err;
    }
    await this.audit.record(actor, "ANNOUNCEMENT_DELETED", "Announcement", id);
  }
}
