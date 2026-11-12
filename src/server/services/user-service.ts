import { DEFAULT_NOTIFICATION_PREFERENCES, type Role } from "@/shared/domain";
import type { CreateGuardInput, CreateResidentInput, UpdateGuardInput, UpdateProfileInput, UpdateResidentInput } from "@/shared/schemas";
import type { Apartment, CreatedAccount, MeResponse, Page, UserProfile } from "@/shared/types";
import { type Actor, requireRole } from "../auth/actor";
import type { TxOp } from "../db/table";
import { badRequest, conflict, isConditionFailed, notFound } from "../errors";
import { newId } from "../lib/ids";
import type { Deps } from "../ports";
import { CommunityRepo, PropertyRepo } from "../repositories/community-repo";
import { type StoredUser, UserRepo } from "../repositories/user-repo";
import type { AuditService } from "./audit-service";
import type { NotificationService } from "./notification-service";

export const apartmentLabel = (a: Apartment) => `${a.buildingName} · ${a.unitNumber}`;

export function publicUser(u: StoredUser): UserProfile {
  const { cognitoSub: _sub, ...rest } = u;
  void _sub;
  return rest;
}

export class UserService {
  readonly users: UserRepo;
  private readonly property: PropertyRepo;
  private readonly communities: CommunityRepo;

