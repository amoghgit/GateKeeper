import { beforeEach, describe, expect, it } from "vitest";
import type { Apartment, CreatedAccount, Invitation, InvitationDetail, IssuedPass, Page, VerificationResult } from "@/shared/types";
import { createHarness, DEMO_ACCOUNTS, type Harness, isoIn } from "../helpers/harness";

const { resident, security, admin, otherTenantSecurity, otherTenantAdmin, otherTenantResident } = DEMO_ACCOUNTS;

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});

async function invite(over: Record<string, unknown> = {}) {
  const res = await h.call<IssuedPass>(resident, "POST", "/invitations", {
    visitor: { fullName: "Integration Guest", phone: "+91 98765 43210", category: "GUEST", purpose: "Dinner" },
    expectedArrival: isoIn(h.clock.now, 15),
    expectedDeparture: isoIn(h.clock.now, 180),
    ...over,
  });
  expect(res.status, JSON.stringify(res.error)).toBe(201);
  return res.data;
}

describe("visitor lifecycle", () => {
  it("resident creates an invitation with a QR pass that contains no personal data", async () => {
    const pass = await invite();
    expect(pass.invitation.status).toBe("APPROVED");
    expect(pass.qrPayload).toMatch(/^GK1\./);
    expect(pass.qrPayload).not.toContain("Integration");
    expect(pass.invitation).not.toHaveProperty("qrTokenHash");
    expect(pass.invitation.code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
  });

  it("validates invitation input server-side", async () => {
    const res = await h.call(resident, "POST", "/invitations", {
      visitor: { fullName: "X", phone: "abc", category: "ALIEN", purpose: "" },
      expectedArrival: isoIn(h.clock.now, 60),
      expectedDeparture: isoIn(h.clock.now, 30),
    });
    expect(res.status).toBe(422);
    expect(Object.keys(res.error!.details!)).toEqual(expect.arrayContaining(["visitor"]));
  });

  it("full flow: approve → verify → entry → admin sees inside → exit → resident history", async () => {
    const pass = await invite({ preApproved: false });
    expect(pass.invitation.status).toBe("PENDING_APPROVAL");

    const blocked = await h.call<VerificationResult>(security, "POST", "/security/verify-qr", { payload: pass.qrPayload });
    expect(blocked.data).toMatchObject({ valid: false, failure: "PENDING_APPROVAL" });

    const approved = await h.call<Invitation>(resident, "POST", `/invitations/${pass.invitation.invitationId}/approve`);
    expect(approved.data.status).toBe("APPROVED");

    const verified = await h.call<VerificationResult>(security, "POST", "/security/verify-qr", { payload: pass.qrPayload });
    expect(verified.data).toMatchObject({ valid: true, allowedAction: "ENTRY" });
    expect(verified.data.invitation?.visitor.fullName).toBe("Integration Guest");

    const entered = await h.call<Invitation>(security, "POST", "/security/record-entry", { payload: pass.qrPayload });
    expect(entered.data).toMatchObject({ status: "CHECKED_IN", usageCount: 1, lastEntryGuardName: "Ravi Kumar" });

    const inside = await h.call<Invitation[]>(admin, "GET", "/security/currently-inside");
    expect(inside.data.map((i) => i.invitationId)).toContain(pass.invitation.invitationId);

    const exited = await h.call<Invitation>(security, "POST", "/security/record-exit", { payload: pass.qrPayload });
    expect(exited.data.status).toBe("COMPLETED");

    const history = await h.call<Page<Invitation>>(resident, "GET", "/invitations?status=COMPLETED&limit=50");
    expect(history.data.items.map((i) => i.invitationId)).toContain(pass.invitation.invitationId);

    const detail = await h.call<InvitationDetail>(resident, "GET", `/invitations/${pass.invitation.invitationId}`);
    expect(detail.data.timeline.map((e) => e.eventType)).toEqual(expect.arrayContaining(["APPROVED", "QR_SCAN_OK", "ENTRY", "EXIT"]));
  });

  it("resident rejects a walk-in and the gate refuses entry", async () => {
    const apts = await h.call<Apartment[]>(security, "GET", "/apartments");
    const apt = apts.data.find((a) => a.unitNumber === "A-1204")!;
    const walkIn = await h.call<Invitation>(security, "POST", "/security/manual-entry", {
      visitor: { fullName: "Walk In", phone: "+91 90000 11111", category: "DELIVERY", purpose: "Parcel" },
      apartmentId: apt.apartmentId,
    });
    expect(walkIn.status).toBe(201);
    expect(walkIn.data.status).toBe("PENDING_APPROVAL");
    const rejected = await h.call<Invitation>(resident, "POST", `/invitations/${walkIn.data.invitationId}/reject`, { reason: "Not expecting anyone" });
    expect(rejected.data.status).toBe("REJECTED");
    const entry = await h.call(security, "POST", "/security/record-entry", { invitationId: walkIn.data.invitationId });
    expect(entry.status).toBe(409);
    expect(entry.error!.code).toBe("REJECTED");
  });

  it("multi-use passes allow repeated entry within validity", async () => {
    const pass = await invite({ usagePolicy: "MULTI_USE", expectedDeparture: isoIn(h.clock.now, 3 * 24 * 60) });
    for (let i = 0; i < 2; i++) {
      expect((await h.call<Invitation>(security, "POST", "/security/record-entry", { payload: pass.qrPayload })).data.status).toBe("CHECKED_IN");
      expect((await h.call<Invitation>(security, "POST", "/security/record-exit", { payload: pass.qrPayload })).data.status).toBe("APPROVED");
    }
  });
});

describe("gate negative scenarios", () => {
  it("rejects an invalid QR and logs the failed scan", async () => {
    const res = await h.call<VerificationResult>(security, "POST", "/security/verify-qr", { payload: "GK1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
    expect(res.data).toMatchObject({ valid: false, failure: "INVALID_TOKEN", invitation: null });
    const garbage = await h.call<VerificationResult>(security, "POST", "/security/verify-qr", { payload: "hello" });
    expect(garbage.data.failure).toBe("INVALID_TOKEN");
    const log = await h.call<Page<{ eventType: string }>>(security, "GET", "/security/activity?type=QR_SCAN_FAILED&limit=5");
    expect(log.data.items.length).toBeGreaterThan(0);
  });

  it("rejects an expired QR", async () => {
    const pass = await invite();
    h.clock.advance(4 * 60);
    const res = await h.call<VerificationResult>(security, "POST", "/security/verify-qr", { payload: pass.qrPayload });
    expect(res.data.failure).toBe("EXPIRED");
    expect((await h.call(security, "POST", "/security/record-entry", { payload: pass.qrPayload })).error!.code).toBe("EXPIRED");
  });

  it("rejects a cancelled invitation", async () => {
    const pass = await invite();
    expect((await h.call<Invitation>(resident, "POST", `/invitations/${pass.invitation.invitationId}/cancel`)).data.status).toBe("CANCELLED");
    expect((await h.call<VerificationResult>(security, "POST", "/security/verify-qr", { payload: pass.qrPayload })).data.failure).toBe("CANCELLED");
  });

  it("prevents duplicate entry, sequentially and under concurrent scans", async () => {
    const pass = await invite();
    const results = await Promise.all(Array.from({ length: 5 }, () => h.call(security, "POST", "/security/record-entry", { payload: pass.qrPayload })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.error!.code === "DUPLICATE_ENTRY")).toBe(true);
    const again = await h.call(security, "POST", "/security/record-entry", { payload: pass.qrPayload });
    expect(again.error!.code).toBe("DUPLICATE_ENTRY");
  });

  it("only records exit for visitors currently inside", async () => {
    const pass = await invite();
    expect((await h.call(security, "POST", "/security/record-exit", { payload: pass.qrPayload })).error!.code).toBe("NOT_INSIDE");
  });

  it("revokes the old QR when a pass is regenerated", async () => {
    const pass = await invite();
    const fresh = await h.call<IssuedPass>(resident, "POST", `/invitations/${pass.invitation.invitationId}/regenerate`);
    expect((await h.call<VerificationResult>(security, "POST", "/security/verify-qr", { payload: pass.qrPayload })).data.failure).toBe("INVALID_TOKEN");
    expect((await h.call<VerificationResult>(security, "POST", "/security/verify-qr", { payload: fresh.data.qrPayload })).data.valid).toBe(true);
  });
});

describe("authorization and tenant isolation", () => {
  it("rejects unauthenticated and tampered tokens", async () => {
    expect((await h.call(null, "GET", "/me")).status).toBe(401);
    const token = await h.tokenFor(resident);
    const { handleApiRequest } = await import("@/server/api/router");
    const res = await handleApiRequest(h.runtime, {
      method: "GET",
      path: "/me",
      query: new URLSearchParams(),
      headers: { authorization: `Bearer ${token.slice(0, -2)}xx` },
      body: null,
      ip: "t",
      requestId: "r",
    });
    expect(res.status).toBe(401);
  });

  it("enforces role-based access on every endpoint", async () => {
    expect((await h.call(resident, "GET", "/admin/analytics")).status).toBe(403);
    expect((await h.call(resident, "POST", "/security/verify-qr", { payload: "x" })).status).toBe(403);
    expect((await h.call(security, "POST", "/invitations", {})).status).toBe(403);
    expect((await h.call(security, "POST", "/residents", {})).status).toBe(403);
    expect((await h.call(admin, "POST", "/security/record-entry", { invitationId: "x" })).status).toBe(403);
  });

  it("blocks cross-tenant QR use and record access", async () => {
    const pass = await invite();
    const scan = await h.call<VerificationResult>(otherTenantSecurity, "POST", "/security/verify-qr", { payload: pass.qrPayload });
    expect(scan.data).toMatchObject({ valid: false, failure: "WRONG_COMMUNITY", invitation: null });
    expect((await h.call(otherTenantSecurity, "POST", "/security/record-entry", { payload: pass.qrPayload })).status).toBe(409);
    expect((await h.call(otherTenantSecurity, "POST", "/security/record-entry", { invitationId: pass.invitation.invitationId })).status).toBe(404);
    expect((await h.call(otherTenantAdmin, "GET", `/invitations/${pass.invitation.invitationId}`)).status).toBe(404);
    expect((await h.call(otherTenantResident, "POST", `/invitations/${pass.invitation.invitationId}/cancel`)).status).toBe(404);
    const theirList = await h.call<Page<Invitation>>(otherTenantAdmin, "GET", "/invitations?limit=100");
    expect(theirList.data.items.every((i) => i.communityId === "cmty_harbor")).toBe(true);
  });

  it("prevents residents from reading another apartment's visitors (IDOR)", async () => {
    const pass = await invite();
    expect((await h.call(DEMO_ACCOUNTS.resident, "GET", `/invitations/${pass.invitation.invitationId}`)).status).toBe(200);
    expect((await h.call("arjun.mehta@lakeview.demo", "GET", `/invitations/${pass.invitation.invitationId}`)).status).toBe(404);
    expect((await h.call("arjun.mehta@lakeview.demo", "GET", `/invitations/${pass.invitation.invitationId}/pass`)).status).toBe(404);
    const list = await h.call<Page<Invitation>>("arjun.mehta@lakeview.demo", "GET", "/invitations?limit=100");
    expect(list.data.items.some((i) => i.invitationId === pass.invitation.invitationId)).toBe(false);
  });

  it("ignores attempts to escalate role or change tenant via the profile", async () => {
    const res = await h.call<{ role: string; communityId: string }>(resident, "PATCH", "/me", {
      fullName: "Ananya S",
      role: "ADMIN",
      communityId: "cmty_harbor",
    });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ role: "RESIDENT", communityId: "cmty_lakeview" });
  });
});

describe("administration", () => {
  it("admin creates an apartment and a resident who must change their temporary password", async () => {
    const buildings = await h.call<{ buildingId: string; name: string }[]>(admin, "GET", "/admin/buildings");
    const tower = buildings.data.find((b) => b.name === "Tower B")!;
    const apt = await h.call<Apartment>(admin, "POST", "/admin/apartments", { buildingId: tower.buildingId, floor: 4, unitNumber: "B-404", block: "East" });
    expect(apt.status).toBe(201);
    const dup = await h.call(admin, "POST", "/admin/apartments", { buildingId: tower.buildingId, floor: 4, unitNumber: "B-404" });
    expect(dup.error!.code).toBe("UNIT_EXISTS");

    const created = await h.call<CreatedAccount>(admin, "POST", "/residents", {
      fullName: "New Resident",
      email: "new.resident@lakeview.demo",
      phone: "+91 90000 22222",
      apartmentId: apt.data.apartmentId,
    });
    expect(created.status).toBe(201);
    expect(created.data.temporaryPassword).toBeTruthy();
    const login = await h.runtime.auth.login("new.resident@lakeview.demo", created.data.temporaryPassword!);
    expect(login.kind).toBe("newPasswordRequired");
    if (login.kind === "newPasswordRequired") {
      const tokens = await h.runtime.auth.completeNewPassword("new.resident@lakeview.demo", login.session, "Brand-New-Pass1");
      expect(tokens.accessToken).toBeTruthy();
    }
    expect(
      (
        await h.call(admin, "POST", "/residents", {
          fullName: "Dup",
          email: "new.resident@lakeview.demo",
          phone: "+91 90000 22222",
          apartmentId: apt.data.apartmentId,
        })
      ).error!.code,
    ).toBe("EMAIL_TAKEN");
  });

  it("deactivated residents lose access", async () => {
    const list = await h.call<Page<{ userId: string; email: string }>>(admin, "GET", "/residents?limit=100");
    const arjun = list.data.items.find((u) => u.email === "arjun.mehta@lakeview.demo")!;
    expect((await h.call(admin, "DELETE", `/residents/${arjun.userId}`)).status).toBe(200);
    expect((await h.call("arjun.mehta@lakeview.demo", "GET", "/invitations")).error!.code).toBe("ACCOUNT_INACTIVE");
    await expect(h.runtime.auth.login("arjun.mehta@lakeview.demo", "GateKeeper@2026")).rejects.toMatchObject({ code: "ACCOUNT_DISABLED" });
  });

  it("self-registration is pending until an admin approves it", async () => {
    await h.runtime.auth.signUp({
      fullName: "Self Reg",
      email: "self@lakeview.demo",
      phone: "+91 90000 33333",
      joinCode: "LAKE2026",
      unitNumber: "B-605",
      password: "Strong-Pass-123",
      confirmPassword: "Strong-Pass-123",
    });
    const outbox = await h.runtime.demo!.outbox.list();
    const code = /(\d{6})/.exec(outbox.find((m) => m.to === "self@lakeview.demo")!.body)![1]!;
    await h.runtime.auth.confirmSignUp("self@lakeview.demo", code);
    expect((await h.call("self@lakeview.demo", "GET", "/invitations")).error!.code).toBe("ACCOUNT_PENDING");
    const pending = await h.call<Page<{ userId: string; email: string }>>(admin, "GET", "/residents?pending=true&status=PENDING");
    const me = pending.data.items.find((u) => u.email === "self@lakeview.demo")!;
    const apts = await h.call<Apartment[]>(admin, "GET", "/admin/apartments");
    await h.call(admin, "POST", `/residents/${me.userId}/approve-registration`, { apartmentId: apts.data.find((a) => a.unitNumber === "B-605")!.apartmentId });
    // A fresh token (as issued on refresh) carries the new group.
    expect((await h.call("self@lakeview.demo", "GET", "/invitations")).status).toBe(200);
  });

  it("exports CSV reports and keeps a verifiable audit chain", async () => {
    await invite();
    const csv = await h.call<string>(admin, "GET", "/admin/reports?limit=20");
    expect(csv.status).toBe(200);
    expect(csv.data.split("\r\n")[0]).toContain("Visitor,Phone,Category");
    const verify = await h.call<{ verified: boolean; checked: number }>(admin, "GET", "/admin/audit-logs/verify");
    expect(verify.data.verified).toBe(true);
    expect(verify.data.checked).toBeGreaterThan(10);
  });

  it("detects tampering with the audit trail", async () => {
    const item = await h.runtime.deps.table.get({ PK: "C#cmty_lakeview", SK: "000000000003" }, "audit");
    await h.runtime.deps.table.put({ ...item!, action: "SOMETHING_ELSE" }, undefined, "audit");
    const verify = await h.call<{ verified: boolean; brokenAtSeq: number }>(admin, "GET", "/admin/audit-logs/verify");
    expect(verify.data).toMatchObject({ verified: false, brokenAtSeq: 3 });
  });
});
