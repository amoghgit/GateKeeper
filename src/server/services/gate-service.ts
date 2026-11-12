import type { GateAction, VerificationFailure } from "@/shared/domain";
import { FAILURE_MESSAGES } from "@/shared/domain";
import type { ActivityQuery } from "@/shared/schemas";
import type { Invitation, Page, VerificationResult, VisitEvent } from "@/shared/types";
import { localDate, startOfLocalDay, addDays } from "@/shared/time";
import { type Actor, requireRole } from "../auth/actor";
import { digits } from "../db/keys";
import { AppError, badRequest, notFound } from "../errors";
import { hashQrToken, parseQrPayload } from "../lib/crypto";
import { newId } from "../lib/ids";
import type { Deps } from "../ports";
import { EventRepo } from "../repositories/activity-repo";
import type { StoredInvitation } from "../repositories/invitation-repo";
import type { AuditService } from "./audit-service";
import { type InvitationService, publicInvitation, toTimeRange } from "./invitation-service";
import { evaluatePass } from "@/shared/pass-policy";

export class GateError extends AppError {
  constructor(failure: VerificationFailure | "DUPLICATE_ENTRY" | "NOT_INSIDE", message: string) {
    super(409, failure, message);
  }
}

type Target = { payload?: string; invitationId?: string };

export class GateService {
  private readonly events: EventRepo;

  constructor(
    private readonly deps: Deps,
    private readonly invitations: InvitationService,
    private readonly audit: AuditService,
  ) {
    this.events = new EventRepo(deps.table);
  }

  private async logEvent(e: Omit<VisitEvent, "eventId" | "timestamp" | "communityId">, actor: Actor) {
    const now = this.deps.clock();
    await this.deps.table.transact([
      this.events.putOp({ ...e, communityId: actor.communityId, eventId: newId("evt", now.getTime()), timestamp: now.toISOString() }),
    ]);
  }

  /**
   * Resolves a scanned payload to an invitation in the guard's own community.
   * Returns a failure (instead of throwing) so failed scans can be logged.
   */
  private async resolvePayload(actor: Actor, payload: string): Promise<{ inv: StoredInvitation } | { failure: VerificationFailure }> {
    const token = parseQrPayload(payload);
    if (!token) return { failure: "INVALID_TOKEN" };
    const ref = await this.invitations.repo.resolveQr(hashQrToken(token, this.deps.secrets.qrPepper));
    if (!ref) return { failure: "INVALID_TOKEN" };
    if (ref.communityId !== actor.communityId) return { failure: "WRONG_COMMUNITY" };
    const inv = await this.invitations.repo.get(ref.communityId, ref.invitationId);
    if (!inv || inv.qrTokenHash !== hashQrToken(token, this.deps.secrets.qrPepper)) return { failure: "INVALID_TOKEN" };
    return { inv };
  }

  private async resolveTarget(actor: Actor, target: Target): Promise<StoredInvitation> {
    if (target.payload) {
      const res = await this.resolvePayload(actor, target.payload);
      if ("failure" in res) {
        await this.logEvent(
          {
            invitationId: null,
            visitorName: null,
            apartmentId: null,
            apartmentLabel: null,
            eventType: "ENTRY_DENIED",
            actorId: actor.userId,
            actorName: actor.fullName,
            detail: res.failure,
          },
          actor,
        );
        throw new GateError(res.failure, FAILURE_MESSAGES[res.failure]);
      }
      return res.inv;
    }
    if (!target.invitationId) throw badRequest("Provide a pass or an invitation id.");
    const inv = await this.invitations.repo.get(actor.communityId, target.invitationId);
    if (!inv) throw notFound("Invitation");
    return inv;
  }

