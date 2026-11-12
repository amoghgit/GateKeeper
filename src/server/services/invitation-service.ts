import type { InvitationStatus, VisitEventType } from "@/shared/domain";
import type { CreateInvitationInput, InvitationQuery, WalkInInput } from "@/shared/schemas";
import type { Community, Invitation, InvitationDetail, IssuedPass, KnownVisitor, Page, VisitEvent } from "@/shared/types";
import { addDays, startOfLocalDay } from "@/shared/time";
import { type Actor, assertCanView, requireApartment, requireRole, type SystemActor } from "../auth/actor";
import { digits } from "../db/keys";
import type { TxOp } from "../db/table";
import { AppError, badRequest, conflict, forbidden, isConditionFailed, notFound } from "../errors";
import { decrypt, encrypt, generateQrToken, hashQrToken, sha256 } from "../lib/crypto";
import { newId, shortCode } from "../lib/ids";
import type { Deps } from "../ports";
import { EventRepo, VisitorRepo, type StoredVisitor } from "../repositories/activity-repo";
import { CommunityRepo, PropertyRepo } from "../repositories/community-repo";
import { InvitationRepo, type StoredInvitation, type TimeRange } from "../repositories/invitation-repo";
import { UserRepo } from "../repositories/user-repo";
import type { AuditService } from "./audit-service";
import type { NotificationService } from "./notification-service";
import { isActive } from "@/shared/pass-policy";

const MAX_ADVANCE_DAYS = 90;

/** Converts inclusive local "YYYY-MM-DD" bounds into an ISO range on expectedArrival. */
export function toTimeRange(from: string | undefined, to: string | undefined, timeZone: string): TimeRange {
  return {
    from: from ? startOfLocalDay(from, timeZone).toISOString() : undefined,
    to: to ? new Date(startOfLocalDay(addDays(to, 1), timeZone).getTime() - 1).toISOString() : undefined,
  };
}

export class InvitationService {
  readonly repo: InvitationRepo;
  private readonly events: EventRepo;
  private readonly visitors: VisitorRepo;
  private readonly communities: CommunityRepo;
  private readonly property: PropertyRepo;
  private readonly users: UserRepo;

