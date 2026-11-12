import { GetObjectCommand, ListObjectVersionsCommand, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, describe, expect, it } from "vitest";
import { S3AuditAnchorStore } from "@/server/adapters/aws";
import { mapCognitoError } from "@/server/auth/gateway";
import { CognitoTokenVerifier } from "@/server/auth/tokens";
import { clientIp } from "@/server/bff";

describe("Cognito trigger cold start", () => {
  it("constructs the token verifier with a placeholder pool id (triggers never verify tokens)", () => {
    expect(() => new CognitoTokenVerifier("not-used-by-triggers", "not-used-by-triggers")).not.toThrow();
  });

  it("rejects malformed tokens with 401 without any network call", async () => {
    const v = new CognitoTokenVerifier("ap-south-1_AbCdEf123", "client");
    await expect(v.verify("not.a.jwt")).rejects.toMatchObject({ status: 401 });
  });

  it("maps a pre-sign-up rejection to a field error instead of 'service unavailable'", () => {
    const err = Object.assign(new Error("PreSignUp failed with error Unknown community code."), { name: "UserLambdaValidationException" });
    expect(mapCognitoError(err)).toMatchObject({ status: 400, details: { joinCode: ["Unknown community code"] } });
  });
});

describe("client IP for rate limiting", () => {
  const req = (xff?: string) => new Request("https://app.example", { headers: xff ? { "x-forwarded-for": xff } : {} });
  it("ignores client-supplied X-Forwarded-For entries", () => {
    expect(clientIp(req("1.1.1.1, 203.0.113.9"), 1)).toBe("203.0.113.9");
    expect(clientIp(req("1.1.1.1, 2.2.2.2, 203.0.113.9, 10.0.0.1"), 2)).toBe("203.0.113.9");
  });
  it("does not trust the header at all when no proxy is configured", () => {
    expect(clientIp(req("1.1.1.1"), 0)).toBe("direct");
    expect(clientIp(req(), 1)).toBe("direct");
  });
});

describe("S3 audit anchor store", () => {
  const s3 = mockClient(S3Client);
  afterEach(() => s3.reset());
  const store = () => new S3AuditAnchorStore("anchors-bucket", new S3Client({ region: "ap-south-1" }));
  const anchor = { communityId: "c1", seq: 42, hash: "abc", anchoredAt: "2026-01-01T00:00:00Z" };

  it("creates anchors with If-None-Match so it never overwrites one", async () => {
    s3.on(PutObjectCommand).resolves({});
    await store().put(anchor);
    const input = s3.commandCalls(PutObjectCommand)[0]!.args[0].input;
    expect(input).toMatchObject({ Bucket: "anchors-bucket", Key: "anchors/c1/000000000042.json", IfNoneMatch: "*" });
  });

  it("treats 412 (already anchored) as success and surfaces other errors", async () => {
    s3.on(PutObjectCommand).rejects(
      new S3ServiceException({ name: "PreconditionFailed", $fault: "client", $metadata: { httpStatusCode: 412 }, message: "exists" }),
    );
    await expect(store().put(anchor)).resolves.toBeUndefined();
    s3.on(PutObjectCommand).rejects(new S3ServiceException({ name: "AccessDenied", $fault: "client", $metadata: { httpStatusCode: 403 }, message: "no" }));
    await expect(store().put(anchor)).rejects.toThrow();
  });

  it("reads every object version so an overwrite appears as a conflicting anchor", async () => {
    s3.on(ListObjectVersionsCommand).resolves({
      Versions: [
        { Key: "anchors/c1/000000000042.json", VersionId: "v2" },
        { Key: "anchors/c1/000000000042.json", VersionId: "v1" },
      ],
      IsTruncated: false,
    });
    const body = (hash: string) => ({ transformToString: async () => JSON.stringify({ ...anchor, hash }) }) as never;
    s3.on(GetObjectCommand, { VersionId: "v1" }).resolves({ Body: body("abc") });
    s3.on(GetObjectCommand, { VersionId: "v2" }).resolves({ Body: body("forged") });
    const list = await store().list("c1");
    expect(list.map((a) => a.hash).sort()).toEqual(["abc", "forged"]);
  });
});
