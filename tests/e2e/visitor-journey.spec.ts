import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";

const PASSWORD = "GateKeeper@2026";
const ADMIN = "admin@gatekeeper.demo";
const SECURITY = "security@gatekeeper.demo";
const RESIDENT = "resident@gatekeeper.demo";
const OTHER_SECURITY = "security@harborpoint.demo";

async function signIn(browser: Browser, email: string, password = PASSWORD): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  return page;
}

/** Authenticated API calls reuse the page's httpOnly session cookie. */
const apiOf = (page: Page): APIRequestContext => page.context().request;

test.describe.serial("GateKeeper visitor journey", () => {
  let admin: Page;
  let resident: Page;
  let security: Page;
  let payload = "";
  const visitorName = `E2E Guest ${Date.now().toString().slice(-5)}`;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/demo/reset");
    expect(res.ok()).toBeTruthy();
  });

  test("Scenario 1: admin creates an apartment and a resident", async ({ browser }) => {
    admin = await signIn(browser, ADMIN);
    await expect(admin).toHaveURL(/\/admin\/dashboard/);

    await admin.goto("/admin/apartments");
    await admin.getByRole("button", { name: "Add apartment" }).click();
    const aptDialog = admin.getByRole("dialog");
    await aptDialog.getByLabel("Building").selectOption({ label: "Tower B" });
    await aptDialog.getByLabel("Unit number").fill("B-707");
    await aptDialog.getByLabel("Floor").fill("7");
    await aptDialog.getByRole("button", { name: "Add apartment" }).click();
    await expect(admin.getByRole("cell", { name: "B-707", exact: true })).toBeVisible();

    await admin.goto("/admin/residents");
    await admin.getByRole("button", { name: "Add resident" }).click();
    const dialog = admin.getByRole("dialog");
    await dialog.getByLabel("Full name").fill("Rohit Menon");
    await dialog.getByLabel("E-mail").fill("rohit.menon@lakeview.demo");
    await dialog.getByLabel("Phone").fill("+91 98450 77777");
    await dialog.getByLabel("Apartment").selectOption({ label: "Tower B · B-707" });
    await dialog.getByRole("button", { name: "Add resident" }).click();
    const tempPassword = (await admin.getByTestId("temp-password").textContent())!.trim();
    await admin.getByRole("button", { name: "Done" }).click();
    await expect(admin.getByRole("cell", { name: "Rohit Menon", exact: true })).toBeVisible();

    // The new resident must replace the temporary password at first sign-in.
    const fresh = await signIn(browser, "rohit.menon@lakeview.demo", tempPassword);
    await expect(fresh.getByText("Choose a new password")).toBeVisible();
    await fresh.getByLabel("New password").fill("Rohit-Secure-2026");
    await fresh.getByLabel("Confirm password").fill("Rohit-Secure-2026");
    await fresh.getByRole("button", { name: /save password/i }).click();
    await expect(fresh).toHaveURL(/\/resident\/dashboard/);
    await expect(fresh.getByText("Tower B · B-707").first()).toBeVisible();
    await fresh.context().close();
  });

  test("Scenario 2: resident creates a visitor invitation", async ({ browser }) => {
    resident = await signIn(browser, RESIDENT);
    await expect(resident).toHaveURL(/\/resident\/dashboard/);
    await resident.goto("/resident/invitations/new");
    await resident.getByLabel("Full name").fill(visitorName);
    await resident.getByLabel("Phone number").fill("+91 98765 12121");
    await resident.getByLabel("Purpose of visit").fill("Evening visit");
    await resident.getByRole("switch").click(); // require approval before entry
    await resident.getByRole("button", { name: "Create pass" }).click();
    await expect(resident.getByText("Pass ready")).toBeVisible();
    payload = (await resident.getByTestId("qr-code").getAttribute("data-payload"))!;
    expect(payload).toMatch(/^GK1\./);
    expect(payload).not.toContain("E2E");
  });

  test("Scenario 3: resident approves the visitor", async () => {
    await resident.goto("/resident/invitations");
    await resident.getByRole("tab", { name: "Needs approval" }).click();
    await resident.getByRole("button", { name: new RegExp(visitorName) }).click();
    await resident.getByRole("button", { name: "Approve entry" }).click();
    await expect(resident.getByRole("dialog").getByText("Approved", { exact: true })).toBeVisible();
    await resident.keyboard.press("Escape");
  });

  test("Scenario 4: security verifies the QR pass", async ({ browser }) => {
    security = await signIn(browser, SECURITY);
    await expect(security).toHaveURL(/\/security\/dashboard/);
    await security.goto("/security/scan");
    await security.getByLabel("Gate code or pass").fill(payload);
    await security.getByRole("button", { name: "Verify" }).click();
    const result = security.getByTestId("verification-result");
    await expect(result).toHaveAttribute("data-valid", "true");
    await expect(result.getByTestId("verification-title")).toHaveText("Pass verified");
    await expect(result.getByText(visitorName)).toBeVisible();
  });

  test("Scenario 5: security records visitor entry (and duplicates are refused)", async () => {
    await security.getByRole("button", { name: /record entry/i }).click();
    await expect(security.getByText(`Entry recorded for ${visitorName}`)).toBeVisible();
    const dup = await apiOf(security).post("/api/v1/security/record-entry", { data: { payload } });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).error.code).toBe("DUPLICATE_ENTRY");
  });

  test("Scenario 6: admin sees the visitor inside the premises", async () => {
    await admin.goto("/admin/dashboard");
    await expect(admin.getByTestId("currently-inside").getByText(visitorName)).toBeVisible();
  });

  test("Scenario 7: security records visitor exit", async () => {
    await security.goto("/security/currently-inside");
    await security.getByRole("button", { name: `Record exit for ${visitorName}` }).click();
    await expect(security.getByText(`Exit recorded for ${visitorName}`)).toBeVisible();
    await expect(security.getByTestId("currently-inside").getByText(visitorName)).toHaveCount(0);
  });

  test("Scenario 8: resident sees the completed visit in history", async () => {
    await resident.goto("/resident/visitors");
    const history = resident.getByTestId("visitor-history");
    await history.getByLabel("Search visitors").fill(visitorName);
    const row = history.getByRole("row", { name: new RegExp(visitorName) });
    await expect(row).toBeVisible();
    await expect(row.getByText("Completed")).toBeVisible();
  });

  test.afterAll(async () => {
    for (const p of [admin, resident, security]) await p?.context().close();
  });
});

