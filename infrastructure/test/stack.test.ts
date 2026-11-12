import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { GateKeeperStack } from "../lib/gatekeeper-stack";

let template: Template;
beforeAll(() => {
  const app = new App();
  template = Template.fromStack(new GateKeeperStack(app, "Test", { stage: "dev", appOrigin: "https://app.example.com" }));
}, 120_000);

type Statement = { Effect: "Allow" | "Deny"; Action: string | string[]; Resource?: unknown; NotResource?: unknown };
function statementsFor(t: Template, logicalIdPrefix: string): Statement[] {
  return Object.entries(t.findResources("AWS::IAM::Policy"))
    .filter(([id]) => id.startsWith(logicalIdPrefix))
    .flatMap(([, p]) => (p as { Properties: { PolicyDocument: { Statement: Statement[] } } }).Properties.PolicyDocument.Statement);
}
const actions = (s: Statement) => (Array.isArray(s.Action) ? s.Action : [s.Action]);
/** Allowed actions only — Deny statements are not grants. */
function policyActionsFor(logicalIdPrefix: string, t: Template = template): string[] {
  return statementsFor(t, logicalIdPrefix)
    .filter((s) => s.Effect === "Allow")
    .flatMap(actions);
}

describe("GateKeeper stack", () => {
  it("creates no always-on or expensive infrastructure", () => {
    for (const type of ["AWS::EC2::Instance", "AWS::RDS::DBInstance", "AWS::EC2::NatGateway", "AWS::ElasticLoadBalancingV2::LoadBalancer"]) {
      template.resourceCountIs(type, 0);
    }
  });

  it("uses on-demand, encrypted DynamoDB tables with TTL", () => {
    template.resourceCountIs("AWS::DynamoDB::GlobalTable", 2);
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      BillingMode: "PAY_PER_REQUEST",
      TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
      SSESpecification: { SSEEnabled: true },
      GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: "GSI3" })]),
    });
  });

  it("blocks all public access to the uploads bucket and enforces TLS", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
      CorsConfiguration: { CorsRules: [Match.objectLike({ AllowedOrigins: ["https://app.example.com"] })] },
    });
    template.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Effect: "Deny", Condition: { Bool: { "aws:SecureTransport": "false" } } })]) },
    });
  });

  it("creates Cognito groups and a secretless client with password auth", () => {
    template.resourceCountIs("AWS::Cognito::UserPoolGroup", 3);
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", { GenerateSecret: false, PreventUserExistenceErrors: "ENABLED" });
  });

  it("grants Cognito admin rights only to the admin API function", () => {
    expect(policyActionsFor("ApiAdmin")).toEqual(expect.arrayContaining(["cognito-idp:AdminCreateUser"]));
    expect(policyActionsFor("ApiCore").some((a) => a.startsWith("cognito-idp:"))).toBe(false);
    expect(policyActionsFor("ApiSecurity").some((a) => a.startsWith("cognito-idp:"))).toBe(false);
    expect(policyActionsFor("ApiSecurity")).toEqual(expect.arrayContaining(["s3:PutObject"]));
    expect(policyActionsFor("ApiCore").some((a) => a.startsWith("s3:"))).toBe(false);
  });

  it("never allows update or delete on the audit table, and explicitly denies it for every function", () => {
    const fns = ["ApiCore", "ApiSecurity", "ApiAdmin", "Jobs", "CognitoTriggers", "CognitoPreSignUp"];
    for (const fn of fns) {
      const stmts = statementsFor(template, fn);
      for (const s of stmts.filter((x) => x.Effect === "Allow" && JSON.stringify(x.Resource).includes("AuditTable"))) {
        expect(actions(s)).not.toEqual(expect.arrayContaining(["dynamodb:DeleteItem"]));
        expect(actions(s)).not.toEqual(expect.arrayContaining(["dynamodb:UpdateItem"]));
        expect(actions(s)).not.toEqual(expect.arrayContaining(["dynamodb:BatchWriteItem"]));
      }
      const deny = stmts.find((x) => x.Effect === "Deny" && JSON.stringify(x.Resource).includes("AuditTable"));
      expect(deny, fn).toBeDefined();
      expect(actions(deny!)).toEqual(expect.arrayContaining(["dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:BatchWriteItem"]));
    }
  });

  it("anchors the audit chain in an Object Lock bucket nobody in the app can delete from", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      ObjectLockEnabled: true,
      ObjectLockConfiguration: { ObjectLockEnabled: "Enabled", Rule: { DefaultRetention: { Mode: "GOVERNANCE", Days: 400 } } },
      VersioningConfiguration: { Status: "Enabled" },
    });
    for (const fn of ["ApiCore", "ApiSecurity", "ApiAdmin", "Jobs"]) {
      const allowed = policyActionsFor(fn);
      for (const a of ["s3:DeleteObject", "s3:DeleteObjectVersion", "s3:BypassGovernanceRetention", "s3:PutObjectRetention"]) expect(allowed).not.toContain(a);
      expect(statementsFor(template, fn).some((s) => s.Effect === "Deny" && actions(s).includes("s3:BypassGovernanceRetention"))).toBe(true);
    }
    expect(policyActionsFor("Jobs")).toContain("s3:PutObject");
    expect(policyActionsFor("ApiAdmin")).toEqual(expect.arrayContaining(["s3:GetObjectVersion", "s3:ListBucketVersions"]));
  });

  it("limits the pre-sign-up trigger to reads and drops unused DynamoDB actions everywhere", () => {
    const pre = policyActionsFor("CognitoPreSignUp").filter((a) => a.startsWith("dynamodb:"));
    expect(new Set(pre)).toEqual(new Set(["dynamodb:GetItem", "dynamodb:Query"]));
    for (const fn of ["ApiCore", "ApiSecurity", "ApiAdmin", "Jobs", "CognitoTriggers"]) {
      const a = policyActionsFor(fn);
      expect(a).not.toContain("dynamodb:BatchWriteItem");
      expect(a).not.toContain("dynamodb:GetRecords");
      expect(a).not.toContain("dynamodb:Scan");
    }
    expect(policyActionsFor("CognitoTriggers").some((a) => a.startsWith("s3:"))).toBe(false);
  });

  it("allows SMS only to phone numbers (never other topics) when enabled", () => {
    const smsTemplate = Template.fromStack(new GateKeeperStack(new App(), "Sms", { stage: "dev", appOrigin: "https://app.example.com", smsEnabled: true }));
    const sms = statementsFor(smsTemplate, "ApiCore").find((s) => s.NotResource !== undefined)!;
    expect(sms).toMatchObject({ Effect: "Allow", Action: "sns:Publish" });
    expect(JSON.stringify(sms.NotResource)).toContain(":sns:*:*:*");
    expect(statementsFor(template, "ApiCore").some((s) => s.NotResource !== undefined)).toBe(false);
  });

  it("protects routes with a JWT authorizer, throttles the stage and schedules jobs", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", { AuthorizerType: "JWT" });
    const routes = template.findResources("AWS::ApiGatewayV2::Route");
    for (const r of Object.values(routes)) expect((r as { Properties: { AuthorizationType: string } }).Properties.AuthorizationType).toBe("JWT");
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", { DefaultRouteSettings: { ThrottlingRateLimit: 50, ThrottlingBurstLimit: 100 } });
    template.resourceCountIs("AWS::Events::Rule", 6);
  });

  it("restricts API CORS to the app origin and keeps Lambda timeouts within API Gateway's limit", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", { CorsConfiguration: Match.objectLike({ AllowOrigins: ["https://app.example.com"] }) });
    const fns = template.findResources("AWS::Lambda::Function");
    const api = Object.entries(fns).filter(([id]) => /^Api(Core|Security|Admin)/.test(id));
    expect(api).toHaveLength(3);
    for (const [, f] of api) expect((f as { Properties: { Timeout: number } }).Properties.Timeout).toBeLessThanOrEqual(29);
    const jobs = Object.entries(fns).find(([id]) => id.startsWith("Jobs"))!;
    expect((jobs[1] as { Properties: { Timeout: number } }).Properties.Timeout).toBe(300);
  });

  it("sets log retention and tags resources", () => {
    template.allResourcesProperties("AWS::Logs::LogGroup", { RetentionInDays: 30 });
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      Replicas: [Match.objectLike({ Tags: Match.arrayWith([{ Key: "Project", Value: "GateKeeper" }]) })],
    });
  });
});
