import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const QR_PREFIX = "GK1.";
const TOKEN_PATTERN = /^GK1\.[A-Za-z0-9_-]{43}$/;

/**
 * QR passes carry only an opaque 256-bit random token. The database stores an
 * HMAC of it (keyed with a server-side pepper) so a database leak alone cannot
 * be used to forge or replay passes.
 */
export function generateQrToken(): { token: string; payload: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, payload: QR_PREFIX + token };
}

/** Returns the raw token if the payload is well-formed, else null. */
export function parseQrPayload(payload: string): string | null {
  const trimmed = payload.trim();
  return TOKEN_PATTERN.test(trimmed) ? trimmed.slice(QR_PREFIX.length) : null;
}

export function hashQrToken(token: string, pepper: string): string {
  return createHmac("sha256", pepper).update(token).digest("hex");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function keyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(`gatekeeper-encryption:${secret}`).digest();
}

/** AES-256-GCM. Format: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ct].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decrypt(blob: string, secret: string): string {
  const [version, iv, tag, ct] = blob.split(".");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/** Demo-mode password hashing (Cognito owns passwords in production). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt.${salt.toString("base64url")}.${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split(".");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(expected, actual);
}

/** Human-typeable temporary password satisfying the password policy. */
export function temporaryPassword(): string {
  const body = randomBytes(9).toString("base64url").replace(/[-_]/g, "x");
  return `Gk${body}7a`;
}
