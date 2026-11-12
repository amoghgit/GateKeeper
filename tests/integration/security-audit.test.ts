/**
 * Production-readiness audit checks: tenant isolation across every ID-addressed
 * endpoint, JWT edge cases, secret handling, audit-chain anchoring and job
 * failure/concurrency behaviour.
 */
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Apartment, Building, Invitation, IssuedPass, Page, UserProfile } from "@/shared/types";
import { handleApiRequest } from "@/server/api/router";
import { auditHash } from "@/server/services/audit-service";
import { encodeCursor } from "@/server/db/table";
import { JobFailedError } from "@/server/services/jobs-service";
import { createHarness, DEMO_ACCOUNTS, type Harness, isoIn } from "../helpers/harness";

const { admin, security, resident, otherTenantAdmin, otherTenantSecurity, otherTenantResident } = DEMO_ACCOUNTS;
const SECRET = "test-secret-test-secret-test-secret";

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(() => vi.restoreAllMocks());

async function rawCall(token: string, path = "/me") {
  return handleApiRequest(h.runtime, {
    method: "GET",
    path,
    query: new URLSearchParams(),
    headers: { authorization: `Bearer ${token}` },
    body: null,
    ip: "t",
    requestId: randomUUID(),
  });
}

async function lakeviewFixtures() {
  const pass = (
    await h.call<IssuedPass>(resident, "POST", "/invitations", {
      visitor: { fullName: "Tenant Probe", phone: "+91 90000 12345", category: "GUEST", purpose: "Probe" },
      expectedArrival: isoIn(h.clock.now, 10),
      expectedDeparture: isoIn(h.clock.now, 120),
    })
  ).data;
  const residents = (await h.call<Page<UserProfile>>(admin, "GET", "/residents?limit=100")).data.items;
  const pending = (await h.call<Page<UserProfile>>(admin, "GET", "/residents?pending=true&status=PENDING")).data.items;
  const guards = (await h.call<Page<UserProfile>>(admin, "GET", "/admin/guards")).data.items;
  const buildings = (await h.call<Building[]>(admin, "GET", "/admin/buildings")).data;
  const apartments = (await h.call<Apartment[]>(admin, "GET", "/admin/apartments")).data;
  const announcements = (await h.call<Page<{ announcementId: string }>>(admin, "GET", "/announcements")).data.items;
  const notifications = (await h.call<Page<{ notificationId: string }>>(resident, "GET", "/notifications")).data.items;
  const inside = (await h.call<Invitation[]>(security, "GET", "/security/currently-inside")).data;
  return { pass, residents, pending, guards, buildings, apartments, announcements, notifications, inside };
}

