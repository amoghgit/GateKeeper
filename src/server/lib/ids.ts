import { randomBytes, randomInt } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(ms: number): string {
  let out = "";
  let value = ms;
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

/**
 * ULID: 48-bit millisecond timestamp + 80 random bits, Crockford base32.
 * Lexicographic order equals creation order, which lets DynamoDB sort keys
 * double as time indexes.
 */
export function ulid(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i]! % 32];
  return encodeTime(now) + rand;
}

/** Smallest/largest possible ULID for a timestamp — used for time-range key conditions. */
export function ulidBound(ms: number, edge: "min" | "max"): string {
  return encodeTime(Math.max(0, ms)) + (edge === "min" ? "0".repeat(16) : "Z".repeat(16));
}

export function ulidTime(id: string): number {
  let ms = 0;
  for (const ch of id.slice(0, 10)) ms = ms * 32 + CROCKFORD.indexOf(ch);
  return ms;
}

/** Prefixed, opaque identifiers (e.g. `usr_01J…`). */
export const newId = (prefix: string, now?: number) => `${prefix}_${ulid(now)}`;

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O/1/I/L

/** Short code read aloud or typed at the gate, e.g. "K7Q-4MX". */
export function shortCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

export function joinCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}
