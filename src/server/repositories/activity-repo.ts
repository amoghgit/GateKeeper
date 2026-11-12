import type { Announcement, AppNotification, AuditLogEntry, DailySummary, Page, VisitEvent } from "@/shared/types";
import { keys, strip, ttlSeconds } from "../db/keys";
import { cond, type Condition, queryFilled, type Table, type TxOp } from "../db/table";
import { ulidBound } from "../lib/ids";

/** Visit events: the gate's append-only activity stream. */
export class EventRepo {
  constructor(private readonly table: Table) {}

  putOp(e: VisitEvent): TxOp {
    const ulidPart = e.eventId.slice(4);
    return {
      type: "put",
      item: {
        PK: keys.events(e.communityId),
        SK: ulidPart,
        ...(e.invitationId ? { GSI1PK: keys.eventsByInvitation(e.communityId, e.invitationId), GSI1SK: ulidPart } : {}),
        entity: "VisitEvent",
        ...e,
        searchText: `${e.visitorName ?? ""} ${e.apartmentLabel ?? ""} ${e.actorName} ${e.detail ?? ""}`.toLowerCase(),
      },
      condition: cond.notExists(),
    };
  }

  async list(
    cid: string,
    opts: {
      fromMs?: number;
      toMs?: number;
      type?: string;
      types?: string[];
      apartmentId?: string;
      q?: string;
      actorId?: string;
      limit: number;
      cursor?: string;
    },
  ): Promise<Page<VisitEvent>> {
    const filters: Condition[] = [];
    if (opts.type) filters.push(cond.eq("eventType", opts.type));
    if (opts.types) filters.push(cond.in("eventType", opts.types));
    if (opts.apartmentId) filters.push(cond.eq("apartmentId", opts.apartmentId));
    if (opts.q) filters.push(cond.contains("searchText", opts.q.toLowerCase()));
    if (opts.actorId) filters.push(cond.eq("actorId", opts.actorId));
    const res = await queryFilled(this.table, {
      pk: keys.events(cid),
      sk: { between: [ulidBound(opts.fromMs ?? 0, "min"), ulidBound(opts.toMs ?? 8.6e15, "max")] },
      filter: filters.length ? cond.and(...filters) : undefined,
      descending: true,
      limit: opts.limit,
      cursor: opts.cursor,
    });
    return { items: res.items.map((i) => strip<VisitEvent>(i)), nextCursor: res.cursor };
  }

  /**
   * Tallies event types over a time range in a single pass (one read of the
   * range instead of one COUNT query per type — this runs on every dashboard poll).
   */
  async tally(cid: string, fromMs: number, toMs: number): Promise<Record<string, number>> {
    const totals: Record<string, number> = {};
    let cursor: string | undefined;
    do {
      const page = await this.table.query({ pk: keys.events(cid), sk: { between: [ulidBound(fromMs, "min"), ulidBound(toMs, "max")] }, limit: 1000, cursor });
      for (const item of page.items) totals[item.eventType as string] = (totals[item.eventType as string] ?? 0) + 1;
      cursor = page.cursor ?? undefined;
    } while (cursor);
    return totals;
  }

  async forInvitation(cid: string, invitationId: string): Promise<VisitEvent[]> {
    const res = await this.table.query({ index: "GSI1", pk: keys.eventsByInvitation(cid, invitationId), limit: 200 });
    return res.items.map((i) => strip<VisitEvent>(i));
  }
}

export class NotificationRepo {
  constructor(private readonly table: Table) {}

  /** Writes the notification only if its dedupe key has not been used (7-day window). */
  createOps(n: AppNotification, dedupeKey: string | null, now: Date): TxOp[] {
    const ops: TxOp[] = [
      {
        type: "put",
        item: {
          PK: keys.notifications(n.communityId, n.userId),
          SK: `NOTIF#${n.notificationId}`,
          entity: "Notification",
          ...n,
          ttl: ttlSeconds(new Date(now.getTime() + 180 * 86_400_000)),
        },
      },
    ];
    if (dedupeKey) {
      ops.push({
        type: "put",
        item: { ...keys.notificationDedupe(n.communityId, n.userId, dedupeKey), ttl: ttlSeconds(new Date(now.getTime() + 7 * 86_400_000)) },
        condition: cond.notExists(),
      });
    }
    return ops;
  }

  async list(cid: string, userId: string, opts: { unreadOnly: boolean; limit: number; cursor?: string }): Promise<Page<AppNotification>> {
    const res = await queryFilled(this.table, {
      pk: keys.notifications(cid, userId),
      sk: { beginsWith: "NOTIF#" },
      filter: opts.unreadOnly ? cond.eq("read", false) : undefined,
      descending: true,
      limit: opts.limit,
      cursor: opts.cursor,
    });
    return { items: res.items.map((i) => strip<AppNotification>(i)), nextCursor: res.cursor };
  }

  async unreadCount(cid: string, userId: string) {
    return this.table.count({ pk: keys.notifications(cid, userId), sk: { beginsWith: "NOTIF#" }, filter: cond.eq("read", false) });
  }

