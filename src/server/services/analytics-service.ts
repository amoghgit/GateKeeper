import { CATEGORY_LABELS, STATUS_LABELS, VISITOR_CATEGORIES, type VisitorCategory } from "@/shared/domain";
import type { InvitationQuery } from "@/shared/schemas";
import type { AdminAnalytics, DailySummary, ResidentOverview, SecurityOverview } from "@/shared/types";
import { addDays, localDate, monthStart, startOfLocalDay, weekStart } from "@/shared/time";
import { type Actor, requireApartment, requireRole } from "../auth/actor";
import { cond } from "../db/table";
import type { Deps } from "../ports";
import { AnnouncementRepo, EventRepo, SummaryRepo } from "../repositories/activity-repo";
import { InvitationRepo } from "../repositories/invitation-repo";
import { UserRepo } from "../repositories/user-repo";
import type { GateService } from "./gate-service";
import { type InvitationService, publicInvitation, toTimeRange } from "./invitation-service";

const DENIED = ["ENTRY_DENIED", "QR_SCAN_FAILED"];

export class AnalyticsService {
  private readonly events: EventRepo;
  private readonly summaries: SummaryRepo;
  private readonly invitationsRepo: InvitationRepo;
  private readonly users: UserRepo;
  private readonly announcements: AnnouncementRepo;

  constructor(
    private readonly deps: Deps,
    private readonly invitations: InvitationService,
    private readonly gate: GateService,
  ) {
    this.events = new EventRepo(deps.table);
    this.summaries = new SummaryRepo(deps.table);
    this.invitationsRepo = new InvitationRepo(deps.table);
    this.users = new UserRepo(deps.table);
    this.announcements = new AnnouncementRepo(deps.table);
  }