  constructor(
    private readonly deps: Deps,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {
    this.users = new UserRepo(deps.table);
    this.property = new PropertyRepo(deps.table);
    this.communities = new CommunityRepo(deps.table);
  }

  // ───────────────────────────── Self ─────────────────────────────

  async me(user: StoredUser): Promise<MeResponse> {
    const community = await this.communities.get(user.communityId);
    if (!community) throw notFound("Community");
    return {
      profile: publicUser(user),
      community: { communityId: community.communityId, name: community.name, timezone: community.timezone },
      unreadNotifications: user.status === "ACTIVE" ? await this.notifications.unreadCount(user.communityId, user.userId) : 0,
    };
  }

  /** Users may edit contact details and preferences — never role, tenant, e-mail or apartment. */
  async updateMe(actor: Actor, input: UpdateProfileInput): Promise<UserProfile> {
    const user = await this.users.get(actor.communityId, actor.userId);
    if (!user) throw notFound("User");
    const next: StoredUser = {
      ...user,
      fullName: input.fullName ?? user.fullName,
      phone: input.phone ?? user.phone,
      emergencyContact: input.emergencyContact === undefined ? user.emergencyContact : input.emergencyContact,
      notificationPrefs: input.notificationPrefs ?? user.notificationPrefs,
      updatedAt: this.deps.clock().toISOString(),
    };
    await this.users.save(next);
    if (input.notificationPrefs?.email && !user.notificationPrefs.email) {
      try {
        await this.deps.notifier.subscribeEmail(user.userId, user.email);
      } catch (err) {
        this.deps.logger.warn("notification.subscribe_failed", { userId: user.userId, error: (err as Error).name });
      }
    }
    await this.audit.record(actor, "PROFILE_UPDATED", "User", actor.userId, { fields: Object.keys(input).join(",") });
    return publicUser(next);
  }

  // ────────────────────── Admin: accounts ──────────────────────

  async list(actor: Actor, role: Role | "PENDING", opts: { status?: string; q?: string; limit: number; cursor?: string }): Promise<Page<UserProfile>> {
    requireRole(actor, "ADMIN");
    return this.users.listByRole(actor.communityId, role, opts);
  }

  private async getManaged(actor: Actor, userId: string, role: Role | null): Promise<StoredUser> {
    requireRole(actor, "ADMIN");
    const user = await this.users.get(actor.communityId, userId);
    if (!user || user.role !== role) throw notFound(role === "SECURITY" ? "Guard" : "Resident");
    return user;
  }

  private async apartmentInCommunity(actor: Actor, apartmentId: string): Promise<Apartment> {
    const apt = await this.property.getApartment(actor.communityId, apartmentId);
    if (!apt) throw badRequest("That apartment does not exist in your community.", { apartmentId: ["Unknown apartment"] });
    return apt;
  }

  private async createAccount(
    actor: Actor,
    input: { fullName: string; email: string; phone: string },
    role: Exclude<Role, "ADMIN">,
    extra: { apartment?: Apartment; shift?: StoredUser["shift"] },
  ): Promise<CreatedAccount> {
    requireRole(actor, "ADMIN");
    if (await this.users.emailClaim(input.email)) throw conflict("An account with this e-mail already exists.", "EMAIL_TAKEN");
    const { sub, temporaryPassword } = await this.deps.identity.createUser({ email: input.email, fullName: input.fullName, role });
    const now = this.deps.clock().toISOString();
    const user: StoredUser = {
      userId: newId("usr"),
      communityId: actor.communityId,
      cognitoSub: sub,
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      role,
      status: "ACTIVE",
      apartmentId: extra.apartment?.apartmentId ?? null,
      apartmentLabel: extra.apartment ? apartmentLabel(extra.apartment) : null,
      shift: extra.shift ?? null,
      emergencyContact: null,
      notificationPrefs: DEFAULT_NOTIFICATION_PREFERENCES,
      requestedUnit: null,
      createdAt: now,
      updatedAt: now,
    };
    const ops: TxOp[] = [...this.users.createOps(user)];
    if (extra.apartment) ops.push(this.property.linkResidentOp(actor.communityId, extra.apartment.apartmentId, user.userId));
    try {
      await this.deps.table.transact(ops);
    } catch (err) {
      if (isConditionFailed(err)) throw conflict("An account with this e-mail already exists.", "EMAIL_TAKEN");
      throw err;
    }
    await this.audit.record(actor, role === "RESIDENT" ? "RESIDENT_CREATED" : "GUARD_CREATED", "User", user.userId, { role });
    return { user: publicUser(user), temporaryPassword };
  }

  async createResident(actor: Actor, input: CreateResidentInput) {
    const apartment = await this.apartmentInCommunity(actor, input.apartmentId);
    return this.createAccount(actor, input, "RESIDENT", { apartment });
  }

  async createGuard(actor: Actor, input: CreateGuardInput) {
    return this.createAccount(actor, input, "SECURITY", { shift: input.shift });
  }

  async updateResident(actor: Actor, userId: string, input: UpdateResidentInput): Promise<UserProfile> {
    const user = await this.getManaged(actor, userId, "RESIDENT");
    const ops: TxOp[] = [];
    const next: StoredUser = { ...user, updatedAt: this.deps.clock().toISOString() };
    if (input.fullName) next.fullName = input.fullName;
    if (input.phone) next.phone = input.phone;
    if (input.apartmentId && input.apartmentId !== user.apartmentId) {
      const apt = await this.apartmentInCommunity(actor, input.apartmentId);
      if (user.apartmentId) ops.push(this.property.unlinkResidentOp(actor.communityId, user.apartmentId, user.userId));
      ops.push(this.property.linkResidentOp(actor.communityId, apt.apartmentId, user.userId));
      next.apartmentId = apt.apartmentId;
      next.apartmentLabel = apartmentLabel(apt);
    }
    if (input.status && input.status !== user.status) {
      await this.deps.identity.setEnabled(user.cognitoSub, user.email, input.status === "ACTIVE");
      next.status = input.status;
    }
    await this.deps.table.transact([this.users.updateOp(next), ...ops]);
    await this.audit.record(actor, "RESIDENT_UPDATED", "User", userId, { fields: Object.keys(input).join(",") });
    return publicUser(next);
  }

  /** DELETE is a soft deactivation: history must stay attributable. */
  async deactivateResident(actor: Actor, userId: string) {
    return this.updateResident(actor, userId, { status: "DEACTIVATED" });
  }

  async updateGuard(actor: Actor, userId: string, input: UpdateGuardInput): Promise<UserProfile> {
    const user = await this.getManaged(actor, userId, "SECURITY");
    const next: StoredUser = {
      ...user,
      fullName: input.fullName ?? user.fullName,
      phone: input.phone ?? user.phone,
      shift: input.shift ?? user.shift,
      updatedAt: this.deps.clock().toISOString(),
    };
    if (input.status && input.status !== user.status) {
      await this.deps.identity.setEnabled(user.cognitoSub, user.email, input.status === "ACTIVE");
      next.status = input.status;
    }
    await this.users.save(next);
    await this.audit.record(actor, "GUARD_UPDATED", "User", userId, { fields: Object.keys(input).join(",") });
    return publicUser(next);
  }

  // ─────────────────── Self-registration review ───────────────────

  /**
   * Creates a PENDING account for a verified self-registration. Called by the
   * demo auth gateway or by the Cognito post-confirmation trigger. The user has
   * no role (and therefore no access) until an administrator approves them.
   */
  async registerPending(input: { sub: string; email: string; fullName: string; phone: string; joinCode: string; unitNumber: string }) {
    const community = await this.communities.getByJoinCode(input.joinCode.toUpperCase());
    if (!community) throw badRequest("Unknown community code.", { joinCode: ["Unknown community code"] });
    const now = this.deps.clock().toISOString();
    const user: StoredUser = {
      userId: newId("usr"),
      communityId: community.communityId,
      cognitoSub: input.sub,
      fullName: input.fullName,
      email: input.email.toLowerCase(),
      phone: input.phone,
      role: null,
      status: "PENDING",
      apartmentId: null,
      apartmentLabel: null,
      shift: null,
      emergencyContact: null,
      notificationPrefs: DEFAULT_NOTIFICATION_PREFERENCES,
      requestedUnit: input.unitNumber.toUpperCase(),
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.deps.table.transact(this.users.createOps(user));
    } catch (err) {
      if (isConditionFailed(err)) throw conflict("An account with this e-mail already exists.", "EMAIL_TAKEN");
      throw err;
    }
    const admins = await this.users.listByRole(community.communityId, "ADMIN", { status: "ACTIVE", limit: 50 });
    await this.notifications.notify(
      community.communityId,
      admins.items.map((a) => a.userId),
      {
        type: "ACCOUNT",
        title: "New resident registration",
        message: `${user.fullName} registered for unit ${user.requestedUnit} and is awaiting approval.`,
        link: "/admin/residents?tab=pending",
        dedupeKey: `registration:${user.userId}`,
      },
    );
    return publicUser(user);
  }

  async approveRegistration(actor: Actor, userId: string, apartmentId: string): Promise<UserProfile> {
    const user = await this.getManaged(actor, userId, null);
    if (user.status !== "PENDING") throw conflict("This registration has already been reviewed.");
    const apt = await this.apartmentInCommunity(actor, apartmentId);
    await this.deps.identity.setRole(user.cognitoSub, user.email, "RESIDENT", null);
    const next: StoredUser = {
      ...user,
      role: "RESIDENT",
      status: "ACTIVE",
      apartmentId: apt.apartmentId,
      apartmentLabel: apartmentLabel(apt),
      updatedAt: this.deps.clock().toISOString(),
    };
    await this.deps.table.transact([this.users.updateOp(next), this.property.linkResidentOp(actor.communityId, apt.apartmentId, user.userId)]);
    await this.audit.record(actor, "REGISTRATION_APPROVED", "User", userId, { apartmentId });
    await this.notifications.notify(actor.communityId, [userId], {
      type: "ACCOUNT",
      title: "Welcome to GateKeeper",
      message: `Your account has been approved for ${next.apartmentLabel}.`,
      dedupeKey: `approved-account:${userId}`,
    });
    return publicUser(next);
  }

  async rejectRegistration(actor: Actor, userId: string): Promise<UserProfile> {
    const user = await this.getManaged(actor, userId, null);
    if (user.status !== "PENDING") throw conflict("This registration has already been reviewed.");
    await this.deps.identity.setEnabled(user.cognitoSub, user.email, false);
    const next: StoredUser = { ...user, status: "DEACTIVATED", updatedAt: this.deps.clock().toISOString() };
    await this.users.save(next);
    await this.audit.record(actor, "REGISTRATION_REJECTED", "User", userId);
    return publicUser(next);
  }
}