  /** Read-only check performed when a guard scans a pass. Every scan is logged. */
  async verify(actor: Actor, payload: string): Promise<VerificationResult> {
    requireRole(actor, "SECURITY");
    const res = await this.resolvePayload(actor, payload);
    if ("failure" in res) {
      await this.logEvent(
        {
          invitationId: null,
          visitorName: null,
          apartmentId: null,
          apartmentLabel: null,
          eventType: "QR_SCAN_FAILED",
          actorId: actor.userId,
          actorName: actor.fullName,
          detail: res.failure,
        },
        actor,
      );
      return { valid: false, failure: res.failure, message: FAILURE_MESSAGES[res.failure], invitation: null, allowedAction: null };
    }
    const { inv } = res;
    const evaluation = evaluatePass(inv, this.deps.clock());
    await this.deps.table.transact([
      this.events.putOp(this.invitations.event(actor, inv, evaluation.failure ? "QR_SCAN_FAILED" : "QR_SCAN_OK", evaluation.failure)),
    ]);
    if (evaluation.allowedAction === "ENTRY") {
      await this.invitations.notifyApartment(inv, {
        type: "VISITOR_ARRIVAL",
        title: "Visitor at the gate",
        message: `${inv.visitor.fullName} has arrived and their pass was verified.`,
        dedupeKey: `arrival:${inv.invitationId}:${inv.usageCount}`,
      });
    }
    return {
      valid: evaluation.failure === null,
      failure: evaluation.failure,
      message: evaluation.message,
      invitation: publicInvitation(inv),
      allowedAction: evaluation.allowedAction,
    };
  }

  /**
   * Records entry. The write is conditional on the invitation version read
   * here, so two guards scanning the same pass simultaneously cannot both
   * succeed: the loser receives DUPLICATE_ENTRY.
   */
  async recordEntry(actor: Actor, target: Target): Promise<Invitation> {
    requireRole(actor, "SECURITY");
    const inv = await this.resolveTarget(actor, target);
    return this.applyGateAction(actor, inv, "ENTRY");
  }

  async recordExit(actor: Actor, target: Target): Promise<Invitation> {
    requireRole(actor, "SECURITY");
    const inv = await this.resolveTarget(actor, target);
    return this.applyGateAction(actor, inv, "EXIT");
  }

  private async applyGateAction(actor: Actor, inv: StoredInvitation, action: GateAction): Promise<Invitation> {
    const now = this.deps.clock();
    const evaluation = evaluatePass(inv, now);
    if (evaluation.allowedAction !== action) {
      if (action === "ENTRY") {
        await this.deps.table.transact([this.events.putOp(this.invitations.event(actor, inv, "ENTRY_DENIED", evaluation.failure ?? "ALREADY_INSIDE"))]);
        if (inv.status === "CHECKED_IN") throw new GateError("DUPLICATE_ENTRY", "Entry has already been recorded — this visitor is inside.");
        throw new GateError(evaluation.failure ?? "INVALID_TOKEN", evaluation.message);
      }
      throw new GateError("NOT_INSIDE", "Exit can only be recorded for a visitor who is currently inside.");
    }

    const iso = now.toISOString();
    let next: StoredInvitation;
    try {
      next =
        action === "ENTRY"
          ? await this.invitations.transition(
              inv,
              ["APPROVED"],
              { status: "CHECKED_IN", usageCount: inv.usageCount + 1, lastEntryAt: iso, lastEntryGuardName: actor.fullName, overdue: false },
              (n) => this.invitations.event(actor, n, "ENTRY", null),
              "This pass cannot be used for entry.",
            )
          : await this.invitations.transition(
              inv,
              ["CHECKED_IN"],
              {
                status: inv.usagePolicy === "MULTI_USE" && now.getTime() < Date.parse(inv.expiry) ? "APPROVED" : "COMPLETED",
                lastExitAt: iso,
                lastExitGuardName: actor.fullName,
                overdue: false,
              },
              (n) => this.invitations.event(actor, n, "EXIT", null),
              "Visitor is not inside.",
            );
    } catch (err) {
      if (err instanceof AppError && err.code === "STALE") {
        const latest = await this.invitations.repo.get(inv.communityId, inv.invitationId);
        if (action === "ENTRY" && latest?.status === "CHECKED_IN") {
          throw new GateError("DUPLICATE_ENTRY", "Entry was just recorded by another guard.");
        }
        if (action === "EXIT" && latest?.status !== "CHECKED_IN") {
          throw new GateError("NOT_INSIDE", "Exit was just recorded by another guard.");
        }
      }
      throw err;
    }

    await this.audit.record(actor, action === "ENTRY" ? "GATE_ENTRY" : "GATE_EXIT", "Invitation", inv.invitationId);
    await this.invitations.notifyApartment(next, {
      type: action === "ENTRY" ? "VISITOR_ENTRY" : "VISITOR_EXIT",
      title: action === "ENTRY" ? "Visitor entered" : "Visitor left",
      message:
        action === "ENTRY" ? `${next.visitor.fullName} entered the premises (checked in by ${actor.fullName}).` : `${next.visitor.fullName} left the premises.`,
      dedupeKey: `${action.toLowerCase()}:${next.invitationId}:${next.usageCount}`,
    });
    return publicInvitation(next);
  }

