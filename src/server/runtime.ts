/**
 * Composition root. Builds exactly one runtime per process for the configured
 * mode. AWS_PRODUCTION never falls back to demo adapters: if configuration or
 * secrets are missing, initialisation throws.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { CognitoIdentityAdmin, loadSecretsFromSsm, S3AuditAnchorStore, S3FileStorage, SnsNotifier } from "./adapters/aws";
import { DemoAuditAnchorStore, DemoCredentialStore, DemoFileStorage, DemoIdentityAdmin, DemoNotifier, DemoOutbox } from "./adapters/demo";
import { type AuthGateway, CognitoAuthGateway, DemoAuthGateway } from "./auth/gateway";
import { CognitoTokenVerifier, DemoTokenService, type TokenVerifier } from "./auth/tokens";
import { type AppConfig, loadConfig } from "./config";
import { DynamoTable } from "./db/dynamo-table";
import { MemoryTable } from "./db/memory-table";
import { type Deps, jsonLogger } from "./ports";
import { createServices, type Services } from "./services";

export interface Runtime {
  config: AppConfig;
  deps: Deps;
  services: Services;
  verifier: TokenVerifier;
  auth: AuthGateway;
  /** Present only in LOCAL_DEMO. */
  demo: { table: MemoryTable; outbox: DemoOutbox; uploadSecret: string } | null;
}

export async function buildDemoRuntime(
  config: Extract<AppConfig, { mode: "LOCAL_DEMO" }>,
  options: { seed?: boolean; clock?: () => Date; fresh?: boolean } = {},
): Promise<Runtime> {
  const table = new MemoryTable(config.dataFile ?? undefined);
  // A reset must not depend on what is currently on disk.
  if (options.fresh) table.reset();
  const outbox = new DemoOutbox(table);
  const creds = new DemoCredentialStore(table);
  const tokens = new DemoTokenService(config.sessionSecret);
  const deps: Deps = {
    table,
    anchors: new DemoAuditAnchorStore(table),
    identity: new DemoIdentityAdmin(creds, outbox),
    notifier: new DemoNotifier(outbox, jsonLogger),
    files: new DemoFileStorage(config.sessionSecret),
    secrets: { qrPepper: config.qrPepper, encryptionKey: config.encryptionKey },
    clock: options.clock ?? (() => new Date()),
    logger: jsonLogger,
  };
  const services = createServices(deps);
  if ((options.seed ?? true) && table.isEmpty) {
    const { seedDemoData } = await import("./demo/seed");
    await seedDemoData(deps, services, creds);
    table.flush();
  }
  return {
    config,
    deps,
    services,
    verifier: tokens,
    auth: new DemoAuthGateway(creds, tokens, outbox, services.users),
    demo: { table, outbox, uploadSecret: config.sessionSecret },
  };
}

export async function buildAwsRuntime(config: Extract<AppConfig, { mode: "AWS_PRODUCTION" }>): Promise<Runtime> {
  const secrets = await loadSecretsFromSsm(config.secretsPrefix);
  const deps: Deps = {
    table: new DynamoTable({ main: config.tableName, audit: config.auditTableName }, new DynamoDBClient({ region: config.region })),
    anchors: new S3AuditAnchorStore(config.auditAnchorBucket),
    identity: new CognitoIdentityAdmin(config.userPoolId),
    notifier: new SnsNotifier(config.topicArn, config.smsEnabled, jsonLogger),
    files: new S3FileStorage(config.uploadBucket),
    secrets,
    clock: () => new Date(),
    logger: jsonLogger,
  };
  return {
    config,
    deps,
    services: createServices(deps),
    verifier: new CognitoTokenVerifier(config.userPoolId, config.clientId),
    auth: new CognitoAuthGateway(config.clientId),
    demo: null,
  };
}

const globalForRuntime = globalThis as unknown as { __gatekeeperRuntime?: Promise<Runtime> };

export function getRuntime(): Promise<Runtime> {
  if (!globalForRuntime.__gatekeeperRuntime) {
    const config = loadConfig();
    const pending = config.mode === "LOCAL_DEMO" ? buildDemoRuntime(config) : buildAwsRuntime(config);
    // Do not cache a failed initialisation; the next request retries.
    pending.catch(() => {
      globalForRuntime.__gatekeeperRuntime = undefined;
    });
    globalForRuntime.__gatekeeperRuntime = pending;
  }
  return globalForRuntime.__gatekeeperRuntime;
}

/** Demo-only: wipe and reseed (used by the admin "reset demo" control and E2E tests). */
export async function resetDemoRuntime(): Promise<Runtime> {
  const current = await getRuntime();
  if (!current.demo) throw new Error("Reset is only available in LOCAL_DEMO mode");
  current.demo.table.reset();
  current.demo.table.flush();
  const config = current.config as Extract<AppConfig, { mode: "LOCAL_DEMO" }>;
  const next = buildDemoRuntime(config, { fresh: true });
  next.catch(() => {
    globalForRuntime.__gatekeeperRuntime = undefined;
  });
  globalForRuntime.__gatekeeperRuntime = next;
  return next;
}