describe("tenant isolation sweep (every ID-addressed endpoint)", () => {
  it("another community's admin, guard and resident cannot read or change any Lakeview record", async () => {
    const f = await lakeviewFixtures();
    const r = f.residents[0]!;
    const attempts: [string, string, string, unknown?][] = [
      [otherTenantAdmin, "GET", `/invitations/${f.pass.invitation.invitationId}`],
      [otherTenantAdmin, "POST", `/invitations/${f.pass.invitation.invitationId}/cancel`],
      [otherTenantAdmin, "GET", `/visitors/${f.pass.invitation.visitorId}`],
      [otherTenantAdmin, "PATCH", `/residents/${r.userId}`, { fullName: "Hijacked" }],
      [otherTenantAdmin, "DELETE", `/residents/${r.userId}`],
      [otherTenantAdmin, "POST", `/residents/${f.pending[0]!.userId}/approve-registration`, { apartmentId: f.apartments[0]!.apartmentId }],
      [otherTenantAdmin, "POST", `/residents/${f.pending[0]!.userId}/reject-registration`],
      [otherTenantAdmin, "PATCH", `/admin/guards/${f.guards[0]!.userId}`, { status: "DEACTIVATED" }],
      [otherTenantAdmin, "PATCH", `/admin/buildings/${f.buildings[0]!.buildingId}`, { name: "Hijacked", floors: 1, blocks: [] }],
      [otherTenantAdmin, "DELETE", `/admin/buildings/${f.buildings[0]!.buildingId}`],
      [otherTenantAdmin, "DELETE", `/admin/apartments/${f.apartments[0]!.apartmentId}`],
      [otherTenantAdmin, "DELETE", `/admin/announcements/${f.announcements[0]!.announcementId}`],
      [otherTenantSecurity, "POST", "/security/record-exit", { invitationId: f.inside[0]!.invitationId }],
      [otherTenantSecurity, "POST", "/security/record-entry", { invitationId: f.pass.invitation.invitationId }],
      [
        otherTenantSecurity,
        "POST",
        "/security/manual-entry",
        { visitor: { fullName: "X Y", phone: "+91 90000 99999", category: "GUEST", purpose: "Visit" }, apartmentId: f.apartments[0]!.apartmentId },
      ],
      [otherTenantResident, "PATCH", `/notifications/${f.notifications[0]!.notificationId}/read`],
      [otherTenantResident, "POST", `/invitations/${f.pass.invitation.invitationId}/regenerate`],
      [otherTenantResident, "GET", `/invitations/${f.pass.invitation.invitationId}/pass`],
    ];
    for (const [who, method, path, body] of attempts) {
      const res = await h.call(who, method, path, body);
      expect([400, 403, 404], `${who} ${method} ${path} -> ${res.status} ${res.error?.code}`).toContain(res.status);
    }
    // Nothing changed for Lakeview.
    expect((await h.call<{ invitation: Invitation }>(admin, "GET", `/invitations/${f.pass.invitation.invitationId}`)).data.invitation.status).toBe("APPROVED");
    const after = (await h.call<Page<UserProfile>>(admin, "GET", "/residents?limit=100")).data.items.find((u) => u.userId === r.userId)!;
    expect(after).toMatchObject({ fullName: r.fullName, status: "ACTIVE" });
    expect((await h.call<Building[]>(admin, "GET", "/admin/buildings")).data).toHaveLength(f.buildings.length);
    expect((await h.call<Invitation[]>(security, "GET", "/security/currently-inside")).data).toHaveLength(f.inside.length);
    expect((await h.call<Page<UserProfile>>(admin, "GET", "/admin/guards")).data.items.every((g) => g.status === "ACTIVE")).toBe(true);
  });

  it("rejects pagination cursors forged to point into another tenant's partition", async () => {
    const forged = encodeCursor({ PK: "C#cmty_lakeview", SK: "INV#inv_x", GSI3PK: "C#cmty_lakeview#INVDATE", GSI3SK: "2026-01-01" });
    const res = await h.call(otherTenantAdmin, "GET", `/invitations?cursor=${forged}`);
    expect(res.status).toBe(400);
    expect(res.error!.code).toBe("BAD_CURSOR");
  });

  it("list and aggregate endpoints only ever return the caller's community", async () => {
    for (const path of ["/invitations?limit=100", "/security/activity?limit=100", "/visitors?limit=100", "/admin/audit-logs?limit=100", "/announcements"]) {
      const res = await h.call<Page<{ communityId?: string }> | unknown>(otherTenantAdmin, "GET", path);
      const items = (res.data as Page<{ communityId?: string }>).items ?? [];
      expect(
        items.every((i) => !i.communityId || i.communityId === "cmty_harbor"),
        path,
      ).toBe(true);
    }
    const inside = await h.call<Invitation[]>(otherTenantAdmin, "GET", "/security/currently-inside");
    expect(inside.data.every((i) => i.communityId === "cmty_harbor")).toBe(true);
    const apts = await h.call<Apartment[]>(otherTenantSecurity, "GET", "/apartments");
    expect(apts.data.every((a) => a.communityId === "cmty_harbor")).toBe(true);
  });
});