  /** Manual lookup by invitation code, id, phone number or name. */
  async lookup(actor: Actor, q: string): Promise<Invitation[]> {
    requireRole(actor, "SECURITY", "ADMIN");
    const query = q.trim();
    const codeMatch = /^([A-Za-z0-9]{3})-?([A-Za-z0-9]{3})$/.exec(query);
    if (codeMatch) {
      const inv = await this.invitations.repo.getByCode(actor.communityId, `${codeMatch[1]}-${codeMatch[2]}`.toUpperCase());
      if (inv) return [publicInvitation(inv)];
    }
    if (/^inv_[A-Z0-9]{26}$/.test(query)) {
      const inv = await this.invitations.repo.get(actor.communityId, query);
      return inv ? [publicInvitation(inv)] : [];
    }
    const community = await this.invitations.community(actor.communityId);
    const today = localDate(this.deps.clock(), community.timezone);
    // Search a bounded window around today rather than the whole history.
    const range = toTimeRange(addDays(today, -31), addDays(today, 7), community.timezone);
    const needle = /^[+\d\s()-]+$/.test(query) ? digits(query) : query;
    if (needle.length < 2) return [];
    const page = await this.invitations.repo.listCommunity(actor.communityId, range, { q: needle }, { limit: 20 });
    return page.items.map((i) => publicInvitation(i));
  }

  async currentlyInside(actor: Actor): Promise<Invitation[]> {
    requireRole(actor, "SECURITY", "ADMIN");
    const page = await this.invitations.repo.listByStatus(actor.communityId, "CHECKED_IN", {}, { limit: 500 });
    return page.items.map((i) => publicInvitation(i)).sort((a, b) => (b.lastEntryAt ?? "").localeCompare(a.lastEntryAt ?? ""));
  }

  async expectedToday(actor: Actor): Promise<Invitation[]> {
    const community = await this.invitations.community(actor.communityId);
    const now = this.deps.clock();
    const today = localDate(now, community.timezone);
    const endOfDay = new Date(startOfLocalDay(addDays(today, 1), community.timezone).getTime() - 1).toISOString();
    const startOfDay = startOfLocalDay(today, community.timezone).toISOString();
    const [approved, pending] = await Promise.all(
      (["APPROVED", "PENDING_APPROVAL"] as const).map((status) =>
        this.invitations.repo.listByStatus(
          actor.communityId,
          status,
          { to: endOfDay },
          {
            limit: 200,
            filter: { kind: "gte", field: "expiry", value: startOfDay },
          },
        ),
      ),
    );
    return [...approved!.items, ...pending!.items].map((i) => publicInvitation(i)).sort((a, b) => a.expectedArrival.localeCompare(b.expectedArrival));
  }

  async activity(actor: Actor, q: ActivityQuery): Promise<Page<VisitEvent>> {
    requireRole(actor, "SECURITY", "ADMIN");
    const community = await this.invitations.community(actor.communityId);
    const range = toTimeRange(q.from, q.to, community.timezone);
    return this.events.list(actor.communityId, {
      fromMs: range.from ? Date.parse(range.from) : undefined,
      toMs: range.to ? Date.parse(range.to) : undefined,
      type: q.type,
      q: q.q,
      limit: q.limit,
      cursor: q.cursor,
    });
  }

  async tallyToday(communityId: string, timeZone: string) {
    const today = localDate(this.deps.clock(), timeZone);
    const start = startOfLocalDay(today, timeZone).getTime();
    return this.events.tally(communityId, start, this.deps.clock().getTime());
  }
}
