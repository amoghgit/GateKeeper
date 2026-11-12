/**
 * Ports for side effects that differ between LOCAL_DEMO and AWS_PRODUCTION.
 * Services depend on these interfaces; adapters live in ./adapters.
 */
import type { Role } from "@/shared/domain";
import type { DemoOutboxEntry, UploadTicket } from "@/shared/types";
import type { Table } from "./db/table";

/** Administrative identity operations (Cognito admin APIs in production). */
export interface IdentityAdmin {
  /** Creates a sign-in identity and sends (or, in demo, returns) a temporary password. */
  createUser(input: { email: string; fullName: string; role: Role }): Promise<{ sub: string; temporaryPassword: string | null }>;
  setRole(sub: string, email: string, role: Role, previous: Role | null): Promise<void>;
  setEnabled(sub: string, email: string, enabled: boolean): Promise<void>;
}

export interface OutboundMessage {
  userId: string;
  email: string;
  phone: string;
  subject: string;
  body: string;
  channels: { email: boolean; sms: boolean };
}

/** Out-of-app delivery (Amazon SNS in production, a local outbox in demo). */
export interface Notifier {
  send(message: OutboundMessage): Promise<void>;
  /** Registers a user's e-mail so filtered SNS deliveries can reach them. */
  subscribeEmail(userId: string, email: string): Promise<void>;
}

export interface FileStorage {
  createUploadTicket(input: { communityId: string; contentType: string; size: number }): Promise<UploadTicket>;
}

export interface DemoOutbox {
  push(entry: Omit<DemoOutboxEntry, "id" | "createdAt">): void;
  list(): DemoOutboxEntry[];
}

export interface Secrets {
  qrPepper: string;
  encryptionKey: string;
}

export interface AuditAnchor {
  communityId: string;
  seq: number;
  hash: string;
  anchoredAt: string;
}

/**
 * Write-once storage for audit-chain checkpoints (S3 Object Lock in production).
 * `list` must return every stored version, so an overwritten anchor shows up
 * as a conflict rather than silently replacing the original.
 */
export interface AuditAnchorStore {
  put(anchor: AuditAnchor): Promise<void>;
  list(communityId: string): Promise<AuditAnchor[]>;
}

export interface Deps {
  table: Table;
  anchors: AuditAnchorStore;
  identity: IdentityAdmin;
  notifier: Notifier;
  files: FileStorage;
  secrets: Secrets;
  clock: () => Date;
  logger: Logger;
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Structured JSON logger. Callers must pass identifiers, never personal data
 * (names, phones, e-mails) or tokens.
 */
export const jsonLogger: Logger = {
  info: (msg, meta) => console.log(JSON.stringify({ level: "info", msg, ...meta })),
  warn: (msg, meta) => console.warn(JSON.stringify({ level: "warn", msg, ...meta })),
  error: (msg, meta) => console.error(JSON.stringify({ level: "error", msg, ...meta })),
};
