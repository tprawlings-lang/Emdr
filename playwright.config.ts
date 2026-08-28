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
        // Hermetic: the e2e database is removed before the server starts, so every
        // suite run begins from the versioned demo baseline. Resetting here rather
        // than inside the app keeps the destructive step explicit and outside any
        // request path.
        // `demo -- reset` seeds AND runs the genesis backfill, so the event log
        // is populated before the first request. Without it the timeline, the
        // cited summary, and the trajectory all render empty — the suite would
        // pass against a demo that shows a reviewer nothing.
        command: "rm -rf .e2e-data && npm run build && npm run demo -- reset && npm run start",
        url: "http://127.0.0.1:3000",
        timeout: 240_000,
        reuseExistingServer: !process.env.CI,
        env: {
          NODE_ENV: "production",
          EMDR_DEMO: "1",
          // A dedicated data directory, cleared by the command above. Without
          // this the suite writes to .data/ and never clears it, so specs that
          // assert on aggregate state pass once and fail on every re-run.
          EMDR_DATA_DIR: ".e2e-data",
          EMDR_SESSION_SECRET: "e2e-placeholder-session-secret-not-a-real-secret",
          EMDR_DATA_KEY: "e2e-placeholder-data-key",
          // The review gateway is closed when no code is set, so the suite must
          // configure one to exercise the open path. This value is local to the
          // ephemeral e2e server and never reaches a deployed environment.
          EMDR_REVIEW_ACCESS_CODE: "e2e-placeholder-review-code",
        },
      },
});