  /** Builds the summary for one local day from raw events and invitations. Deterministic and idempotent. */
  async computeDailySummary(communityId: string, day: string, timeZone: string): Promise<DailySummary> {
    const start = startOfLocalDay(day, timeZone).getTime();
    const end = startOfLocalDay(addDays(day, 1), timeZone).getTime() - 1;
    const t = await this.events.tally(communityId, start, end);
    const entries = t.ENTRY ?? 0;
    const exits = t.EXIT ?? 0;
    const denied = DENIED.reduce((sum, type) => sum + (t[type] ?? 0), 0);
    const categories: Partial<Record<VisitorCategory, number>> = {};
    let invitations = 0;
    let cursor: string | undefined;
    do {
      const page = await this.invitationsRepo.listCommunity(
        communityId,
        { from: new Date(start).toISOString(), to: new Date(end).toISOString() },
        {},
        { limit: 100, cursor, descending: false },
      );
      for (const inv of page.items) {
        invitations++;
        categories[inv.visitor.category] = (categories[inv.visitor.category] ?? 0) + 1;
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return { date: day, entries, exits, denied, invitations, categories };
  }

  /** Stored summaries for past days plus a live summary for today. */
  private async dailySeries(communityId: string, timeZone: string, days: number): Promise<DailySummary[]> {
    const today = localDate(this.deps.clock(), timeZone);
    const from = addDays(today, -(days - 1));
    const stored = new Map((await this.summaries.range(communityId, from, addDays(today, -1))).map((s) => [s.date, s]));
    const live = await this.computeDailySummary(communityId, today, timeZone);
    const out: DailySummary[] = [];
    for (let d = from; d < today; d = addDays(d, 1)) {
      out.push(stored.get(d) ?? { date: d, entries: 0, exits: 0, denied: 0, invitations: 0, categories: {} });
    }
    out.push(live);
    return out;
  }

  async residentOverview(actor: Actor): Promise<ResidentOverview> {
    const apartmentId = requireApartment(actor);
    const community = await this.invitations.community(actor.communityId);
    const now = this.deps.clock();
    const today = localDate(now, community.timezone);
    const month = toTimeRange(monthStart(today), today, community.timezone);
    const monthPage = await this.invitationsRepo.listByApartment(actor.communityId, apartmentId, month, {}, { limit: 500 });
    const counted = monthPage.items.filter((i) => !["CANCELLED", "REJECTED"].includes(i.status));
    const [inside, pending, upcoming, recent, ann] = await Promise.all([
      this.invitationsRepo.listByApartment(actor.communityId, apartmentId, {}, { status: "CHECKED_IN" }, { limit: 50 }),
      this.invitationsRepo.listByApartment(actor.communityId, apartmentId, {}, { status: "PENDING_APPROVAL" }, { limit: 50 }),
      this.invitationsRepo.listByApartment(
        actor.communityId,
        apartmentId,
        { from: new Date(now.getTime() - 2 * 3_600_000).toISOString() },
        { status: "APPROVED" },
        { limit: 5, descending: false },
      ),
      this.events.list(actor.communityId, {
        apartmentId,
        types: ["ENTRY", "EXIT", "WALK_IN_REGISTERED", "APPROVED", "REJECTED", "ENTRY_DENIED"],
        limit: 8,
      }),
      this.announcements.list(actor.communityId, { limit: 3 }),
    ]);
    return {
      visitorsThisMonth: counted.length,
      insideNow: inside.items.length,
      pendingRequests: pending.items.filter((i) => Date.parse(i.expiry) > now.getTime()).length,
      upcoming: upcoming.items.map((i) => publicInvitation(i)),
      recentActivity: recent.items,
      announcements: ann.items,
    };
  }

  async securityOverview(actor: Actor): Promise<SecurityOverview> {
    requireRole(actor, "SECURITY", "ADMIN");
    const community = await this.invitations.community(actor.communityId);
    const nowIso = this.deps.clock().toISOString();
    const [inside, overdue, pending, expected, today, recent] = await Promise.all([
      this.invitationsRepo.countByStatus(actor.communityId, "CHECKED_IN"),
      this.invitationsRepo.countByStatus(actor.communityId, "CHECKED_IN", {}, cond.eq("overdue", true)),
      this.invitationsRepo.countByStatus(actor.communityId, "PENDING_APPROVAL", {}, cond.gte("expiry", nowIso)),
      this.gate.expectedToday(actor),
      this.gate.tallyToday(actor.communityId, community.timezone),
      this.events.list(actor.communityId, { limit: 8 }),
    ]);
    return {
      insideNow: inside,
      expectedToday: expected.filter((i) => i.status === "APPROVED").length,
      pendingApprovals: pending,
      entriesToday: today.ENTRY ?? 0,
      exitsToday: today.EXIT ?? 0,
      overdue,
      expectedList: expected.slice(0, 12),
      recentActivity: recent.items,
    };
  }

  async adminAnalytics(actor: Actor): Promise<AdminAnalytics> {
    requireRole(actor, "ADMIN");
    const community = await this.invitations.community(actor.communityId);
    const tz = community.timezone;
    const today = localDate(this.deps.clock(), tz);
    const series = await this.dailySeries(actor.communityId, tz, 186);
    const [residents, guards, pendingRegistrations, insideNow] = await Promise.all([
      this.users.countByRole(actor.communityId, "RESIDENT", "ACTIVE"),
      this.users.countByRole(actor.communityId, "SECURITY", "ACTIVE"),
      this.users.countByRole(actor.communityId, "PENDING", "PENDING"),
      this.invitationsRepo.countByStatus(actor.communityId, "CHECKED_IN"),
    ]);
    const thisMonth = series.filter((d) => d.date >= monthStart(today));
    const weekly = new Map<string, { week: string; entries: number; exits: number }>();
    for (const d of series.slice(-56)) {
      const w = weekStart(d.date);
      const agg = weekly.get(w) ?? { week: w, entries: 0, exits: 0 };
      agg.entries += d.entries;
      agg.exits += d.exits;
      weekly.set(w, agg);
    }
    const monthly = new Map<string, number>();
    for (const d of series) monthly.set(d.date.slice(0, 7), (monthly.get(d.date.slice(0, 7)) ?? 0) + d.entries);
    const categories = new Map<VisitorCategory, number>();
    for (const d of series.slice(-30)) {
      for (const [k, v] of Object.entries(d.categories)) categories.set(k as VisitorCategory, (categories.get(k as VisitorCategory) ?? 0) + (v ?? 0));
    }
    return {
      totals: {
        residents,
        securityStaff: guards,
        pendingRegistrations,
        entriesToday: series[series.length - 1]!.entries,
        insideNow,
        visitorsThisMonth: thisMonth.reduce((s, d) => s + d.entries, 0),
        deniedThisMonth: thisMonth.reduce((s, d) => s + d.denied, 0),
      },
      daily: series.slice(-30),
      weekly: [...weekly.values()],
      // Drop leading months before the community had any recorded traffic.
      monthly: [...monthly.entries()]
        .slice(-6)
        .map(([month, visitors]) => ({ month, visitors }))
        .filter((m, i, all) => all.slice(0, i + 1).some((x) => x.visitors > 0)),
      categories: VISITOR_CATEGORIES.map((c) => ({ category: c, count: categories.get(c) ?? 0 })).filter((c) => c.count > 0),
    };
  }

  /** CSV export with spreadsheet formula-injection protection. */
  async reportCsv(actor: Actor, q: InvitationQuery): Promise<string> {
    requireRole(actor, "ADMIN");
    const header = [
      "Invitation",
      "Code",
      "Visitor",
      "Phone",
      "Category",
      "Purpose",
      "Vehicle",
      "Apartment",
      "Resident",
      "Expected arrival",
      "Expected departure",
      "Status",
      "Entry",
      "Entry guard",
      "Exit",
      "Exit guard",
      "Source",
    ];
    const rows: string[][] = [header];
    let cursor: string | undefined;
    do {
      const page = await this.invitations.list(actor, { ...q, limit: 100, cursor });
      for (const i of page.items) {
        rows.push([
          i.invitationId,
          i.code,
          i.visitor.fullName,
          i.visitor.phone,
          CATEGORY_LABELS[i.visitor.category],
          i.visitor.purpose,
          i.visitor.vehicleNumber ?? "",
          i.apartmentLabel,
          i.residentName,
          i.expectedArrival,
          i.expectedDeparture,
          STATUS_LABELS[i.status],
          i.lastEntryAt ?? "",
          i.lastEntryGuardName ?? "",
          i.lastExitAt ?? "",
          i.lastExitGuardName ?? "",
          i.source === "WALK_IN" ? "Walk-in" : "Invitation",
        ]);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor && rows.length < 10_000);
    return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  }
}

export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
