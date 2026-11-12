import { addDays, localDate } from "@/shared/time";
import { systemActor } from "../auth/actor";
import { cond } from "../db/table";
import { AppError } from "../errors";
import type { Deps } from "../ports";
import { SummaryRepo } from "../repositories/activity-repo";
import { CommunityRepo } from "../repositories/community-repo";
import { UserRepo } from "../repositories/user-repo";
import type { AnalyticsService } from "./analytics-service";
import type { AuditService } from "./audit-service";
import type { InvitationService } from "./invitation-service";
import type { NotificationService } from "./notification-service";

export const JOB_NAMES = ["expire-invitations", "flag-overdue", "daily-summary", "cleanup", "reminders", "audit-anchor"] as const;
export type JobName = (typeof JOB_NAMES)[number];

export interface JobReport {
  job: JobName;
  communities: number;
  affected: number;
  failedCommunities: string[];
}

/** Thrown after a job finishes the communities it could, so Lambda reports an error (and alarms fire). */
export class JobFailedError extends Error {
  constructor(readonly report: JobReport) {
    super(`Job ${report.job} failed for ${report.failedCommunities.length} of ${report.communities} communities`);
    this.name = "JobFailedError";
  }
}

/**
 * Scheduled maintenance (EventBridge → Lambda in production).
 * Every job is idempotent: transitions are conditional on the record's current
 * version and status, summaries overwrite a deterministic key, and
 * notifications carry dedupe keys — re-running a job never double-applies.
 *
 * Overdue policy: visitors past their expected departure (+ grace) are only
 * FLAGGED and their residents/guards notified. GateKeeper never records an
 * exit automatically — exits require a guard.
 */
export class JobsService {
  private readonly communities: CommunityRepo;
  private readonly summaries: SummaryRepo;
  private readonly users: UserRepo;