test.describe("Negative scenarios", () => {
  let resident: Page;
  let security: Page;

  test.beforeAll(async ({ browser }) => {
    resident = await signIn(browser, RESIDENT);
    await expect(resident).toHaveURL(/\/resident\/dashboard/);
    security = await signIn(browser, SECURITY);
    await expect(security).toHaveURL(/\/security\/dashboard/);
  });
  test.afterAll(async () => {
    await resident.context().close();
    await security.context().close();
  });

  const createPass = async (arrivalOffsetMin: number, departureOffsetMs: number) => {
    const res = await apiOf(resident).post("/api/v1/invitations", {
      data: {
        visitor: { fullName: "Negative Case", phone: "+91 90000 45454", category: "GUEST", purpose: "Test" },
        expectedArrival: new Date(Date.now() + arrivalOffsetMin * 60_000).toISOString(),
        expectedDeparture: new Date(Date.now() + departureOffsetMs).toISOString(),
      },
    });
    expect(res.status()).toBe(201);
    return (await res.json()).data as { qrPayload: string; invitation: { invitationId: string } };
  };

  const verifyInUi = async (page: Page, value: string) => {
    await page.goto("/security/scan");
    await page.getByLabel("Gate code or pass").fill(value);
    await page.getByRole("button", { name: "Verify" }).click();
    return page.getByTestId("verification-result");
  };

  test("invalid QR is rejected", async () => {
    const result = await verifyInUi(security, `GK1.${"x".repeat(43)}`);
    await expect(result).toHaveAttribute("data-valid", "false");
    await expect(result.getByTestId("verification-message")).toHaveText("This QR code is not a valid GateKeeper pass.");
  });

  test("expired QR is rejected", async () => {
    const pass = await createPass(-50, 4_000);
    await security.waitForTimeout(5_000);
    const result = await verifyInUi(security, pass.qrPayload);
    await expect(result.getByTestId("verification-message")).toHaveText("This pass has expired.");
  });

  test("cancelled invitation is rejected", async () => {
    const pass = await createPass(10, 3 * 3_600_000);
    expect((await apiOf(resident).post(`/api/v1/invitations/${pass.invitation.invitationId}/cancel`)).ok()).toBeTruthy();
    const result = await verifyInUi(security, pass.qrPayload);
    await expect(result.getByTestId("verification-message")).toHaveText("The resident cancelled this invitation.");
  });

  test("rejected walk-in cannot enter", async () => {
    const apts = await (await apiOf(security).get("/api/v1/apartments")).json();
    const apt = apts.data.find((a: { unitNumber: string }) => a.unitNumber === "A-1204");
    const walkIn = await apiOf(security).post("/api/v1/security/manual-entry", {
      data: { visitor: { fullName: "Unexpected Courier", phone: "+91 90000 67676", category: "DELIVERY", purpose: "Parcel" }, apartmentId: apt.apartmentId },
    });
    const id = (await walkIn.json()).data.invitationId;
    await resident.goto(`/resident/invitations?focus=${id}`);
    await resident.getByRole("button", { name: /^reject$/i }).click();
    await resident.getByRole("button", { name: "Confirm rejection" }).click();
    await expect(resident.getByRole("dialog").getByText("Rejected", { exact: true })).toBeVisible();
    const entry = await apiOf(security).post("/api/v1/security/record-entry", { data: { invitationId: id } });
    expect(entry.status()).toBe(409);
    expect((await entry.json()).error.code).toBe("REJECTED");
  });

  test("unauthorized access is blocked in the UI and the API", async ({ browser }) => {
    await resident.goto("/admin/dashboard");
    await expect(resident).toHaveURL(/\/resident\/dashboard/);
    expect((await apiOf(resident).get("/api/v1/admin/analytics")).status()).toBe(403);
    const anon = await browser.newContext();
    const page = await anon.newPage();
    await page.goto("/security/scan");
    await expect(page).toHaveURL(/\/login\?next=%2Fsecurity%2Fscan/);
    expect((await page.request.get("/api/v1/me")).status()).toBe(401);
    await anon.close();
  });

  test("cross-tenant pass use is rejected", async ({ browser }) => {
    const pass = await createPass(10, 3 * 3_600_000);
    const other = await signIn(browser, OTHER_SECURITY);
    await expect(other).toHaveURL(/\/security\/dashboard/);
    const result = await verifyInUi(other, pass.qrPayload);
    await expect(result.getByTestId("verification-message")).toHaveText("This pass belongs to a different community.");
    await expect(result.getByText("Negative Case")).toHaveCount(0);
    await other.context().close();
  });
});

