import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Invitation, InvitationDetail } from "@/shared/types";
import { mockFetch, renderWithClient } from "../helpers/render";

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), params: new URLSearchParams(), pathname: "/resident/dashboard" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push, refresh: nav.refresh }),
  useSearchParams: () => nav.params,
  usePathname: () => nav.pathname,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));

beforeEach(() => {
  nav.replace.mockReset();
  nav.params = new URLSearchParams();
});
afterEach(() => vi.unstubAllGlobals());

const invitation = (over: Partial<Invitation> = {}): Invitation => ({
  invitationId: "inv_1",
  code: "ABC-DEF",
  communityId: "c",
  visitorId: "v",
  visitor: { fullName: "Imran Khan", phone: "+91 98765 43210", category: "DELIVERY", purpose: "Swiggy order", vehicleNumber: null },
  residentId: "r",
  residentName: "Ananya",
  apartmentId: "a",
  apartmentLabel: "Tower A · A-1204",
  expectedArrival: new Date().toISOString(),
  expectedDeparture: new Date(Date.now() + 3600_000).toISOString(),
  validFrom: new Date(Date.now() - 3600_000).toISOString(),
  expiry: new Date(Date.now() + 3600_000).toISOString(),
  status: "PENDING_APPROVAL",
  usagePolicy: "SINGLE_USE",
  usageCount: 0,
  source: "WALK_IN",
  notes: null,
  photoKey: null,
  createdBy: "g",
  createdByName: "Ravi Kumar",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  decidedAt: null,
  rejectionReason: null,
  lastEntryAt: null,
  lastEntryGuardName: null,
  lastExitAt: null,
  lastExitGuardName: null,
  overdue: false,
  ...over,
});

describe("Login form", () => {
  it("validates input before calling the API", async () => {
    const calls = mockFetch({});
    const { LoginForm } = await import("@/features/auth/login-form");
    renderWithClient(<LoginForm demo={false} />);
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText("Enter a valid e-mail address")).toBeInTheDocument();
    expect(screen.getByText("Enter your password")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("fills demo credentials and redirects to the server-chosen dashboard", async () => {
    const calls = mockFetch({ "POST /api/auth/login": () => ({ status: "SIGNED_IN", redirectTo: "/security/dashboard" }) });
    const { LoginForm } = await import("@/features/auth/login-form");
    renderWithClient(<LoginForm demo />);
    await userEvent.click(screen.getByRole("button", { name: "Use the demo security account" }));
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/security/dashboard"));
    expect(calls[0]!.body).toEqual({ email: "security@gatekeeper.demo", password: "GateKeeper@2026" });
  });

  it("shows server errors and the forced password-change step", async () => {
    mockFetch({ "POST /api/auth/login": () => ({ status: "NEW_PASSWORD_REQUIRED", session: "s" }) });
    const { LoginForm } = await import("@/features/auth/login-form");
    renderWithClient(<LoginForm demo={false} />);
    await userEvent.type(screen.getByLabelText("E-mail"), "new@x.demo");
    await userEvent.type(screen.getByLabelText("Password"), "Temp-pass-1");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText("Choose a new password")).toBeInTheDocument();
  });
});

describe("Invite visitor form", () => {
  it("rejects invalid input and submits a valid invitation as ISO timestamps", async () => {
    const calls = mockFetch({
      "GET /api/v1/visitors": () => ({ items: [], nextCursor: null }),
      "POST /api/v1/invitations": () => ({
        invitation: invitation({ status: "APPROVED", visitor: { ...invitation().visitor, fullName: "Rahul Verma" } }),
        qrPayload: `GK1.${"a".repeat(43)}`,
      }),
    });
    const { InviteForm } = await import("@/features/resident/invite-form");
    renderWithClient(<InviteForm />);
    await userEvent.click(screen.getByRole("button", { name: /create pass/i }));
    expect(await screen.findByText(/Visitor name must be at least 2/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);

    await userEvent.type(screen.getByLabelText("Full name"), "Rahul Verma");
    await userEvent.type(screen.getByLabelText("Phone number"), "+91 98765 43210");
    await userEvent.type(screen.getByLabelText("Purpose of visit"), "Dinner");
    await userEvent.click(screen.getByRole("radio", { name: /delivery/i }));
    await userEvent.click(screen.getByRole("button", { name: /create pass/i }));
    expect(await screen.findByText("Pass ready")).toBeInTheDocument();
    const post = calls.find((c) => c.method === "POST")!.body as { visitor: { category: string }; expectedArrival: string; preApproved: boolean };
    expect(post.visitor.category).toBe("DELIVERY");
    expect(post.expectedArrival).toMatch(/Z$/);
    expect(post.preApproved).toBe(true);
    expect(screen.getByTestId("qr-code")).toBeInTheDocument();
  });
});

describe("QR scanner fallback", () => {
  it("normalises gate codes, raw payloads and shared pass links", async () => {
    const { normalizeManualInput } = await import("@/features/security/scan-page");
    const payload = `GK1.${"b".repeat(43)}`;
    expect(normalizeManualInput("abc-def")).toEqual({ kind: "code", value: "ABC-DEF" });
    expect(normalizeManualInput(payload)).toEqual({ kind: "payload", value: payload });
    expect(normalizeManualInput(`https://app.example/pass#${payload}`)).toEqual({ kind: "payload", value: payload });
    expect(normalizeManualInput("  ")).toBeNull();
  });

  it("explains when no camera is available and verifies manually", async () => {
    vi.stubGlobal("navigator", { ...navigator, mediaDevices: undefined });
    mockFetch({
      "POST /api/v1/security/verify-qr": () => ({
        valid: false,
        failure: "EXPIRED",
        message: "This pass has expired.",
        invitation: invitation({ status: "APPROVED" }),
        allowedAction: null,
      }),
    });
    const { ScanPage } = await import("@/features/security/scan-page");
    renderWithClient(<ScanPage />);
    await userEvent.click(screen.getByRole("button", { name: /open camera/i }));
    expect(await screen.findByText("No camera available")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Gate code or pass"), `GK1.${"c".repeat(43)}`);
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    const panel = await screen.findByTestId("verification-result");
    expect(within(panel).getByText("Access denied")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /record entry/i })).not.toBeInTheDocument();
  });
});

describe("Approval controls", () => {
  it("residents can approve a pending walk-in", async () => {
    const calls = mockFetch({
      "GET /api/v1/invitations/inv_1": () => ({ invitation: invitation(), timeline: [] }) satisfies InvitationDetail,
      "POST /api/v1/invitations/inv_1/approve": () => invitation({ status: "APPROVED" }),
    });
    const { InvitationDialog } = await import("@/features/invitations/invitation-dialog");
    renderWithClient(<InvitationDialog invitationId="inv_1" role="RESIDENT" onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: /approve entry/i }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith("/approve"))).toBe(true));
  });

  it("rejection asks for an optional reason; guards never see approval controls", async () => {
    const calls = mockFetch({
      "GET /api/v1/invitations/inv_1": () => ({ invitation: invitation(), timeline: [] }),
      "POST /api/v1/invitations/inv_1/reject": () => invitation({ status: "REJECTED" }),
    });
    const { InvitationDialog } = await import("@/features/invitations/invitation-dialog");
    const { unmount } = renderWithClient(<InvitationDialog invitationId="inv_1" role="RESIDENT" onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: /^reject$/i }));
    await userEvent.type(screen.getByLabelText(/reason for rejection/i), "Not expecting anyone");
    await userEvent.click(screen.getByRole("button", { name: /confirm rejection/i }));
    await waitFor(() => expect(calls.find((c) => c.path.endsWith("/reject"))?.body).toEqual({ reason: "Not expecting anyone" }));
    unmount();
    renderWithClient(<InvitationDialog invitationId="inv_1" role="SECURITY" onClose={() => {}} />);
    await screen.findAllByText("Imran Khan");
    expect(screen.queryByRole("button", { name: /approve entry/i })).not.toBeInTheDocument();
  });
});