  constructor(
    private readonly deps: Deps,
    private readonly invitations: InvitationService,
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {
    this.communities = new CommunityRepo(deps.table);
    this.summaries = new SummaryRepo(deps.table);
    this.users = new UserRepo(deps.table);
  }

  async run(job: JobName, onlyCommunityId?: string): Promise<JobReport> {
    const ids = onlyCommunityId ? [onlyCommunityId] : await this.communities.listIds();
    let affected = 0;
    const failedCommunities: string[] = [];
    for (const cid of ids) {
      try {
        affected += await this.runFor(job, cid);
      } catch (err) {
        failedCommunities.push(cid);
        this.deps.logger.error("job.community_failed", { job, communityId: cid, error: (err as Error).name });
      }
    }
    const report: JobReport = { job, communities: ids.length, affected, failedCommunities };
    this.deps.logger.info("job.completed", { job, communities: ids.length, affected, failed: failedCommunities.length });
    // One bad tenant must not block the others, but the run must not look healthy either.
    if (failedCommunities.length) throw new JobFailedError(report);
    return report;
  }

  private runFor(job: JobName, cid: string): Promise<number> {
    switch (job) {
      case "expire-invitations":
        return this.expireInvitations(cid);
      case "flag-overdue":
        return this.flagOverdue(cid);
      case "daily-summary":
        return this.dailySummary(cid);
      case "cleanup":
        return this.cleanup(cid);
      case "reminders":
        return this.reminders(cid);
      case "audit-anchor":
        return this.audit.anchor(cid).then((anchored) => (anchored ? 1 : 0));
    }
  }

  async expireInvitations(cid: string): Promise<number> {
    const nowIso = this.deps.clock().toISOString();
    const actor = systemActor(cid);
    let count = 0;
    for (const status of ["APPROVED", "PENDING_APPROVAL"] as const) {
      const page = await this.invitations.repo.listByStatus(cid, status, { to: nowIso }, { limit: 500, filter: cond.lt("expiry", nowIso) });
      for (const inv of page.items) {
        try {
          const next = await this.invitations.transition(
            inv,
            [status],
            { status: "EXPIRED" },
            (n) => this.invitations.event(actor, n, "EXPIRED", null),
            "Already transitioned",
          );
          count++;
          await this.invitations.notifyApartment(next, {
            type: "INVITATION_EXPIRED",
            title: "Invitation expired",
            message: `The pass for ${next.visitor.fullName} expired without being used.`,
            dedupeKey: `expired:${next.invitationId}`,
          });
        } catch (err) {
          if (!(err instanceof AppError)) throw err; // concurrent change — skip, the next run will re-evaluate
        }
      }
    }
    if (count) await this.audit.record(actor, "INVITATIONS_EXPIRED", "Job", "expire-invitations", { count });
    return count;
  }

  async flagOverdue(cid: string): Promise<number> {
    const community = await this.communities.get(cid);
    if (!community) return 0;
    const threshold = new Date(this.deps.clock().getTime() - community.settings.overdueAfterMinutes * 60_000).toISOString();
    const page = await this.invitations.repo.listByStatus(
      cid,
      "CHECKED_IN",
      {},
      {
        limit: 500,
        filter: cond.and(cond.lt("expectedDeparture", threshold), cond.ne("overdue", true)),
      },
    );
    const guards = await this.users.listByRole(cid, "SECURITY", { status: "ACTIVE", limit: 100 });
    let count = 0;
    for (const inv of page.items) {
      try {
        const next = await this.invitations.transition(inv, ["CHECKED_IN"], { overdue: true }, () => null, "Already transitioned");
        count++;
        await this.invitations.notifyApartment(next, {
          type: "VISITOR_OVERDUE",
          title: "Visitor overstaying",
          message: `${next.visitor.fullName} was expected to leave by ${new Date(next.expectedDeparture).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: community.timezone })} and is still inside.`,
          dedupeKey: `overdue:${next.invitationId}:${next.usageCount}`,
        });
        await this.notifications.notify(
          cid,
          guards.items.map((g) => g.userId),
          {
            type: "VISITOR_OVERDUE",
            title: "Overdue visitor",
            message: `${next.visitor.fullName} (${next.apartmentLabel}) is past their expected departure.`,
            link: "/security/currently-inside",
            dedupeKey: `overdue:${next.invitationId}:${next.usageCount}`,
          },
        );
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
      }
    }
    return count;
  }

  /** Recomputes yesterday and today; overwriting is safe, so re-runs are harmless. */
  async dailySummary(cid: string, days: string[] | null = null): Promise<number> {
    const community = await this.communities.get(cid);
    if (!community) return 0;
    const today = localDate(this.deps.clock(), community.timezone);
    const targets = days ?? [addDays(today, -1), today];
    for (const day of targets) {
      await this.summaries.put(cid, await this.analytics.computeDailySummary(cid, day, community.timezone));
    }
    return targets.length;
  }

  /**
   * Notifications, dedupe markers and QR lookups expire via DynamoDB TTL.
   * This job handles what TTL cannot: self-registrations left unreviewed for
   * 30 days are closed so the identities cannot linger half-provisioned.
   */
  async cleanup(cid: string): Promise<number> {
    const cutoff = new Date(this.deps.clock().getTime() - 30 * 86_400_000).toISOString();
    const pending = await this.users.listByRole(cid, "PENDING", { status: "PENDING", limit: 200 });
    let count = 0;
    for (const u of pending.items) {
      if (u.createdAt >= cutoff) continue;
      const stored = await this.users.get(cid, u.userId);
      if (!stored || stored.status !== "PENDING") continue;
      await this.deps.identity.setEnabled(stored.cognitoSub, stored.email, false);
      await this.users.save({ ...stored, status: "DEACTIVATED", updatedAt: this.deps.clock().toISOString() });
      count++;
    }
    if (count) await this.audit.record(systemActor(cid), "STALE_REGISTRATIONS_CLOSED", "Job", "cleanup", { count });
    return count;
  }

  /** Reminds residents of visitors arriving within the next hour (if enabled for the community). */
  async reminders(cid: string): Promise<number> {
    const community = await this.communities.get(cid);
    if (!community?.settings.remindersEnabled) return 0;
    const now = this.deps.clock();
    const page = await this.invitations.repo.listByStatus(
      cid,
      "APPROVED",
      { from: now.toISOString(), to: new Date(now.getTime() + 3_600_000).toISOString() },
      { limit: 500 },
    );
    let count = 0;
    for (const inv of page.items) {
      if (inv.usageCount > 0) continue;
      await this.invitations.notifyApartment(inv, {
        type: "VISITOR_ARRIVAL",
        title: "Visitor arriving soon",
        message: `${inv.visitor.fullName} is expected at ${new Date(inv.expectedArrival).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: community.timezone })}.`,
        dedupeKey: `reminder:${inv.invitationId}`,
      });
      count++;
    }
    return count;
  }
}
