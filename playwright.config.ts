import { defineConfig, devices } from "@playwright/test";

// E2E smoke suite. Hermetic by default: Playwright builds and starts the
// production server locally with placeholder secrets and the demo dataset, then
// runs read-only smoke checks against it. Point at a deployed instance instead
// with E2E_BASE_URL (skips the local webServer).
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const useExternal = Boolean(process.env.E2E_BASE_URL);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL,
    trace: "on-first-retry",
    // Pre-installed Chromium in the CI/dev image.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: useExternal
    ? undefined
    : {
        command: "npm run build && npm run start",
        url: "http://127.0.0.1:3000",
        timeout: 240_000,
        reuseExistingServer: !process.env.CI,
        env: {
          NODE_ENV: "production",
          EMDR_DEMO: "1",
          EMDR_SESSION_SECRET: "e2e-placeholder-session-secret-not-a-real-secret",
          EMDR_DATA_KEY: "e2e-placeholder-data-key",
        },
      },
});
