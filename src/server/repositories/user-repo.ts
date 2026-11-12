import type { Role } from "@/shared/domain";
import type { Page, UserProfile } from "@/shared/types";
import { keys, strip } from "../db/keys";
import { cond, type Condition, type Item, queryFilled, type Table, type TxOp } from "../db/table";

export interface StoredUser extends UserProfile {
  cognitoSub: string;
}

function indexAttrs(u: StoredUser) {
  return {
    GSI1PK: keys.userBySub(u.cognitoSub),
    GSI1SK: "USER",
    GSI2PK: keys.usersByRole(u.communityId, u.role ?? "PENDING"),
    GSI2SK: `${u.fullName.toLowerCase()}#${u.userId}`,
    searchText: `${u.fullName} ${u.email} ${u.phone} ${u.apartmentLabel ?? ""}`.toLowerCase(),
  };
}

export class UserRepo {
  constructor(private readonly table: Table) {}

  private toUser(item: Item): StoredUser {
    return { ...strip<UserProfile>(item), cognitoSub: item.cognitoSub as string };
  }

  async get(cid: string, userId: string): Promise<StoredUser | null> {
    const item = await this.table.get(keys.user(cid, userId));
    return item ? this.toUser(item) : null;
  }

  /** Resolves the tenant and profile for a verified identity-provider subject. */
  async getBySub(sub: string): Promise<StoredUser | null> {
    const res = await this.table.query({ index: "GSI1", pk: keys.userBySub(sub), limit: 1 });
    return res.items[0] ? this.toUser(res.items[0]) : null;
  }

  async emailClaim(email: string): Promise<{ userId: string; communityId: string } | null> {
    const item = await this.table.get(keys.emailClaim(email));
    return item ? { userId: item.userId as string, communityId: item.communityId as string } : null;
  }

  /** Puts the user and claims the e-mail address atomically (e-mails are globally unique). */
  createOps(u: StoredUser): TxOp[] {
    return [
      { type: "put", item: { ...keys.user(u.communityId, u.userId), entity: "User", ...u, ...indexAttrs(u) }, condition: cond.notExists() },
      {
        type: "put",
        item: { ...keys.emailClaim(u.email), userId: u.userId, communityId: u.communityId },
        condition: cond.notExists(),
      },
    ];
  }

  updateOp(u: StoredUser): TxOp {
    return {
      type: "put",
      item: { ...keys.user(u.communityId, u.userId), entity: "User", ...u, ...indexAttrs(u) },
      condition: cond.exists(),
    };
  }

  async save(u: StoredUser) {
    await this.table.transact([this.updateOp(u)]);
  }

  async listByRole(cid: string, role: Role | "PENDING", opts: { status?: string; q?: string; limit: number; cursor?: string }): Promise<Page<UserProfile>> {
    const filters: Condition[] = [];
    if (opts.status) filters.push(cond.eq("status", opts.status));
    if (opts.q) filters.push(cond.contains("searchText", opts.q.toLowerCase()));
    const res = await queryFilled(this.table, {
      index: "GSI2",
      pk: keys.usersByRole(cid, role),
      filter: filters.length ? cond.and(...filters) : undefined,
      limit: opts.limit,
      cursor: opts.cursor,
    });
    return { items: res.items.map((i) => strip<UserProfile>(i)), nextCursor: res.cursor };
  }

  async countByRole(cid: string, role: Role | "PENDING", status?: string) {
    return this.table.count({
      index: "GSI2",
      pk: keys.usersByRole(cid, role),
      filter: status ? cond.eq("status", status) : undefined,
    });
  }

  async getMany(cid: string, userIds: string[]): Promise<StoredUser[]> {
    const users = await Promise.all(userIds.map((id) => this.get(cid, id)));
    return users.filter((u): u is StoredUser => u !== null);
  }
}
