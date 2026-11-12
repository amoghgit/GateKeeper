import { ConditionalCheckFailedException, DynamoDBClient, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigurationError, loadConfig } from "@/server/config";
import { DynamoTable } from "@/server/db/dynamo-table";
import { MemoryTable } from "@/server/db/memory-table";
import { cond, encodeCursor, InvalidCursorError, queryFilled } from "@/server/db/table";
import { ConditionFailedError } from "@/server/errors";

describe("MemoryTable (DynamoDB emulation)", () => {
  it("enforces conditional writes", async () => {
    const t = new MemoryTable();
    await t.put({ PK: "a", SK: "1", v: 1 }, cond.notExists());
    await expect(t.put({ PK: "a", SK: "1", v: 2 }, cond.notExists())).rejects.toBeInstanceOf(ConditionFailedError);
    await expect(t.update({ PK: "a", SK: "1" }, { set: { v: 3 } }, cond.eq("v", 99))).rejects.toBeInstanceOf(ConditionFailedError);
    expect((await t.update({ PK: "a", SK: "1" }, { set: { v: 3 }, increment: { n: 2 } }, cond.eq("v", 1))).n).toBe(2);
  });

  it("applies transactions all-or-nothing", async () => {
    const t = new MemoryTable();
    await t.put({ PK: "a", SK: "1" });
    await expect(
      t.transact([
        { type: "put", item: { PK: "b", SK: "1" } },
        { type: "put", item: { PK: "a", SK: "1" }, condition: cond.notExists() },
      ]),
    ).rejects.toMatchObject({ failedIndex: 1 });
    expect(await t.get({ PK: "b", SK: "1" })).toBeNull();
  });

  it("queries with sort-key ranges, GSIs and descending order", async () => {
    const t = new MemoryTable();
    for (const sk of ["A#1", "A#2", "B#1"]) await t.put({ PK: "p", SK: sk, GSI1PK: "g", GSI1SK: sk.split("").reverse().join("") });
    expect((await t.query({ pk: "p", sk: { beginsWith: "A#" } })).items.map((i) => i.SK)).toEqual(["A#1", "A#2"]);
    expect((await t.query({ pk: "p", descending: true, limit: 1 })).items[0]!.SK).toBe("B#1");
    expect((await t.query({ index: "GSI1", pk: "g" })).items).toHaveLength(3);
  });

  it("paginates and fills filtered pages", async () => {
    const t = new MemoryTable();
    for (let i = 0; i < 30; i++) await t.put({ PK: "p", SK: String(i).padStart(2, "0"), even: i % 2 === 0 });
    const first = await queryFilled(t, { pk: "p", filter: cond.eq("even", true), limit: 5 });
    expect(first.items).toHaveLength(5);
    const second = await queryFilled(t, { pk: "p", filter: cond.eq("even", true), limit: 5, cursor: first.cursor! });
    expect(second.items[0]!.SK).toBe("10");
  });

  it("rejects cursors that point at another partition (tenant isolation)", async () => {
    const t = new MemoryTable();
    await t.put({ PK: "C#tenant-a", SK: "1" });
    const forged = encodeCursor({ PK: "C#tenant-b", SK: "1" });
    await expect(t.query({ pk: "C#tenant-a", cursor: forged })).rejects.toBeInstanceOf(InvalidCursorError);
  });
});

describe("DynamoTable (AWS SDK v3, mocked)", () => {
  const ddb = mockClient(DynamoDBDocumentClient);
  afterEach(() => ddb.reset());
  const table = () => new DynamoTable({ main: "Main", audit: "Audit" }, new DynamoDBClient({ region: "us-east-1" }));

  it("compiles conditions into ConditionExpression", async () => {
    ddb.on(PutCommand).resolves({});
    await table().put({ PK: "a", SK: "b" }, cond.and(cond.notExists(), cond.in("status", ["X", "Y"])));
    const input = ddb.commandCalls(PutCommand)[0]!.args[0].input;
    expect(input.TableName).toBe("Main");
    expect(input.ConditionExpression).toMatch(/attribute_not_exists\(#n\d\) AND #n\d IN \(:v\d, :v\d\)/);
    expect(Object.values(input.ExpressionAttributeValues!)).toEqual(["X", "Y"]);
  });

  it("maps conditional failures to ConditionFailedError", async () => {
    ddb.on(UpdateCommand).rejects(new ConditionalCheckFailedException({ message: "no", $metadata: {} }));
    await expect(table().update({ PK: "a", SK: "b" }, { set: { x: 1 } }, cond.exists())).rejects.toBeInstanceOf(ConditionFailedError);
    ddb
      .on(TransactWriteCommand)
      .rejects(new TransactionCanceledException({ message: "no", $metadata: {}, CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }] }));
    await expect(
      table().transact([
        { type: "put", item: { PK: "a", SK: "b" } },
        { type: "check", key: { PK: "x", SK: "y" }, condition: cond.exists() },
      ]),
    ).rejects.toMatchObject({ failedIndex: 1 });
  });

  it("routes audit writes to the audit table and builds key conditions", async () => {
    ddb.on(TransactWriteCommand).resolves({});
    ddb.on(QueryCommand).resolves({ Items: [], LastEvaluatedKey: undefined });
    await table().transact([{ type: "put", table: "audit", item: { PK: "C#1", SK: "000000000001" } }]);
    expect(ddb.commandCalls(TransactWriteCommand)[0]!.args[0].input.TransactItems![0]!.Put!.TableName).toBe("Audit");
    await table().query({ index: "GSI2", pk: "x", sk: { between: ["a", "b"] }, descending: true, limit: 5 });
    const q = ddb.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(q.IndexName).toBe("GSI2");
    expect(q.KeyConditionExpression).toContain("BETWEEN");
    expect(q.ScanIndexForward).toBe(false);
  });
});

describe("configuration", () => {
  it("never silently falls back to demo mode in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toThrow(ConfigurationError);
    expect(() => loadConfig({ GATEKEEPER_MODE: "AWS_PRODUCTION" } as unknown as NodeJS.ProcessEnv)).toThrow(/missing or has invalid settings/);
    expect(() => loadConfig({ GATEKEEPER_MODE: "staging" } as unknown as NodeJS.ProcessEnv)).toThrow(ConfigurationError);
  });
  it("loads an explicit demo configuration", () => {
    expect(loadConfig({ GATEKEEPER_MODE: "LOCAL_DEMO", DEMO_DATA_FILE: "memory" } as unknown as NodeJS.ProcessEnv)).toMatchObject({
      mode: "LOCAL_DEMO",
      dataFile: null,
    });
  });
});