describe("JWT validation edge cases", () => {
  const sign = async (claims: Record<string, unknown>, opts: { secret?: string; exp?: string; iss?: string; aud?: string; sub?: string } = {}) => {
    const cred = await h.runtime.deps.table.get({ PK: `DEMOAUTH#${resident}`, SK: "CREDENTIAL" });
    return new SignJWT({ "cognito:groups": ["RESIDENT"], token_use: "access", ...claims })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(opts.sub ?? (cred!.sub as string))
      .setIssuer(opts.iss ?? "gatekeeper-local-demo")
      .setAudience(opts.aud ?? "gatekeeper")
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "1h")
      .sign(new TextEncoder().encode(opts.secret ?? SECRET));
  };

  it("accepts a well-formed token", async () => {
    expect((await rawCall(await sign({}))).status).toBe(200);
  });

  it.each([
    ["expired", { exp: "-1m" }],
    ["signed with another key", { secret: "attacker-controlled-secret-attacker" }],
    ["wrong issuer", { iss: "https://evil.example" }],
    ["wrong audience", { aud: "other-app" }],
  ])("rejects a token that is %s", async (_label, opts) => {
    expect((await rawCall(await sign({}, opts))).status).toBe(401);
  });

  it("rejects refresh tokens used as access tokens and unsigned (alg=none) tokens", async () => {
    expect((await rawCall(await sign({ token_use: "refresh" }))).status).toBe(401);
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ sub: "x", "cognito:groups": ["ADMIN"], token_use: "access" })).toString("base64url");
    expect((await rawCall(`${header}.${body}.`)).status).toBe(401);
  });

  it("never trusts a role claimed only by the token", async () => {
    // A resident's token claiming ADMIN: the stored role (RESIDENT) is not in the token groups.
    const res = await rawCall(await sign({ "cognito:groups": ["ADMIN"] }), "/admin/analytics");
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe("ROLE_MISMATCH");
    // Unknown subject with a valid signature is not provisioned.
    expect((await rawCall(await sign({}, { sub: "unknown-sub" }))).status).toBe(403);
  });
});

describe("QR token secrecy", () => {
  it("never stores or logs the raw token or the visitor's phone", async () => {
    const lines: string[] = [];
    for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    const pass = (
      await h.call<IssuedPass>(resident, "POST", "/invitations", {
        visitor: { fullName: "Secret Keeper", phone: "+91 91234 56789", category: "GUEST", purpose: "Visit" },
        expectedArrival: isoIn(h.clock.now, 10),
        expectedDeparture: isoIn(h.clock.now, 120),
      })
    ).data;
    await h.call(security, "POST", "/security/verify-qr", { payload: pass.qrPayload });
    await h.call(security, "POST", "/security/record-entry", { payload: pass.qrPayload });
    await h.call(security, "POST", "/security/record-entry", { payload: pass.qrPayload });
    const token = pass.qrPayload.slice(4);
    const stored = JSON.stringify([...(await h.runtime.deps.table.query({ pk: "C#cmty_lakeview", limit: 100_000 })).items]);
    expect(stored).not.toContain(token);
    const qrItems = await h.runtime.deps.table.query({ pk: "C#cmty_lakeview", sk: { beginsWith: "INV#" }, limit: 100_000 });
    expect(qrItems.items.some((i) => (i.qrTokenHash as string)?.length === 64)).toBe(true);
    const logs = lines.join("\n");
    expect(logs).not.toContain(token);
    expect(logs).not.toContain("91234");
    expect(logs).not.toContain("Secret Keeper");
  });
});

