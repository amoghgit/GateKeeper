import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;

/**
 * E2E runs against a production build in LOCAL_DEMO mode with its own data
 * file, so it never touches your development demo data. DEMO_ALLOW_RESET
 * enables /api/demo/reset, used to start every run from the seed.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 300_000,
    // Always start a fresh server so a stale process can never serve old data.
    reuseExistingServer: false,
    env: {
      GATEKEEPER_MODE: "LOCAL_DEMO",
      DEMO_DATA_FILE: ".data/e2e-store.json",
      DEMO_ALLOW_RESET: "true",
      GATEKEEPER_INSECURE_COOKIES: "true",
    },
  },
});