describe("Filtering", () => {
  it("sends period, category and status filters to the API", async () => {
    const calls = mockFetch({ "GET /api/v1/invitations": () => ({ items: [invitation({ status: "COMPLETED" })], nextCursor: null }) });
    const { InvitationBrowser } = await import("@/features/invitations/invitation-browser");
    renderWithClient(<InvitationBrowser role="RESIDENT" />);
    expect(await screen.findByText("Imran Khan")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Period"), "today");
    await userEvent.selectOptions(screen.getByLabelText("Category"), "GUEST");
    await userEvent.selectOptions(screen.getByLabelText("Status"), "COMPLETED");
    await waitFor(() => {
      const last = calls[calls.length - 1]!.url.searchParams;
      expect(last.get("category")).toBe("GUEST");
      expect(last.get("status")).toBe("COMPLETED");
      expect(last.get("from")).toBe(last.get("to"));
    });
  });
});

describe("Role-specific navigation and dashboard", () => {
  it("each role sees only its own navigation", async () => {
    const { NAVIGATION, activeHref } = await import("@/components/layout/navigation");
    const hrefs = (r: keyof typeof NAVIGATION) => NAVIGATION[r].flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs("RESIDENT").every((h) => h.startsWith("/resident/"))).toBe(true);
    expect(hrefs("SECURITY").every((h) => h.startsWith("/security/"))).toBe(true);
    expect(hrefs("ADMIN").every((h) => h.startsWith("/admin/"))).toBe(true);
    expect(activeHref("RESIDENT", "/resident/invitations/new")).toBe("/resident/invitations/new");
  });

  it("redirects a user who opens another role's area", async () => {
    mockFetch({
      "GET /api/v1/me": () => ({
        profile: { userId: "u", fullName: "Ravi Kumar", email: "s@x", role: "SECURITY", status: "ACTIVE", apartmentLabel: null },
        community: { communityId: "c", name: "Lakeview", timezone: "Asia/Kolkata" },
        unreadNotifications: 0,
      }),
    });
    const { AppShell } = await import("@/components/layout/app-shell");
    renderWithClient(<AppShell role="ADMIN">secret admin content</AppShell>);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/security/dashboard"));
    expect(screen.queryByText("secret admin content")).not.toBeInTheDocument();
  });

  it("renders the resident dashboard with overview data", async () => {
    mockFetch({
      "GET /api/v1/me": () => ({ profile: { fullName: "Ananya Sharma", apartmentLabel: "Tower A · A-1204" }, community: {}, unreadNotifications: 0 }),
      "GET /api/v1/resident/overview": () => ({
        visitorsThisMonth: 14,
        insideNow: 1,
        pendingRequests: 1,
        upcoming: [invitation({ status: "APPROVED", visitor: { ...invitation().visitor, fullName: "Rahul Verma" } })],
        recentActivity: [],
        announcements: [],
      }),
      "GET /api/v1/invitations": () => ({ items: [invitation()], nextCursor: null }),
    });
    const { ResidentDashboard } = await import("@/features/resident/resident-dashboard");
    renderWithClient(<ResidentDashboard />);
    expect(await screen.findByText("14")).toBeInTheDocument();
    expect(await screen.findByText("Rahul Verma")).toBeInTheDocument();
    expect(await screen.findByTestId("pending-approvals")).toHaveTextContent("Imran Khan");
  });
});
