import { describe, expect, it } from "vitest";
import type { AppNotification, Invitation, IssuedPass, Page } from "@/shared/types";
import { createHarness, DEMO_ACCOUNTS, isoIn } from "../helpers/harness";

const { resident, security } = DEMO_ACCOUNTS;

async function setup() {
  const h = await createHarness();
  const pass = (
    await h.call<IssuedPass>(resident, "POST", "/invitations", {
      visitor: { fullName: "Job Guest", phone: "+91 98765 00000", category: "GUEST", purpose: "Visit" },
      expectedArrival: isoIn(h.clock.now, 5),
      expectedDeparture: isoIn(h.clock.now, 60),
    })
  ).data;
  return { h, pass };
}

describe("scheduled jobs", () => {
  it("expires unused invitations idempotently", async () => {
    const { h, pass } = await setup();
    h.clock.advance(120);
    const first = await h.runtime.services.jobs.run("expire-invitations", "cmty_lakeview");
    expect(first.affected).toBeGreaterThanOrEqual(1);
    const second = await h.runtime.services.jobs.run("expire-invitations", "cmty_lakeview");
    expect(second.affected).toBe(0);
    const inv = await h.call<{ invitation: Invitation }>(resident, "GET", `/invitations/${pass.invitation.invitationId}`);
    expect(inv.data.invitation.status).toBe("EXPIRED");
  });

  it("flags overdue visitors without auto-exiting them", async () => {
    const { h, pass } = await setup();
    await h.call(security, "POST", "/security/record-entry", { payload: pass.qrPayload });
    h.clock.advance(60 + 61);
    expect((await h.runtime.services.jobs.run("flag-overdue", "cmty_lakeview")).affected).toBeGreaterThanOrEqual(1);
    expect((await h.runtime.services.jobs.run("flag-overdue", "cmty_lakeview")).affected).toBe(0);
    const inside = await h.call<Invitation[]>(security, "GET", "/security/currently-inside");
    const me = inside.data.find((i) => i.invitationId === pass.invitation.invitationId)!;
    expect(me).toMatchObject({ status: "CHECKED_IN", overdue: true });
  });

  it("daily summaries are deterministic on re-run", async () => {
    const { h } = await setup();
    await h.runtime.services.jobs.run("daily-summary", "cmty_lakeview");
    const a = await h.call(DEMO_ACCOUNTS.admin, "GET", "/admin/analytics");
    await h.runtime.services.jobs.run("daily-summary", "cmty_lakeview");
    const b = await h.call(DEMO_ACCOUNTS.admin, "GET", "/admin/analytics");
    expect(b.data).toEqual(a.data);
  });
});

describe("notifications", () => {
  it("notifies the resident on entry and exit exactly once per event", async () => {
    const { h, pass } = await setup();
    await h.call(security, "POST", "/security/verify-qr", { payload: pass.qrPayload });
    await h.call(security, "POST", "/security/verify-qr", { payload: pass.qrPayload });
    await h.call(security, "POST", "/security/record-entry", { payload: pass.qrPayload });
    const list = await h.call<Page<AppNotification>>(resident, "GET", "/notifications?limit=50");
    const recent = list.data.items.filter((n) => n.message.includes("Job Guest"));
    expect(recent.filter((n) => n.type === "VISITOR_ARRIVAL")).toHaveLength(1);
    expect(recent.filter((n) => n.type === "VISITOR_ENTRY")).toHaveLength(1);
  });

  it("an outbound delivery failure never fails the gate operation", async () => {
    const { h, pass } = await setup();
    await h.call(resident, "PATCH", "/me", { notificationPrefs: { email: true, sms: false, types: ["VISITOR_ENTRY"] } });
    h.runtime.deps.notifier.send = async () => {
      throw new Error("SNS throttled");
    };
    const entry = await h.call<Invitation>(security, "POST", "/security/record-entry", { payload: pass.qrPayload });
    expect(entry.status).toBe(200);
    const list = await h.call<Page<AppNotification>>(resident, "GET", "/notifications?unreadOnly=true");
    expect(list.data.items.some((n) => n.type === "VISITOR_ENTRY")).toBe(true);
  });

  it("delivers e-mail per preferences via the notifier and supports mark-as-read", async () => {
    const { h, pass } = await setup();
    await h.call(resident, "PATCH", "/me", { notificationPrefs: { email: true, sms: false, types: ["VISITOR_ENTRY"] } });
    await h.call(security, "POST", "/security/record-entry", { payload: pass.qrPayload });
    const outbox = await h.runtime.demo!.outbox.list();
    expect(outbox.some((m) => m.channel === "EMAIL" && m.subject === "Visitor entered")).toBe(true);
    const list = await h.call<Page<AppNotification>>(resident, "GET", "/notifications?unreadOnly=true");
    const target = list.data.items[0]!;
    expect((await h.call(resident, "PATCH", `/notifications/${target.notificationId}/read`)).status).toBe(200);
    expect((await h.call(security, "PATCH", `/notifications/${target.notificationId}/read`)).status).toBe(404);
  });
});
