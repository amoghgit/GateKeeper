import type { InvitationStatus } from "@/shared/domain";
import type { Invitation, Page } from "@/shared/types";
import { digits, keys, strip, ttlSeconds } from "../db/keys";
import { cond, type Condition, type Item, queryFilled, type Table, type TxOp } from "../db/table";

export interface StoredInvitation extends Invitation {
  qrTokenHash: string;
  qrTokenCipher: string;
  version: number;
}

export interface TimeRange {
  /** Inclusive ISO lower bound on expectedArrival. */
  from?: string;
  /** Inclusive ISO upper bound on expectedArrival. */
  to?: string;
}

export interface InvitationFilters {
  status?: InvitationStatus;
  category?: string;
  residentId?: string;
  q?: string;
}

const HIGH = "￿";

function sortKey(inv: Invitation) {
  return `${inv.expectedArrival}#${inv.invitationId}`;
}

function indexAttrs(inv: StoredInvitation) {
  const sk = sortKey(inv);
  return {
    GSI1PK: keys.invitationsByApartment(inv.communityId, inv.apartmentId),
    GSI1SK: sk,
    GSI2PK: keys.invitationsByStatus(inv.communityId, inv.status),
    GSI2SK: sk,
    GSI3PK: keys.invitationsByDate(inv.communityId),
    GSI3SK: sk,
    searchText: [inv.visitor.fullName, digits(inv.visitor.phone), inv.code, inv.visitor.vehicleNumber ?? "", inv.apartmentLabel, inv.residentName]
      .join(" ")
      .toLowerCase(),
  };
}

function rangeCondition(range: TimeRange) {
  if (range.from && range.to) return { between: [range.from, `${range.to}${HIGH}`] as [string, string] };
  if (range.from) return { gte: range.from };
  if (range.to) return { lte: `${range.to}${HIGH}` };
  return undefined;
}

function buildFilter(f: InvitationFilters): Condition | undefined {
  const parts: Condition[] = [];
  if (f.status) parts.push(cond.eq("status", f.status));
  if (f.category) parts.push(cond.eq("category", f.category));
  if (f.residentId) parts.push(cond.eq("residentId", f.residentId));
  if (f.q) parts.push(cond.contains("searchText", f.q.toLowerCase().replace(/^\+/, "")));
  return parts.length ? cond.and(...parts) : undefined;
}

export class InvitationRepo {
  constructor(private readonly table: Table) {}

  toItem(inv: StoredInvitation): Item {
    return {
      ...keys.invitation(inv.communityId, inv.invitationId),
      entity: "Invitation",
      ...inv,
      // Flattened copy of the category for filter expressions.
      category: inv.visitor.category,
      ...indexAttrs(inv),
    };
  }

  private fromItem(item: Item): StoredInvitation {
    const { category: _category, ...rest } = item;
    void _category;
    return {
      ...strip<Invitation>(rest),
      qrTokenHash: item.qrTokenHash as string,
      qrTokenCipher: item.qrTokenCipher as string,
      version: item.version as number,
    };
  }

  async get(cid: string, invitationId: string): Promise<StoredInvitation | null> {
    const item = await this.table.get(keys.invitation(cid, invitationId));
    return item ? this.fromItem(item) : null;
  }

  async getByCode(cid: string, code: string): Promise<StoredInvitation | null> {
    const claim = await this.table.get(keys.invitationCode(cid, code));
    return claim ? this.get(cid, claim.invitationId as string) : null;
  }

  /** Resolves a hashed QR token to its tenant + invitation. */
  async resolveQr(hash: string): Promise<{ communityId: string; invitationId: string } | null> {
    const item = await this.table.get(keys.qrToken(hash));
    return item ? { communityId: item.communityId as string, invitationId: item.invitationId as string } : null;
  }

  qrClaimOp(inv: StoredInvitation): TxOp {
    const retention = new Date(Date.parse(inv.expiry) + 30 * 86_400_000);
    return {
      type: "put",
      item: {
        ...keys.qrToken(inv.qrTokenHash),
        communityId: inv.communityId,
        invitationId: inv.invitationId,
        ttl: ttlSeconds(retention),
      },
      condition: cond.notExists(),
    };
  }

  createOps(inv: StoredInvitation): TxOp[] {
    return [
      { type: "put", item: this.toItem(inv), condition: cond.notExists() },
      {
        type: "put",
        item: { ...keys.invitationCode(inv.communityId, inv.code), invitationId: inv.invitationId },
        condition: cond.notExists(),
      },
      this.qrClaimOp(inv),
    ];
  }

  /**
   * Replaces the invitation only if nobody else changed it since it was read
   * (optimistic concurrency on `version`). This is what makes two simultaneous
   * gate scans unable to both record an entry.
   */
  replaceOp(next: StoredInvitation, expectedVersion: number): TxOp {
    return {
      type: "put",
      item: this.toItem(next),
      condition: cond.and(cond.exists(), cond.eq("version", expectedVersion)),
    };
  }

  private page(items: Item[], cursor: string | null): Page<StoredInvitation> {
    return { items: items.map((i) => this.fromItem(i)), nextCursor: cursor };
  }

  async listByApartment(
    cid: string,
    apartmentId: string,
    range: TimeRange,
    filters: InvitationFilters,
    opts: { limit: number; cursor?: string; descending?: boolean },
  ) {
    const res = await queryFilled(this.table, {
      index: "GSI1",
      pk: keys.invitationsByApartment(cid, apartmentId),
      sk: rangeCondition(range),
      filter: buildFilter(filters),
      descending: opts.descending ?? true,
      limit: opts.limit,
      cursor: opts.cursor,
    });
    return this.page(res.items, res.cursor);
  }

  async listByStatus(
    cid: string,
    status: InvitationStatus,
    range: TimeRange,
    opts: { limit: number; cursor?: string; descending?: boolean; filter?: Condition },
  ) {
    const res = await queryFilled(this.table, {
      index: "GSI2",
      pk: keys.invitationsByStatus(cid, status),
      sk: rangeCondition(range),
      filter: opts.filter,
      descending: opts.descending ?? false,
      limit: opts.limit,
      cursor: opts.cursor,
    });
    return this.page(res.items, res.cursor);
  }

  async countByStatus(cid: string, status: InvitationStatus, range: TimeRange = {}, filter?: Condition) {
    return this.table.count({
      index: "GSI2",
      pk: keys.invitationsByStatus(cid, status),
      sk: rangeCondition(range),
      filter,
    });
  }

  async listCommunity(cid: string, range: TimeRange, filters: InvitationFilters, opts: { limit: number; cursor?: string; descending?: boolean }) {
    const res = await queryFilled(this.table, {
      index: "GSI3",
      pk: keys.invitationsByDate(cid),
      sk: rangeCondition(range),
      filter: buildFilter(filters),
      descending: opts.descending ?? true,
      limit: opts.limit,
      cursor: opts.cursor,
    });
    return this.page(res.items, res.cursor);
  }

  async countCommunity(cid: string, range: TimeRange, filters: InvitationFilters = {}) {
    return this.table.count({ index: "GSI3", pk: keys.invitationsByDate(cid), sk: rangeCondition(range), filter: buildFilter(filters) });
  }

  async countApartment(cid: string, apartmentId: string, range: TimeRange, filters: InvitationFilters = {}) {
    return this.table.count({
      index: "GSI1",
      pk: keys.invitationsByApartment(cid, apartmentId),
      sk: rangeCondition(range),
      filter: buildFilter(filters),
    });
  }
}
