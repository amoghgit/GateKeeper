import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ConditionFailedError } from "../errors";
import {
  type Condition,
  decodeCursor,
  encodeCursor,
  INDEX_KEYS,
  type Item,
  type Key,
  keyOf,
  type QueryResult,
  type QuerySpec,
  type Table,
  type TableName,
  type TxOp,
  type UpdateSpec,
} from "./table";

type Store = Record<TableName, Map<string, Item>>;

const keyString = (k: Key) => `${k.PK}\u0000${k.SK}`;

export function evaluate(condition: Condition | undefined, item: Item | null): boolean {
  if (!condition) return true;
  const value = (field: string) => (item ? item[field] : undefined);
  switch (condition.kind) {
    case "notExists":
      return item === null;
    case "exists":
      return item !== null;
    case "eq":
      return condition.value === null ? value(condition.field) === null : value(condition.field) === condition.value;
    case "ne":
      return value(condition.field) !== condition.value;
    case "in":
      return condition.values.includes(value(condition.field) as never);
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const v = value(condition.field);
      if (v === undefined || v === null || typeof v !== typeof condition.value) return false;
      const a = v as string | number;
      const b = condition.value;
      if (condition.kind === "lt") return a < b;
      if (condition.kind === "lte") return a <= b;
      if (condition.kind === "gt") return a > b;
      return a >= b;
    }
    case "contains": {
      const v = value(condition.field);
      return typeof v === "string" && v.includes(condition.value);
    }
    case "and":
      return condition.all.every((c) => evaluate(c, item));
    case "or":
      return condition.any.some((c) => evaluate(c, item));
  }
}

function applyUpdate(existing: Item | null, key: Key, update: UpdateSpec): Item {
  const next: Item = existing ? structuredClone(existing) : { PK: key.PK, SK: key.SK };
  for (const [k, v] of Object.entries(update.set ?? {})) if (v !== undefined) next[k] = structuredClone(v);
  for (const k of update.remove ?? []) delete next[k];
  for (const [k, by] of Object.entries(update.increment ?? {})) next[k] = ((next[k] as number | undefined) ?? 0) + by;
  return next;
}

/**
 * In-process emulation of the DynamoDB table used for LOCAL_DEMO and tests.
 * All operations are synchronous internally, so conditional writes and
 * transactions are atomic within a single Node.js process.
 */
export class MemoryTable implements Table {
  private store: Store = { main: new Map(), audit: new Map() };
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly persistPath?: string) {
    if (persistPath && existsSync(persistPath)) {
      const raw = JSON.parse(readFileSync(persistPath, "utf8")) as Record<TableName, Item[]>;
      for (const name of ["main", "audit"] as const) {
        for (const item of raw[name] ?? []) this.store[name].set(keyString(item), item);
      }
    }
  }

  get isEmpty(): boolean {
    return this.store.main.size === 0;
  }

  async get(key: Key, table: TableName = "main") {
    const item = this.store[table].get(keyString(key));
    return item ? structuredClone(item) : null;
  }

  async put(item: Item, condition?: Condition, table: TableName = "main") {
    await this.transact([{ type: "put", item, condition, table }]);
  }

  async update(key: Key, update: UpdateSpec, condition?: Condition, table: TableName = "main") {
    await this.transact([{ type: "update", key, update, condition, table }]);
    return (await this.get(key, table))!;
  }

  async delete(key: Key, condition?: Condition, table: TableName = "main") {
    await this.transact([{ type: "delete", key, condition, table }]);
  }

  async transact(ops: TxOp[]) {
    // Validate every condition first, then apply — all or nothing.
    ops.forEach((op, i) => {
      const key = op.type === "put" ? op.item : op.key;
      const current = this.store[op.table ?? "main"].get(keyString(key)) ?? null;
      if (!evaluate(op.condition, current)) throw new ConditionFailedError(i);
    });
    for (const op of ops) {
      const map = this.store[op.table ?? "main"];
      if (op.type === "put") map.set(keyString(op.item), structuredClone(op.item));
      else if (op.type === "update") map.set(keyString(op.key), applyUpdate(map.get(keyString(op.key)) ?? null, op.key, op.update));
      else if (op.type === "delete") map.delete(keyString(op.key));
    }
    if (ops.some((o) => o.type !== "check")) this.scheduleFlush();
  }

  private matching(spec: QuerySpec): Item[] {
    const pkAttr = spec.index ? INDEX_KEYS[spec.index].pk : "PK";
    const skAttr = spec.index ? INDEX_KEYS[spec.index].sk : "SK";
    const out: Item[] = [];
    for (const item of this.store[spec.table ?? "main"].values()) {
      if (item[pkAttr] !== spec.pk) continue;
      const sk = item[skAttr];
      if (typeof sk !== "string") continue;
      const c = spec.sk;
      if (c) {
        if ("beginsWith" in c && !sk.startsWith(c.beginsWith)) continue;
        if ("between" in c && (sk < c.between[0] || sk > c.between[1])) continue;
        if ("gte" in c && sk < c.gte) continue;
        if ("lte" in c && sk > c.lte) continue;
      }
      out.push(item);
    }
    out.sort((a, b) => {
      const x = a[skAttr] as string;
      const y = b[skAttr] as string;
      if (x !== y) return x < y ? -1 : 1;
      return a.SK < b.SK ? -1 : a.SK > b.SK ? 1 : 0;
    });
    if (spec.descending) out.reverse();
    return out;
  }

  async query(spec: QuerySpec): Promise<QueryResult> {
    let all = this.matching(spec);
    if (spec.cursor) {
      const pkAttr = spec.index ? INDEX_KEYS[spec.index].pk : "PK";
      const start = decodeCursor(spec.cursor, pkAttr, spec.pk);
      const idx = all.findIndex((i) => i.PK === start.PK && i.SK === start.SK);
      all = idx >= 0 ? all.slice(idx + 1) : [];
    }
    // Like DynamoDB, `limit` bounds items *evaluated*, before the filter.
    const limit = spec.limit ?? 1000;
    const page = all.slice(0, limit);
    const more = all.length > limit;
    const items = page.filter((i) => evaluate(spec.filter, i)).map((i) => structuredClone(i));
    const last = page[page.length - 1];
    return { items, cursor: more && last ? encodeCursor(keyOf(last, spec.index)) : null };
  }

  async count(spec: Omit<QuerySpec, "limit" | "cursor">) {
    return this.matching(spec).filter((i) => evaluate(spec.filter, i)).length;
  }

  /** Clears every item (tests and demo reset). */
  reset() {
    this.store = { main: new Map(), audit: new Map() };
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (!this.persistPath || this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), 75);
    this.flushTimer.unref?.();
  }

  flush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.persistPath) return;
    mkdirSync(dirname(this.persistPath), { recursive: true });
    const tmp = `${this.persistPath}.tmp`;
    writeFileSync(tmp, JSON.stringify({ main: [...this.store.main.values()], audit: [...this.store.audit.values()] }));
    renameSync(tmp, this.persistPath);
  }
}
