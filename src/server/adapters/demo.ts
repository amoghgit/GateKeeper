/**
 * LOCAL_DEMO adapters. Nothing here talks to AWS: identities live in the local
 * table, "e-mails" and "SMS" land in a demo outbox visible to administrators,
 * and uploads are written to the local .data directory.
 */
import { createHmac, randomUUID } from "node:crypto";
import type { Role } from "@/shared/domain";
import type { DemoOutboxEntry, UploadTicket } from "@/shared/types";
import { keys, strip } from "../db/keys";
import { cond, type Table } from "../db/table";
import { conflict, notFound } from "../errors";
import { hashPassword, temporaryPassword } from "../lib/crypto";
import { ulid } from "../lib/ids";
import type { AuditAnchor, AuditAnchorStore, FileStorage, IdentityAdmin, Logger, Notifier, OutboundMessage } from "../ports";

export interface DemoCredential {
  email: string;
  sub: string;
  passwordHash: string;
  groups: Role[];
  confirmed: boolean;
  mustChangePassword: boolean;
  enabled: boolean;
  /** One-time code for e-mail verification or password reset (demo only). */
  pendingCode: string | null;
  pendingCodePurpose: "VERIFY" | "RESET" | null;
  pendingCodeExpires: number | null;
  signupProfile: Record<string, string> | null;
}

export class DemoOutbox {
  constructor(private readonly table: Table) {}

  async push(entry: Omit<DemoOutboxEntry, "id" | "createdAt">) {
    const id = ulid();
    await this.table.put({
      PK: "DEMO#OUTBOX",
      SK: id,
      ...entry,
      id,
      createdAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + 7 * 86_400,
    });
  }

  async list(limit = 50): Promise<DemoOutboxEntry[]> {
    const res = await this.table.query({ pk: "DEMO#OUTBOX", descending: true, limit });
    return res.items.map((i) => strip<DemoOutboxEntry>(i));
  }
}

export class DemoCredentialStore {
  constructor(private readonly table: Table) {}

  async get(email: string): Promise<DemoCredential | null> {
    const item = await this.table.get(keys.demoCredential(email));
    if (!item) return null;
    const { PK: _pk, SK: _sk, ...rest } = item;
    void _pk;
    void _sk;
    return rest as unknown as DemoCredential;
  }

  async create(c: DemoCredential) {
    await this.table.put({ ...keys.demoCredential(c.email), ...c }, cond.notExists());
  }

  async patch(email: string, patch: Partial<DemoCredential>) {
    await this.table.update(keys.demoCredential(email), { set: patch }, cond.exists());
  }
}

export class DemoIdentityAdmin implements IdentityAdmin {
  constructor(
    private readonly creds: DemoCredentialStore,
    private readonly outbox: DemoOutbox,
  ) {}

  async createUser(input: { email: string; fullName: string; role: Role }) {
    if (await this.creds.get(input.email)) throw conflict("An account with this e-mail already exists.", "EMAIL_TAKEN");
    const password = temporaryPassword();
    const sub = randomUUID();
    await this.creds.create({
      email: input.email.toLowerCase(),
      sub,
      passwordHash: await hashPassword(password),
      groups: [input.role],
      confirmed: true,
      mustChangePassword: true,
      enabled: true,
      pendingCode: null,
      pendingCodePurpose: null,
      pendingCodeExpires: null,
      signupProfile: null,
    });
    await this.outbox.push({
      channel: "AUTH",
      to: input.email,
      subject: "You have been invited to GateKeeper",
      body: `Hello ${input.fullName}, sign in at /login with temporary password ${password}. You will be asked to choose a new password.`,
    });
    return { sub, temporaryPassword: password };
  }

  async setRole(_sub: string, email: string, role: Role) {
    const c = await this.creds.get(email);
    if (!c) throw notFound("Identity");
    await this.creds.patch(email, { groups: [role] });
  }

  async setEnabled(_sub: string, email: string, enabled: boolean) {
    const c = await this.creds.get(email);
    if (!c) throw notFound("Identity");
    await this.creds.patch(email, { enabled });
  }
}

export class DemoNotifier implements Notifier {
  constructor(
    private readonly outbox: DemoOutbox,
    private readonly logger: Logger,
  ) {}

  async send(m: OutboundMessage) {
    if (m.channels.email) await this.outbox.push({ channel: "EMAIL", to: m.email, subject: m.subject, body: m.body });
    if (m.channels.sms) await this.outbox.push({ channel: "SMS", to: m.phone, subject: m.subject, body: m.body });
    this.logger.info("demo.notification_logged", { userId: m.userId, email: m.channels.email, sms: m.channels.sms });
  }

  async subscribeEmail(userId: string) {
    this.logger.info("demo.email_subscription_simulated", { userId });
  }
}

/** Signed, short-lived upload URLs handled by the local /api/demo-upload route. */
export class DemoFileStorage implements FileStorage {
  constructor(private readonly secret: string) {}

  async createUploadTicket(input: { communityId: string; contentType: string; size: number }): Promise<UploadTicket> {
    const ext = input.contentType === "image/png" ? "png" : input.contentType === "image/webp" ? "webp" : "jpg";
    const objectKey = `uploads/${input.communityId}/${ulid()}.${ext}`;
    const expiresAt = Date.now() + 5 * 60_000;
    const sig = signUpload(this.secret, objectKey, input.contentType, input.size, expiresAt);
    const qs = new URLSearchParams({ key: objectKey, type: input.contentType, size: String(input.size), exp: String(expiresAt), sig });
    return {
      uploadUrl: `/api/demo-upload?${qs.toString()}`,
      method: "PUT",
      headers: { "Content-Type": input.contentType },
      objectKey,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }
}

export function signUpload(secret: string, key: string, type: string, size: number, exp: number) {
  return createHmac("sha256", secret).update(`${key}|${type}|${size}|${exp}`).digest("base64url");
}

/** Demo stand-in for the Object Lock bucket: append-only items, every write kept. */
export class DemoAuditAnchorStore implements AuditAnchorStore {
  constructor(private readonly table: Table) {}

  async put(anchor: AuditAnchor) {
    const existing = await this.table.query({
      pk: `DEMO#ANCHOR#${anchor.communityId}`,
      sk: { beginsWith: `${String(anchor.seq).padStart(12, "0")}#` },
      limit: 1,
    });
    if (existing.items.length) return;
    await this.table.put({ PK: `DEMO#ANCHOR#${anchor.communityId}`, SK: `${String(anchor.seq).padStart(12, "0")}#${ulid()}`, ...anchor }, cond.notExists());
  }

  async list(communityId: string): Promise<AuditAnchor[]> {
    const res = await this.table.query({ pk: `DEMO#ANCHOR#${communityId}`, limit: 10_000 });
    return res.items.map((i) => ({ communityId: i.communityId as string, seq: i.seq as number, hash: i.hash as string, anchoredAt: i.anchoredAt as string }));
  }
}