test.describe("Transport and response security", () => {
  test("pages and API responses carry security headers and no framework fingerprint", async ({ request }) => {
    const page = await request.get("/login");
    const h = page.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"]).toContain("default-src 'self'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toContain("camera=(self)");
    expect(h["strict-transport-security"]).toContain("max-age=");
    expect(h["x-powered-by"]).toBeUndefined();

    const api = await request.get("/api/v1/me");
    expect(api.status()).toBe(401);
    expect(api.headers()["cache-control"]).toContain("no-store");
    const body = await api.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(JSON.stringify(body)).not.toMatch(/at \w+ \(|node_modules|stack/i);
  });

  test("cross-site state-changing requests are rejected", async ({ request }) => {
    const res = await request.post("/api/v1/notifications/read-all", { headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" } });
    expect(res.status()).toBe(403);
    expect((await res.json()).error.code).toBe("CSRF_REJECTED");
  });

  test("session cookies are httpOnly and SameSite", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill("resident@gatekeeper.demo");
    await page.getByLabel("Password", { exact: true }).fill("GateKeeper@2026");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/resident\/dashboard/);
    const cookies = (await page.context().cookies()).filter((c) => c.name.startsWith("gk_"));
    expect(cookies.map((c) => c.name).sort()).toEqual(["gk_at", "gk_exp", "gk_rt"]);
    for (const c of cookies) {
      expect(c.httpOnly).toBe(true);
      expect(c.sameSite).toBe("Lax");
    }
    expect(await page.evaluate(() => document.cookie)).not.toContain("gk_");
  });

  test("demo-only UI is decided at request time, not baked in at build time", async ({ request }) => {
    // This server runs LOCAL_DEMO, so the demo panel must render; the page is dynamic, not prerendered.
    const html = await (await request.get("/login")).text();
    expect(html).toContain("Demo accounts");
    expect(html).toContain("Local demo");
  });
});
