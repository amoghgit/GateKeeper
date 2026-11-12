/**
 * Storage port modelled on DynamoDB single-table semantics.
 *
 * Repositories depend only on this interface. Two adapters implement it:
 *  - MemoryTable  (LOCAL_DEMO / tests) — emulates keys, GSIs, conditions and
 *    transactions in-process, optionally persisted to a JSON file.
 *  - DynamoTable  (AWS_PRODUCTION) — compiles the same specs into DynamoDB
 *    KeyConditionExpression / ConditionExpression / TransactWriteItems.
 */

export type TableName = "main" | "audit";
export type IndexName = "GSI1" | "GSI2" | "GSI3";

export interface Key {
  PK: string;
  SK: string;
}

export type Item = Key & Record<string, unknown>;

export type Scalar = string | number | boolean;

export type Condition =
  | { kind: "notExists" }
  | { kind: "exists" }
  | { kind: "eq"; field: string; value: Scalar | null }
  | { kind: "ne"; field: string; value: Scalar | null }
  | { kind: "in"; field: string; values: Scalar[] }
  | { kind: "lt" | "lte" | "gt" | "gte"; field: string; value: string | number }
  | { kind: "contains"; field: string; value: string }
  | { kind: "and"; all: Condition[] }
  | { kind: "or"; any: Condition[] };

export const cond = {
  notExists: (): Condition => ({ kind: "notExists" }),
  exists: (): Condition => ({ kind: "exists" }),
  eq: (field: string, value: Scalar | null): Condition => ({ kind: "eq", field, value }),
  ne: (field: string, value: Scalar | null): Condition => ({ kind: "ne", field, value }),
  in: (field: string, values: Scalar[]): Condition => ({ kind: "in", field, values }),
  lt: (field: string, value: string | number): Condition => ({ kind: "lt", field, value }),
  lte: (field: string, value: string | number): Condition => ({ kind: "lte", field, value }),
  gt: (field: string, value: string | number): Condition => ({ kind: "gt", field, value }),
  gte: (field: string, value: string | number): Condition => ({ kind: "gte", field, value }),
  contains: (field: string, value: string): Condition => ({ kind: "contains", field, value }),
  and: (...all: (Condition | undefined)[]): Condition => ({
    kind: "and",
    all: all.filter((c): c is Condition => Boolean(c)),
  }),
  or: (...any: Condition[]): Condition => ({ kind: "or", any }),
};

export interface UpdateSpec {
  /** Attributes to set. `undefined` values are ignored; use `remove` to delete. */
  set?: Record<string, unknown>;
  remove?: string[];
  increment?: Record<string, number>;
}

export type SortKeyCondition = { beginsWith: string } | { between: [string, string] } | { gte: string } | { lte: string };

export interface QuerySpec {
  table?: TableName;
  index?: IndexName;
  pk: string;
  sk?: SortKeyCondition;
  filter?: Condition;
  limit?: number;
  cursor?: string;
  descending?: boolean;
}

export interface QueryResult {
  items: Item[];
  cursor: string | null;
}

export type TxOp =
  | { type: "put"; table?: TableName; item: Item; condition?: Condition }
  | { type: "update"; table?: TableName; key: Key; update: UpdateSpec; condition?: Condition }
  | { type: "delete"; table?: TableName; key: Key; condition?: Condition }
  | { type: "check"; table?: TableName; key: Key; condition: Condition };

export interface Table {
  get(key: Key, table?: TableName): Promise<Item | null>;
  put(item: Item, condition?: Condition, table?: TableName): Promise<void>;
  /** Returns the full item after the update. Throws ConditionFailedError. */
  update(key: Key, update: UpdateSpec, condition?: Condition, table?: TableName): Promise<Item>;
  delete(key: Key, condition?: Condition, table?: TableName): Promise<void>;
  query(spec: QuerySpec): Promise<QueryResult>;
  count(spec: Omit<QuerySpec, "limit" | "cursor">): Promise<number>;
  /** All-or-nothing. Throws ConditionFailedError identifying the failing op. */
  transact(ops: TxOp[]): Promise<void>;
}

export const INDEX_KEYS: Record<IndexName, { pk: string; sk: string }> = {
  GSI1: { pk: "GSI1PK", sk: "GSI1SK" },
  GSI2: { pk: "GSI2PK", sk: "GSI2SK" },
  GSI3: { pk: "GSI3PK", sk: "GSI3SK" },
};

export function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

/** Decodes a pagination cursor, rejecting cursors that point at another partition. */
export function decodeCursor(cursor: string, expectedPkAttr: string, expectedPk: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new InvalidCursorError();
  }
  if (!parsed || typeof parsed !== "object" || (parsed as Record<string, unknown>)[expectedPkAttr] !== expectedPk) {
    throw new InvalidCursorError();
  }
  return parsed as Record<string, unknown>;
}

export class InvalidCursorError extends Error {
  constructor() {
    super("Invalid pagination cursor");
    this.name = "InvalidCursorError";
  }
}

/**
 * Pages through a filtered query until `limit` matches are collected, so callers
 * are not handed short pages when a FilterExpression discards items.
 */
export async function queryFilled(table: Table, spec: QuerySpec, maxRounds = 8): Promise<QueryResult> {
  const want = spec.limit ?? 20;
  if (!spec.filter) return table.query({ ...spec, limit: want });
  const items: Item[] = [];
  let cursor = spec.cursor;
  for (let round = 0; round < maxRounds; round++) {
    const res = await table.query({ ...spec, cursor, limit: Math.max(want * 3, 50) });
    for (const item of res.items) {
      items.push(item);
      if (items.length === want) {
        const last = items[items.length - 1]!;
        return { items, cursor: encodeCursor(keyOf(last, spec.index)) };
      }
    }
    if (!res.cursor) return { items, cursor: null };
    cursor = res.cursor;
  }
  return { items, cursor: cursor ?? null };
}

/** The key attributes DynamoDB would return as LastEvaluatedKey for an item. */
export function keyOf(item: Item, index?: IndexName): Record<string, unknown> {
  const key: Record<string, unknown> = { PK: item.PK, SK: item.SK };
  if (index) {
    const k = INDEX_KEYS[index];
    key[k.pk] = item[k.pk];
    key[k.sk] = item[k.sk];
  }
  return key;
}