  constructor(
    private readonly deps: Deps,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {
    this.repo = new InvitationRepo(deps.table);
    this.events = new EventRepo(deps.table);
    this.visitors = new VisitorRepo(deps.table);
    this.communities = new CommunityRepo(deps.table);
    this.property = new PropertyRepo(deps.table);
    this.users = new UserRepo(deps.table);
  }

  async community(communityId: string): Promise<Community> {
    const c = await this.communities.get(communityId);
    if (!c) throw notFound("Community");
    return c;
  }

  // ─────────────────────────── Creation ───────────────────────────

  async create(actor: Actor, input: CreateInvitationInput): Promise<IssuedPass> {
    const apartmentId = requireApartment(actor);
    const now = this.deps.clock();
    const arrival = new Date(input.expectedArrival);
    if (arrival.getTime() < now.getTime() - 3_600_000) throw badRequest("Expected arrival is in the past.");
    if (arrival.getTime() > now.getTime() + MAX_ADVANCE_DAYS * 86_400_000) {
      throw badRequest(`Invitations can be created at most ${MAX_ADVANCE_DAYS} days in advance.`);
    }
    return this.issue({
      actor,
      apartmentId,
      residentId: actor.userId,
      residentName: actor.fullName,
      visitor: input.visitor,
      expectedArrival: arrival,
      expectedDeparture: new Date(input.expectedDeparture),
      usagePolicy: input.usagePolicy,
      status: input.preApproved ? "APPROVED" : "PENDING_APPROVAL",
      source: "RESIDENT_INVITE",
      notes: input.notes ?? null,
    });
  }

  /** Security registers an unannounced visitor and asks the apartment to approve. */
  async registerWalkIn(actor: Actor, input: WalkInInput): Promise<Invitation> {
    requireRole(actor, "SECURITY");
    if (input.photoKey && !input.photoKey.startsWith(`uploads/${actor.communityId}/`)) throw badRequest("Invalid photo reference.");
    const apartment = await this.property.getApartment(actor.communityId, input.apartmentId);
    if (!apartment) throw notFound("Apartment");
    const residentIds = await this.property.residentIds(actor.communityId, apartment.apartmentId);
    const residents = (await this.users.getMany(actor.communityId, residentIds)).filter((u) => u.status === "ACTIVE");
    if (residents.length === 0) throw conflict("No active resident is registered for this apartment.", "NO_RESIDENT");
    const community = await this.community(actor.communityId);
    const now = this.deps.clock();
    const departure = input.expectedDeparture ? new Date(input.expectedDeparture) : new Date(now.getTime() + 4 * 3_600_000);
    if (departure.getTime() <= now.getTime()) throw badRequest("Expected departure must be in the future.");
    const primary = residents[0]!;
    const { invitation } = await this.issue({
      actor,
      apartmentId: apartment.apartmentId,
      residentId: primary.userId,
      residentName: primary.fullName,
      visitor: input.visitor,
      expectedArrival: now,
      expectedDeparture: departure,
      usagePolicy: "SINGLE_USE",
      status: community.settings.walkInsRequireApproval ? "PENDING_APPROVAL" : "APPROVED",
      source: "WALK_IN",
      notes: input.notes ?? null,
      photoKey: input.photoKey ?? null,
      eventType: "WALK_IN_REGISTERED",
    });
    await this.notifications.notify(
      actor.communityId,
      residents.map((r) => r.userId),
      invitation.status === "PENDING_APPROVAL"
        ? {
            type: "VISITOR_REQUEST",
            title: "Visitor waiting at the gate",
            message: `${invitation.visitor.fullName} (${invitation.visitor.purpose}) is at the gate and needs your approval.`,
            link: `/resident/invitations?focus=${invitation.invitationId}`,
            dedupeKey: `request:${invitation.invitationId}`,
          }
        : {
            type: "VISITOR_ARRIVAL",
            title: "Visitor at the gate",
            message: `${invitation.visitor.fullName} has arrived at the gate.`,
            link: `/resident/invitations?focus=${invitation.invitationId}`,
            dedupeKey: `arrival:${invitation.invitationId}:0`,
          },
    );
    return invitation;
  }

  private async issue(p: {
    actor: Actor;
    apartmentId: string;
    residentId: string;
    residentName: string;
    visitor: CreateInvitationInput["visitor"];
    expectedArrival: Date;
    expectedDeparture: Date;
    usagePolicy: StoredInvitation["usagePolicy"];
    status: InvitationStatus;
    source: StoredInvitation["source"];
    notes: string | null;
    photoKey?: string | null;
    eventType?: VisitEventType;
  }): Promise<IssuedPass> {
    const { actor } = p;
    if (p.expectedDeparture.getTime() <= p.expectedArrival.getTime()) throw badRequest("Departure must be after arrival.");
    const apartment = await this.property.getApartment(actor.communityId, p.apartmentId);
    if (!apartment) throw notFound("Apartment");
    const community = await this.community(actor.communityId);
    const now = this.deps.clock();
    const apartmentLabel = `${apartment.buildingName} · ${apartment.unitNumber}`;
    const visitorId = `vis_${sha256(`${actor.communityId}|${apartment.apartmentId}|${digits(p.visitor.phone)}`).slice(0, 24)}`;
    const visitor: StoredVisitor = {
      visitorId,
      communityId: actor.communityId,
      apartmentId: apartment.apartmentId,
      fullName: p.visitor.fullName,
      phone: p.visitor.phone,
      category: p.visitor.category,
      purpose: p.visitor.purpose,
      vehicleNumber: p.visitor.vehicleNumber ?? null,
      createdBy: actor.userId,
      visitCount: 0,
      lastVisitAt: p.expectedArrival.toISOString(),
      createdAt: now.toISOString(),
    };

    for (let attempt = 0; attempt < 5; attempt++) {
      const { token, payload } = generateQrToken();
      const invitationId = newId("inv", now.getTime());
      const inv: StoredInvitation = {
        invitationId,
        code: shortCode(),
        communityId: actor.communityId,
        visitorId,
        visitor: {
          fullName: p.visitor.fullName,
          phone: p.visitor.phone,
          category: p.visitor.category,
          purpose: p.visitor.purpose,
          vehicleNumber: p.visitor.vehicleNumber ?? null,
        },
        residentId: p.residentId,
        residentName: p.residentName,
        apartmentId: apartment.apartmentId,
        apartmentLabel,
        expectedArrival: p.expectedArrival.toISOString(),
        expectedDeparture: p.expectedDeparture.toISOString(),
        validFrom: new Date(p.expectedArrival.getTime() - community.settings.entryGraceMinutes * 60_000).toISOString(),
        expiry: p.expectedDeparture.toISOString(),
        status: p.status,
        usagePolicy: p.usagePolicy,
        usageCount: 0,
        source: p.source,
        notes: p.notes,
        photoKey: p.photoKey ?? null,
        createdBy: actor.userId,
        createdByName: actor.fullName,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        decidedAt: p.status === "APPROVED" ? now.toISOString() : null,
        rejectionReason: null,
        lastEntryAt: null,
        lastEntryGuardName: null,
        lastExitAt: null,
        lastExitGuardName: null,
        overdue: false,
        qrTokenHash: hashQrToken(token, this.deps.secrets.qrPepper),
        qrTokenCipher: encrypt(payload, this.deps.secrets.encryptionKey),
        version: 1,
      };
      const ops: TxOp[] = [...this.repo.createOps(inv), this.visitors.upsertOp(visitor)];
      if (p.eventType) ops.push(this.events.putOp(this.event(actor, inv, p.eventType, null)));
      try {
        await this.deps.table.transact(ops);
      } catch (err) {
        if (isConditionFailed(err)) continue; // short-code collision — retry with a new code
        throw err;
      }
      await this.audit.record(actor, p.source === "WALK_IN" ? "WALK_IN_REGISTERED" : "INVITATION_CREATED", "Invitation", invitationId, {
        status: inv.status,
        usagePolicy: inv.usagePolicy,
        category: inv.visitor.category,
      });
      return { invitation: publicInvitation(inv), qrPayload: payload };
    }
    throw new AppError(503, "CODE_EXHAUSTED", "Could not allocate a unique pass. Please try again.");
  }

  event(actor: Actor | SystemActor, inv: Invitation, type: VisitEventType, detail: string | null): VisitEvent {
    const now = this.deps.clock();
    return {
      eventId: newId("evt", now.getTime()),
      communityId: inv.communityId,
      invitationId: inv.invitationId,
      visitorName: inv.visitor.fullName,
      apartmentId: inv.apartmentId,
      apartmentLabel: inv.apartmentLabel,
      eventType: type,
      actorId: actor.userId,
      actorName: actor.fullName,
      timestamp: now.toISOString(),
      detail,
    };
  }

  // ─────────────────────────── Reads ───────────────────────────

  async load(actor: Actor, invitationId: string): Promise<StoredInvitation> {
    const inv = await this.repo.get(actor.communityId, invitationId);
    if (!inv) throw notFound("Invitation");
    assertCanView(actor, inv);
    return inv;
  }

  async detail(actor: Actor, invitationId: string): Promise<InvitationDetail> {
    const inv = await this.load(actor, invitationId);
    const timeline = await this.events.forInvitation(actor.communityId, invitationId);
    return { invitation: publicInvitation(inv), timeline };
  }

  async list(actor: Actor, q: InvitationQuery): Promise<Page<Invitation>> {
    const community = await this.community(actor.communityId);
    const range = toTimeRange(q.from, q.to, community.timezone);
    const opts = { limit: q.limit, cursor: q.cursor };
    const filters = { status: q.status, category: q.category, residentId: q.residentId, q: q.q };
    let page: Page<StoredInvitation>;
    if (actor.role === "RESIDENT") {
      page = await this.repo.listByApartment(actor.communityId, requireApartment(actor), range, filters, opts);
    } else {
      page = await this.repo.listCommunity(actor.communityId, range, filters, opts);
    }
    return { items: page.items.map((i) => publicInvitation(i)), nextCursor: page.nextCursor };
  }

  /** Re-displays the QR for the owning apartment (the token is stored encrypted, never in plaintext). */
  async pass(actor: Actor, invitationId: string): Promise<IssuedPass> {
    const inv = await this.load(actor, invitationId);
    if (actor.role !== "RESIDENT") throw forbidden("Only the inviting apartment can view this pass.");
    if (!isActive(inv)) throw conflict("This invitation is no longer active.", "INACTIVE");
    return { invitation: publicInvitation(inv), qrPayload: decrypt(inv.qrTokenCipher, this.deps.secrets.encryptionKey) };
  }

  async knownVisitors(actor: Actor): Promise<KnownVisitor[]> {
    const apartmentId = requireApartment(actor);
    const page = await this.visitors.listByApartment(actor.communityId, apartmentId, { limit: 100 });
    return page.items.map(toKnownVisitor).sort((a, b) => b.lastVisitAt.localeCompare(a.lastVisitAt));
  }

  async visitorProfile(actor: Actor, visitorId: string) {
    const v = await this.visitors.get(actor.communityId, visitorId);
    if (!v || (actor.role === "RESIDENT" && v.apartmentId !== actor.apartmentId)) throw notFound("Visitor");
    return toKnownVisitor(v);
  }

  async communityVisitors(actor: Actor, opts: { limit: number; cursor?: string }): Promise<Page<KnownVisitor>> {
    requireRole(actor, "ADMIN", "SECURITY");
    const page = await this.visitors.listCommunity(actor.communityId, opts);
    return { items: page.items.map(toKnownVisitor), nextCursor: page.nextCursor };
  }

  // ─────────────────────────── Transitions ───────────────────────────

  /**
   * Applies a state change guarded by optimistic concurrency. `extra` ops are
   * committed in the same DynamoDB transaction.
   */
  async transition(
    inv: StoredInvitation,
    allowedFrom: InvitationStatus[],
    patch: Partial<StoredInvitation>,
    eventOf: (next: StoredInvitation) => VisitEvent | null,
    conflictMessage: string,
    extra: TxOp[] = [],
  ): Promise<StoredInvitation> {
    if (!allowedFrom.includes(inv.status)) throw conflict(conflictMessage, "INVALID_STATE");
    const now = this.deps.clock().toISOString();
    const next: StoredInvitation = { ...inv, ...patch, updatedAt: now, version: inv.version + 1 };
    const event = eventOf(next);
    try {
      await this.deps.table.transact([this.repo.replaceOp(next, inv.version), ...(event ? [this.events.putOp(event)] : []), ...extra]);
    } catch (err) {
      if (isConditionFailed(err)) throw conflict("This invitation was just updated by someone else. Refresh and try again.", "STALE");
      throw err;
    }
    return next;
  }

  async approve(actor: Actor, invitationId: string): Promise<Invitation> {
    requireApartment(actor);
    const inv = await this.load(actor, invitationId);
    if (Date.parse(inv.expiry) < this.deps.clock().getTime()) throw conflict("This request has already expired.", "EXPIRED");
    const next = await this.transition(
      inv,
      ["PENDING_APPROVAL"],
      { status: "APPROVED", decidedAt: this.deps.clock().toISOString() },
      (n) => this.event(actor, n, "APPROVED", null),
      "Only pending requests can be approved.",
    );
    await this.audit.record(actor, "INVITATION_APPROVED", "Invitation", invitationId);
    await this.notifyApartment(
      next,
      {
        type: "VISITOR_APPROVED",
        title: "Visitor approved",
        message: `${actor.fullName} approved ${next.visitor.fullName}.`,
        dedupeKey: `approved:${next.invitationId}`,
      },
      actor.userId,
    );
    return publicInvitation(next);
  }

  async reject(actor: Actor, invitationId: string, reason: string | undefined): Promise<Invitation> {
    requireApartment(actor);
    const inv = await this.load(actor, invitationId);
    const next = await this.transition(
      inv,
      ["PENDING_APPROVAL"],
      { status: "REJECTED", decidedAt: this.deps.clock().toISOString(), rejectionReason: reason ?? null },
      (n) => this.event(actor, n, "REJECTED", reason ?? null),
      "Only pending requests can be rejected.",
    );
    await this.audit.record(actor, "INVITATION_REJECTED", "Invitation", invitationId, { hasReason: Boolean(reason) });
    await this.notifyApartment(
      next,
      {
        type: "VISITOR_REJECTED",
        title: "Visitor rejected",
        message: `${actor.fullName} rejected ${next.visitor.fullName}.`,
        dedupeKey: `rejected:${next.invitationId}`,
      },
      actor.userId,
    );
    return publicInvitation(next);
  }

  async cancel(actor: Actor, invitationId: string): Promise<Invitation> {
    requireRole(actor, "RESIDENT", "ADMIN");
    const inv = await this.load(actor, invitationId);
    const next = await this.transition(
      inv,
      ["PENDING_APPROVAL", "APPROVED"],
      { status: "CANCELLED" },
      (n) => this.event(actor, n, "CANCELLED", null),
      inv.status === "CHECKED_IN" ? "The visitor is inside — record their exit instead." : "This invitation can no longer be cancelled.",
    );
    await this.audit.record(actor, "INVITATION_CANCELLED", "Invitation", invitationId);
    return publicInvitation(next);
  }

  /** Issues a fresh QR token and revokes the old one in a single transaction. */
  async regeneratePass(actor: Actor, invitationId: string): Promise<IssuedPass> {
    requireApartment(actor);
    const inv = await this.load(actor, invitationId);
    const { token, payload } = generateQrToken();
    const nextHash = hashQrToken(token, this.deps.secrets.qrPepper);
    const draft: StoredInvitation = { ...inv, qrTokenHash: nextHash };
    const next = await this.transition(
      inv,
      ["PENDING_APPROVAL", "APPROVED"],
      { qrTokenHash: nextHash, qrTokenCipher: encrypt(payload, this.deps.secrets.encryptionKey) },
      () => null,
      "Passes can only be regenerated before the visitor enters.",
      [this.repo.qrClaimOp(draft), { type: "delete", key: { PK: `QR#${inv.qrTokenHash}`, SK: "QR" } }],
    );
    await this.audit.record(actor, "PASS_REGENERATED", "Invitation", invitationId);
    return { invitation: publicInvitation(next), qrPayload: payload };
  }

  async notifyApartment(inv: Invitation, input: Parameters<NotificationService["notify"]>[2], excludeUserId?: string) {
    const ids = (await this.property.residentIds(inv.communityId, inv.apartmentId)).filter((id) => id !== excludeUserId);
    if (ids.length) await this.notifications.notify(inv.communityId, ids, { link: `/resident/invitations?focus=${inv.invitationId}`, ...input });
  }
}

/** Strips storage-only fields and computes derived flags. */
export function publicInvitation(inv: StoredInvitation | Invitation): Invitation {
  const { qrTokenHash: _h, qrTokenCipher: _c, version: _v, ...rest } = inv as StoredInvitation;
  void _h;
  void _c;
  void _v;
  return { ...rest, overdue: Boolean(rest.overdue) };
}

function toKnownVisitor(v: StoredVisitor): KnownVisitor {
  return {
    visitorId: v.visitorId,
    apartmentId: v.apartmentId,
    fullName: v.fullName,
    phone: v.phone,
    category: v.category as KnownVisitor["category"],
    purpose: v.purpose,
    vehicleNumber: v.vehicleNumber,
    visitCount: v.visitCount,
    lastVisitAt: v.lastVisitAt,
  };
}
