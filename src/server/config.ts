/**
 * Runtime configuration. The mode is explicit: LOCAL_DEMO or AWS_PRODUCTION.
 * A production deployment with missing AWS settings fails loudly — it never
 * silently falls back to demo data.
 */
import { z } from "zod";

export type AppMode = "LOCAL_DEMO" | "AWS_PRODUCTION";

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(`GateKeeper configuration error: ${message}`);
    this.name = "ConfigurationError";
  }
}

const DEMO_DEFAULTS = {
  // Development-only secrets. They are refused in AWS_PRODUCTION mode.
  sessionSecret: "gatekeeper-local-demo-session-secret-not-for-production",
  qrPepper: "gatekeeper-local-demo-qr-pepper",
  encryptionKey: "gatekeeper-local-demo-encryption-key",
};

const prodSchema = z.object({
  AWS_REGION: z.string().min(1),
  TABLE_NAME: z.string().min(1),
  AUDIT_TABLE_NAME: z.string().min(1),
  COGNITO_USER_POOL_ID: z.string().min(1),
  COGNITO_CLIENT_ID: z.string().min(1),
  NOTIFICATION_TOPIC_ARN: z.string().min(1),
  UPLOAD_BUCKET: z.string().min(1),
  AUDIT_ANCHOR_BUCKET: z.string().min(1),
  SECRETS_PARAMETER_PREFIX: z.string().startsWith("/"),
  APP_ORIGIN: z.url(),
  SMS_ENABLED: z.enum(["true", "false"]).default("false"),
});

export interface DemoConfig {
  mode: "LOCAL_DEMO";
  dataFile: string | null;
  sessionSecret: string;
  qrPepper: string;
  encryptionKey: string;
}

export interface ProdConfig {
  mode: "AWS_PRODUCTION";
  region: string;
  tableName: string;
  auditTableName: string;
  userPoolId: string;
  clientId: string;
  topicArn: string;
  uploadBucket: string;
  auditAnchorBucket: string;
  secretsPrefix: string;
  appOrigin: string;
  smsEnabled: boolean;
}

export type AppConfig = DemoConfig | ProdConfig;

export function resolveMode(env: NodeJS.ProcessEnv = process.env): AppMode {
  const raw = env.GATEKEEPER_MODE ?? env.NEXT_PUBLIC_GATEKEEPER_MODE;
  if (raw === "LOCAL_DEMO" || raw === "AWS_PRODUCTION") return raw;
  if (raw) throw new ConfigurationError(`GATEKEEPER_MODE must be LOCAL_DEMO or AWS_PRODUCTION (got "${raw}")`);
  if (env.NODE_ENV === "production" && env.GATEKEEPER_ALLOW_IMPLICIT_DEMO !== "true") {
    return "AWS_PRODUCTION";
  }
  return "LOCAL_DEMO";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mode = resolveMode(env);
  if (mode === "LOCAL_DEMO") {
    return {
      mode,
      dataFile: env.DEMO_DATA_FILE === "memory" ? null : (env.DEMO_DATA_FILE ?? ".data/demo-store.json"),
      sessionSecret: env.DEMO_SESSION_SECRET ?? DEMO_DEFAULTS.sessionSecret,
      qrPepper: env.QR_TOKEN_PEPPER ?? DEMO_DEFAULTS.qrPepper,
      encryptionKey: env.APP_ENCRYPTION_KEY ?? DEMO_DEFAULTS.encryptionKey,
    };
  }
  const parsed = prodSchema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new ConfigurationError(`AWS_PRODUCTION mode is missing or has invalid settings: ${missing}`);
  }
  const e = parsed.data;
  return {
    mode,
    region: e.AWS_REGION,
    tableName: e.TABLE_NAME,
    auditTableName: e.AUDIT_TABLE_NAME,
    userPoolId: e.COGNITO_USER_POOL_ID,
    clientId: e.COGNITO_CLIENT_ID,
    topicArn: e.NOTIFICATION_TOPIC_ARN,
    uploadBucket: e.UPLOAD_BUCKET,
    auditAnchorBucket: e.AUDIT_ANCHOR_BUCKET,
    secretsPrefix: e.SECRETS_PARAMETER_PREFIX,
    appOrigin: e.APP_ORIGIN,
    smsEnabled: e.SMS_ENABLED === "true",
  };
}