  async markRead(cid: string, userId: string, notificationId: string) {
    await this.table.update({ PK: keys.notifications(cid, userId), SK: `NOTIF#${notificationId}` }, { set: { read: true } }, cond.exists());
  }
}

export class AnnouncementRepo {
  constructor(private readonly table: Table) {}

  async put(a: Announcement) {
    await this.table.put({ ...keys.announcement(a.communityId, a.announcementId), entity: "Announcement", ...a }, cond.notExists());
  }

  async delete(cid: string, id: string) {
    await this.table.delete(keys.announcement(cid, id), cond.exists());
  }

  async list(cid: string, opts: { limit: number; cursor?: string }): Promise<Page<Announcement>> {
    const res = await this.table.query({ pk: `C#${cid}`, sk: { beginsWith: "ANN#" }, descending: true, ...opts });
    return { items: res.items.map((i) => strip<Announcement>(i)), nextCursor: res.cursor };
  }
}

export class SummaryRepo {
  constructor(private readonly table: Table) {}

  async put(cid: string, s: DailySummary) {
    // Idempotent: re-running the job for the same day overwrites the same key.
    await this.table.put({ ...keys.summary(cid, s.date), entity: "DailySummary", ...s });
  }

  async range(cid: string, from: string, to: string): Promise<DailySummary[]> {
    const res = await this.table.query({ pk: keys.summaries(cid), sk: { between: [from, to] }, limit: 400 });
    return res.items.map((i) => strip<DailySummary>(i));
  }
}

/** Audit entries live in a separate, append-only table (no update/delete IAM grants). */
export class AuditRepo {
  constructor(private readonly table: Table) {}

  async head(cid: string): Promise<{ seq: number; hash: string }> {
    const item = await this.table.get(keys.auditHead(cid));
    return item ? { seq: item.seq as number, hash: item.hash as string } : { seq: 0, hash: "GENESIS" };
  }

  appendOps(entry: AuditLogEntry, previousSeq: number): TxOp[] {
    return [
      {
        type: "update",
        key: keys.auditHead(entry.communityId),
        update: { set: { seq: entry.seq, hash: entry.hash } },
        condition: previousSeq === 0 ? cond.notExists() : cond.eq("seq", previousSeq),
      },
      {
        type: "put",
        table: "audit",
        item: { ...keys.auditEntry(entry.communityId, entry.seq), entity: "AuditLog", ...entry },
        condition: cond.notExists(),
      },
    ];
  }

  async list(cid: string, opts: { limit: number; cursor?: string; q?: string; ascending?: boolean }): Promise<Page<AuditLogEntry>> {
    const res = await queryFilled(this.table, {
      table: "audit",
      pk: keys.auditPartition(cid),
      descending: !opts.ascending,
      filter: opts.q
        ? cond.or(cond.contains("action", opts.q.toUpperCase()), cond.contains("actorName", opts.q), cond.contains("entityId", opts.q))
        : undefined,
      limit: opts.limit,
      cursor: opts.cursor,
    });
    return { items: res.items.map((i) => strip<AuditLogEntry>(i)), nextCursor: res.cursor };
  }
}

export interface StoredVisitor {
  visitorId: string;
  communityId: string;
  apartmentId: string;
  fullName: string;
  phone: string;
  category: string;
  purpose: string;
  vehicleNumber: string | null;
  createdBy: string;
  visitCount: number;
  lastVisitAt: string;
  createdAt: string;
}

/** Known visitors per apartment — powers "invite again". */
export class VisitorRepo {
  constructor(private readonly table: Table) {}

  upsertOp(v: StoredVisitor): TxOp {
    return {
      type: "update",
      key: keys.visitor(v.communityId, v.visitorId),
      update: {
        set: {
          entity: "Visitor",
          visitorId: v.visitorId,
          communityId: v.communityId,
          apartmentId: v.apartmentId,
          fullName: v.fullName,
          phone: v.phone,
          category: v.category,
          purpose: v.purpose,
          vehicleNumber: v.vehicleNumber,
          createdBy: v.createdBy,
          lastVisitAt: v.lastVisitAt,
          createdAt: v.createdAt,
          GSI1PK: keys.visitorsByApartment(v.communityId, v.apartmentId),
          GSI1SK: v.fullName.toLowerCase(),
        },
        increment: { visitCount: 1 },
      },
    };
  }

  async get(cid: string, visitorId: string): Promise<StoredVisitor | null> {
    const item = await this.table.get(keys.visitor(cid, visitorId));
    return item ? strip<StoredVisitor>(item) : null;
  }

  async listByApartment(cid: string, apartmentId: string, opts: { limit: number; cursor?: string }): Promise<Page<StoredVisitor>> {
    const res = await this.table.query({ index: "GSI1", pk: keys.visitorsByApartment(cid, apartmentId), ...opts });
    return { items: res.items.map((i) => strip<StoredVisitor>(i)), nextCursor: res.cursor };
  }

  async listCommunity(cid: string, opts: { limit: number; cursor?: string }): Promise<Page<StoredVisitor>> {
    const res = await this.table.query({ pk: `C#${cid}`, sk: { beginsWith: "VISITOR#" }, ...opts });
    return { items: res.items.map((i) => strip<StoredVisitor>(i)), nextCursor: res.cursor };
  }
}
