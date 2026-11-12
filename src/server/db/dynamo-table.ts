import { DynamoDBClient, TransactionCanceledException, ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { ConditionFailedError } from "../errors";
import {
  type Condition,
  decodeCursor,
  encodeCursor,
  INDEX_KEYS,
  type Item,
  type Key,
  type QueryResult,
  type QuerySpec,
  type Table,
  type TableName,
  type TxOp,
  type UpdateSpec,
} from "./table";

/** Accumulates expression attribute names/values with collision-free placeholders. */
class ExpressionBuilder {
  names: Record<string, string> = {};
  values: Record<string, unknown> = {};
  private n = 0;

  name(field: string): string {
    const existing = Object.entries(this.names).find(([, v]) => v === field);
    if (existing) return existing[0];
    const ph = `#n${this.n++}`;
    this.names[ph] = field;
    return ph;
  }

  value(v: unknown): string {
    const ph = `:v${this.n++}`;
    this.values[ph] = v;
    return ph;
  }

  condition(c: Condition): string {
    switch (c.kind) {
      case "notExists":
        return `attribute_not_exists(${this.name("PK")})`;
      case "exists":
        return `attribute_exists(${this.name("PK")})`;
      case "eq":
        return c.value === null
          ? `(attribute_not_exists(${this.name(c.field)}) OR ${this.name(c.field)} = ${this.value(null)})`
          : `${this.name(c.field)} = ${this.value(c.value)}`;
      case "ne":
        return `${this.name(c.field)} <> ${this.value(c.value)}`;
      case "in":
        return `${this.name(c.field)} IN (${c.values.map((v) => this.value(v)).join(", ")})`;
      case "lt":
        return `${this.name(c.field)} < ${this.value(c.value)}`;
      case "lte":
        return `${this.name(c.field)} <= ${this.value(c.value)}`;
      case "gt":
        return `${this.name(c.field)} > ${this.value(c.value)}`;
      case "gte":
        return `${this.name(c.field)} >= ${this.value(c.value)}`;
      case "contains":
        return `contains(${this.name(c.field)}, ${this.value(c.value)})`;
      case "and":
        if (!c.all.length) {
          const pk = this.name("PK");
          return `(attribute_exists(${pk}) OR attribute_not_exists(${pk}))`;
        }
        return `(${c.all.map((x) => this.condition(x)).join(" AND ")})`;
      case "or":
        return `(${c.any.map((x) => this.condition(x)).join(" OR ")})`;
    }
  }

  update(u: UpdateSpec): string {
    const sets: string[] = [];
    for (const [k, v] of Object.entries(u.set ?? {})) {
      if (v !== undefined) sets.push(`${this.name(k)} = ${this.value(v)}`);
    }
    for (const [k, by] of Object.entries(u.increment ?? {})) {
      const n = this.name(k);
      sets.push(`${n} = if_not_exists(${n}, ${this.value(0)}) + ${this.value(by)}`);
    }
    const parts: string[] = [];
    if (sets.length) parts.push(`SET ${sets.join(", ")}`);
    if (u.remove?.length) parts.push(`REMOVE ${u.remove.map((r) => this.name(r)).join(", ")}`);
    return parts.join(" ");
  }

  attrs() {
    return {
      ...(Object.keys(this.names).length ? { ExpressionAttributeNames: this.names } : {}),
      ...(Object.keys(this.values).length ? { ExpressionAttributeValues: this.values } : {}),
    };
  }
}

export interface DynamoTableNames {
  main: string;
  audit: string;
}

/** Production adapter: the same storage contract, backed by Amazon DynamoDB. */
export class DynamoTable implements Table {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly tableNames: DynamoTableNames,
    client: DynamoDBClient = new DynamoDBClient({}),
  ) {
    this.doc = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: false },
    });
  }

  private name(table: TableName = "main") {
    return this.tableNames[table];
  }

  async get(key: Key, table?: TableName) {
    const res = await this.doc.send(new GetCommand({ TableName: this.name(table), Key: key, ConsistentRead: true }));
    return (res.Item as Item | undefined) ?? null;
  }

  async put(item: Item, condition?: Condition, table?: TableName) {
    const b = new ExpressionBuilder();
    const ConditionExpression = condition ? b.condition(condition) : undefined;
    await this.guard(() => this.doc.send(new PutCommand({ TableName: this.name(table), Item: item, ConditionExpression, ...b.attrs() })));
  }

  async update(key: Key, update: UpdateSpec, condition?: Condition, table?: TableName) {
    const b = new ExpressionBuilder();
    const UpdateExpression = b.update(update);
    const ConditionExpression = condition ? b.condition(condition) : undefined;
    const res = await this.guard(() =>
      this.doc.send(
        new UpdateCommand({
          TableName: this.name(table),
          Key: key,
          UpdateExpression,
          ConditionExpression,
          ReturnValues: "ALL_NEW",
          ...b.attrs(),
        }),
      ),
    );
    return res.Attributes as Item;
  }

  async delete(key: Key, condition?: Condition, table?: TableName) {
    const b = new ExpressionBuilder();
    const ConditionExpression = condition ? b.condition(condition) : undefined;
    await this.guard(() => this.doc.send(new DeleteCommand({ TableName: this.name(table), Key: key, ConditionExpression, ...b.attrs() })));
  }

  private buildQuery(spec: QuerySpec) {
    const b = new ExpressionBuilder();
    const pkAttr = spec.index ? INDEX_KEYS[spec.index].pk : "PK";
    const skAttr = spec.index ? INDEX_KEYS[spec.index].sk : "SK";
    let keyExpr = `${b.name(pkAttr)} = ${b.value(spec.pk)}`;
    const c = spec.sk;
    if (c) {
      const sk = b.name(skAttr);
      if ("beginsWith" in c) keyExpr += ` AND begins_with(${sk}, ${b.value(c.beginsWith)})`;
      else if ("between" in c) keyExpr += ` AND ${sk} BETWEEN ${b.value(c.between[0])} AND ${b.value(c.between[1])}`;
      else if ("gte" in c) keyExpr += ` AND ${sk} >= ${b.value(c.gte)}`;
      else keyExpr += ` AND ${sk} <= ${b.value(c.lte)}`;
    }
    const FilterExpression = spec.filter ? b.condition(spec.filter) : undefined;
    return { b, keyExpr, FilterExpression, pkAttr };
  }

  async query(spec: QuerySpec): Promise<QueryResult> {
    const { b, keyExpr, FilterExpression, pkAttr } = this.buildQuery(spec);
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.name(spec.table),
        IndexName: spec.index,
        KeyConditionExpression: keyExpr,
        FilterExpression,
        Limit: spec.limit,
        ScanIndexForward: !spec.descending,
        ExclusiveStartKey: spec.cursor ? decodeCursor(spec.cursor, pkAttr, spec.pk) : undefined,
        ...b.attrs(),
      }),
    );
    return {
      items: (res.Items as Item[] | undefined) ?? [],
      cursor: res.LastEvaluatedKey ? encodeCursor(res.LastEvaluatedKey) : null,
    };
  }

  async count(spec: Omit<QuerySpec, "limit" | "cursor">) {
    const { b, keyExpr, FilterExpression } = this.buildQuery(spec);
    let total = 0;
    let start: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.name(spec.table),
          IndexName: spec.index,
          KeyConditionExpression: keyExpr,
          FilterExpression,
          Select: "COUNT",
          ExclusiveStartKey: start,
          ...b.attrs(),
        }),
      );
      total += res.Count ?? 0;
      start = res.LastEvaluatedKey;
    } while (start);
    return total;
  }

  async transact(ops: TxOp[]) {
    const TransactItems: NonNullable<TransactWriteCommandInput["TransactItems"]> = ops.map((op) => {
      const b = new ExpressionBuilder();
      const TableName = this.name(op.table);
      switch (op.type) {
        case "put": {
          const ConditionExpression = op.condition ? b.condition(op.condition) : undefined;
          return { Put: { TableName, Item: op.item, ConditionExpression, ...b.attrs() } };
        }
        case "update": {
          const UpdateExpression = b.update(op.update);
          const ConditionExpression = op.condition ? b.condition(op.condition) : undefined;
          return { Update: { TableName, Key: op.key, UpdateExpression, ConditionExpression, ...b.attrs() } };
        }
        case "delete": {
          const ConditionExpression = op.condition ? b.condition(op.condition) : undefined;
          return { Delete: { TableName, Key: op.key, ConditionExpression, ...b.attrs() } };
        }
        case "check": {
          const ConditionExpression = b.condition(op.condition);
          return { ConditionCheck: { TableName, Key: op.key, ConditionExpression, ...b.attrs() } };
        }
      }
    });
    await this.guard(() => this.doc.send(new TransactWriteCommand({ TransactItems })));
  }

  /** Maps DynamoDB condition failures onto the storage-neutral ConditionFailedError. */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) throw new ConditionFailedError(0);
      if (err instanceof TransactionCanceledException) {
        const idx = err.CancellationReasons?.findIndex((r) => r.Code === "ConditionalCheckFailed") ?? -1;
        if (idx >= 0) throw new ConditionFailedError(idx);
      }
      throw err;
    }
  }
}