describe("audit trail anchoring", () => {
  /** Rewrites entry `seq` and re-hashes every later entry plus the head — the attack a plain hash chain cannot detect. */
  async function rewriteChainFrom(seq: number) {
    const t = h.runtime.deps.table;
    const head = await t.get({ PK: "C#cmty_lakeview", SK: "AUDITHEAD" });
    let prev = (await t.get({ PK: "C#cmty_lakeview", SK: String(seq - 1).padStart(12, "0") }, "audit"))!.hash as string;
    for (let s = seq; s <= (head!.seq as number); s++) {
      const item = (await t.get({ PK: "C#cmty_lakeview", SK: String(s).padStart(12, "0") }, "audit"))!;
      const { PK, SK, entity, hash: _old, ...entry } = item;
      void _old;
      const forged = { ...entry, prevHash: prev, ...(s === seq ? { action: "NOTHING_TO_SEE_HERE" } : {}) } as Parameters<typeof auditHash>[0];
      const hash = auditHash(forged);
      await t.put({ PK, SK, entity, ...forged, hash }, undefined, "audit");
      prev = hash;
    }
    await t.update({ PK: "C#cmty_lakeview", SK: "AUDITHEAD" }, { set: { hash: prev } });
  }

  it("a full-chain rewrite passes hash checks alone but is caught by the write-once anchors", async () => {
    // Without an anchor, a consistent rewrite is undetectable (this is why anchoring exists).
    await rewriteChainFrom(3);
    const unanchored = await h.call<{ verified: boolean; anchorsChecked: number }>(admin, "GET", "/admin/audit-logs/verify");
    expect(unanchored.data).toMatchObject({ verified: true, anchorsChecked: 0 });

    const fresh = await createHarness();
    await fresh.runtime.services.jobs.run("audit-anchor", "cmty_lakeview");
    h = fresh;
    await rewriteChainFrom(3);
    const res = await h.call<{ verified: boolean; reason: string; brokenAtSeq: number }>(admin, "GET", "/admin/audit-logs/verify");
    expect(res.data).toMatchObject({ verified: false, reason: "ANCHOR_MISMATCH" });
  });

  it("detects truncation and conflicting anchors; re-anchoring is idempotent", async () => {
    await h.runtime.services.jobs.run("audit-anchor", "cmty_lakeview");
    await h.runtime.services.jobs.run("audit-anchor", "cmty_lakeview");
    const anchors = await h.runtime.deps.anchors.list("cmty_lakeview");
    expect(anchors).toHaveLength(1);
    expect((await h.call<{ verified: boolean; anchorsChecked: number }>(admin, "GET", "/admin/audit-logs/verify")).data).toMatchObject({
      verified: true,
      anchorsChecked: 1,
    });

    // Deleting the newest entry (truncation) is caught even if the head is rolled back.
    const last = anchors[0]!.seq;
    await h.runtime.deps.table.delete({ PK: "C#cmty_lakeview", SK: String(last).padStart(12, "0") }, undefined, "audit");
    await h.runtime.deps.table.update({ PK: "C#cmty_lakeview", SK: "AUDITHEAD" }, { set: { seq: last - 1 } });
    expect((await h.call<{ reason: string }>(admin, "GET", "/admin/audit-logs/verify")).data.reason).toBe("TRUNCATED");

    // A second, different anchor for an existing sequence number is reported as a conflict.
    await h.runtime.deps.table.put({
      PK: "DEMO#ANCHOR#cmty_lakeview",
      SK: `${String(last).padStart(12, "0")}#ZZZ`,
      communityId: "cmty_lakeview",
      seq: last,
      hash: "forged",
      anchoredAt: "x",
    });
    expect((await h.call<{ reason: string }>(admin, "GET", "/admin/audit-logs/verify")).data.reason).toBe("ANCHOR_CONFLICT");
  });
});

describe("scheduled jobs: failures and duplicate execution", () => {
  it("processes healthy communities but reports failure when one tenant fails", async () => {
    const original = h.runtime.services.audit.anchor.bind(h.runtime.services.audit);
    vi.spyOn(h.runtime.services.audit, "anchor").mockImplementation(async (cid) => {
      if (cid === "cmty_harbor") throw new Error("simulated outage");
      return original(cid);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = await h.runtime.services.jobs.run("audit-anchor").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JobFailedError);
    expect((err as JobFailedError).report).toMatchObject({ failedCommunities: ["cmty_harbor"], affected: 1 });
    expect(await h.runtime.deps.anchors.list("cmty_lakeview")).toHaveLength(1);
  });

  it("two overlapping runs of the expiry job expire each invitation once and notify once", async () => {
    const pass = (
      await h.call<IssuedPass>(resident, "POST", "/invitations", {
        visitor: { fullName: "Overlap Guest", phone: "+91 90000 77777", category: "GUEST", purpose: "Visit" },
        expectedArrival: isoIn(h.clock.now, 5),
        expectedDeparture: isoIn(h.clock.now, 30),
      })
    ).data;
    h.clock.advance(60);
    const [a, b] = await Promise.all([
      h.runtime.services.jobs.run("expire-invitations", "cmty_lakeview"),
      h.runtime.services.jobs.run("expire-invitations", "cmty_lakeview"),
    ]);
    expect(a.affected + b.affected).toBeGreaterThanOrEqual(1);
    const detail = await h.call<{ invitation: Invitation; timeline: { eventType: string }[] }>(resident, "GET", `/invitations/${pass.invitation.invitationId}`);
    expect(detail.data.invitation.status).toBe("EXPIRED");
    expect(detail.data.timeline.filter((e) => e.eventType === "EXPIRED")).toHaveLength(1);
    const notes = await h.call<Page<{ type: string; message: string }>>(resident, "GET", "/notifications?limit=100");
    expect(notes.data.items.filter((n) => n.type === "INVITATION_EXPIRED" && n.message.includes("Overlap Guest"))).toHaveLength(1);
  });
});
