import { describe, expect, it } from "vitest";
import { evaluatePass } from "@/shared/pass-policy";
import type { Invitation } from "@/shared/types";
import { decrypt, encrypt, generateQrToken, hashPassword, hashQrToken, parseQrPayload, verifyPassword } from "@/server/lib/crypto";
import { shortCode, ulid, ulidBound, ulidTime } from "@/server/lib/ids";
import { csvCell } from "@/server/services/analytics-service";

describe("QR token generation", () => {
  it("produces unique, opaque, well-formed payloads", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const { token, payload } = generateQrToken();
      expect(payload).toBe(`GK1.${token}`);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      seen.add(token);
    }
    expect(seen.size).toBe(500);
  });

  it("parses only valid payloads", () => {
    const { token, payload } = generateQrToken();
    expect(parseQrPayload(payload)).toBe(token);
    expect(parseQrPayload(`  ${payload}  `)).toBe(token);
    expect(parseQrPayload("GK1.short")).toBeNull();
    expect(parseQrPayload("https://evil.example/x")).toBeNull();
    expect(parseQrPayload(`GK2.${token}`)).toBeNull();
  });

  it("hashes tokens with a pepper (deterministic per pepper, different across peppers)", () => {
    const { token } = generateQrToken();
    expect(hashQrToken(token, "a")).toBe(hashQrToken(token, "a"));
    expect(hashQrToken(token, "a")).not.toBe(hashQrToken(token, "b"));
    expect(hashQrToken(token, "a")).not.toContain(token);
  });

  it("encrypts pass payloads with authenticated encryption", () => {
    const blob = encrypt("GK1.secret", "key-1");
    expect(blob).not.toContain("secret");
    expect(decrypt(blob, "key-1")).toBe("GK1.secret");
    expect(() => decrypt(blob, "key-2")).toThrow();
    const parts = blob.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."), "key-1")).toThrow();
  });

  it("hashes and verifies demo passwords", async () => {
    const h = await hashPassword("Correct-Horse-9");
    expect(await verifyPassword("Correct-Horse-9", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
});

describe("identifiers", () => {
  it("ULIDs sort by time and bounds bracket a timestamp", () => {
    const a = ulid(1_700_000_000_000);
    const b = ulid(1_700_000_000_001);
    expect(a < b).toBe(true);
    expect(ulidTime(a)).toBe(1_700_000_000_000);
    expect(ulidBound(1_700_000_000_000, "min") <= a).toBe(true);
    expect(ulidBound(1_700_000_000_000, "max") >= a).toBe(true);
  });

  it("short codes avoid ambiguous characters", () => {
    for (let i = 0; i < 200; i++) expect(shortCode()).toMatch(/^[2-9A-HJKMNP-Z]{3}-[2-9A-HJKMNP-Z]{3}$/);
  });
});

const base = (over: Partial<Invitation> = {}): Invitation => ({
  invitationId: "inv_1",
  code: "ABC-DEF",
  communityId: "c1",
  visitorId: "v1",
  visitor: { fullName: "V", phone: "+911234567", category: "GUEST", purpose: "x", vehicleNumber: null },
  residentId: "r1",
  residentName: "R",
  apartmentId: "a1",
  apartmentLabel: "T · 1",
  expectedArrival: "2026-01-01T10:00:00.000Z",
  expectedDeparture: "2026-01-01T12:00:00.000Z",
  validFrom: "2026-01-01T09:00:00.000Z",
  expiry: "2026-01-01T12:00:00.000Z",
  status: "APPROVED",
  usagePolicy: "SINGLE_USE",
  usageCount: 0,
  source: "RESIDENT_INVITE",
  notes: null,
  photoKey: null,
  createdBy: "r1",
  createdByName: "R",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  decidedAt: null,
  rejectionReason: null,
  lastEntryAt: null,
  lastEntryGuardName: null,
  lastExitAt: null,
  lastExitGuardName: null,
  overdue: false,
  ...over,
});
const at = (iso: string) => new Date(iso);

describe("pass policy (QR expiry & state validation)", () => {
  it("allows entry inside the validity window", () => {
    expect(evaluatePass(base(), at("2026-01-01T10:30:00Z"))).toMatchObject({ failure: null, allowedAction: "ENTRY" });
  });
  it("rejects expired passes", () => {
    expect(evaluatePass(base(), at("2026-01-01T12:00:01Z")).failure).toBe("EXPIRED");
    expect(evaluatePass(base({ status: "EXPIRED" }), at("2026-01-01T10:30:00Z")).failure).toBe("EXPIRED");
  });
  it("rejects passes before the entry window", () => {
    expect(evaluatePass(base(), at("2026-01-01T08:59:00Z")).failure).toBe("NOT_YET_VALID");
  });
  it.each([
    ["CANCELLED", "CANCELLED"],
    ["REJECTED", "REJECTED"],
    ["PENDING_APPROVAL", "PENDING_APPROVAL"],
  ] as const)("rejects %s invitations", (status, failure) => {
    expect(evaluatePass(base({ status }), at("2026-01-01T10:30:00Z")).failure).toBe(failure);
  });
  it("rejects already-used single-use passes", () => {
    expect(evaluatePass(base({ status: "COMPLETED", usageCount: 1 }), at("2026-01-01T10:30:00Z")).failure).toBe("ALREADY_USED");
    expect(evaluatePass(base({ usageCount: 1 }), at("2026-01-01T10:30:00Z")).failure).toBe("ALREADY_USED");
  });
  it("allows re-entry for multi-use passes and exit for visitors inside", () => {
    expect(evaluatePass(base({ usagePolicy: "MULTI_USE", usageCount: 3 }), at("2026-01-01T10:30:00Z")).allowedAction).toBe("ENTRY");
    expect(evaluatePass(base({ status: "CHECKED_IN" }), at("2026-01-01T13:00:00Z")).allowedAction).toBe("EXIT");
  });
});

describe("CSV export", () => {
  it("neutralises spreadsheet formulas and escapes quotes", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+91 98")).toBe("'+91 98");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("plain")).toBe("plain");
  });
});
