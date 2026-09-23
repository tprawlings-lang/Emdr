import { defineConfig, devices } from "@playwright/test";

// E2E smoke suite. Hermetic by default: Playwright builds and starts the
// production server locally with placeholder secrets and the demo dataset, then
// runs read-only smoke checks against it. Point at a deployed instance instead
// with E2E_BASE_URL (skips the local webServer).
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const useExternal = Boolean(process.env.E2E_BASE_URL);

// THE SPECS THAT WRITE, NAMED ONCE.
//
// The split described below was written and only HALF-APPLIED: `stateful`
// matched these three and `chromium` never excluded them, so every one of them
// also ran in the parallel project, first — precisely the arrangement the
// comment there says causes the flake it was written to fix. demo-clock.spec.ts
// moves a one-row global clock and asserts on what other consoles then show.
//
// Found by a full suite failing on the clock spec in `chromium` while the
// identical spec sat unrun in `stateful`. One pattern, read by both projects,
// so the ignore cannot drift from the match again.
const STATEFUL = /(queue-concurrency|contact-attempts|demo-clock)\.spec\.ts/;

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
  // TWO PROJECTS, BECAUSE ONE SPEC WRITES AND THE REST READ.
  //
  // The config above calls this suite "read-only smoke checks", and it was one
  // until queue-concurrency.spec.ts — a collision between two clinicians cannot
  // be staged without actually completing a review, which closes that person's
  // open alerts. Against the shared seeded dataset that removed the last
  // urgent-band row, and the visual baseline, running in the other worker,
  // reported /clinician/today as having lost a colour: rgb(243, 221, 216), the
  // Immediate badge.
  //
  // I FIRST BLAMED THE DEMO CLOCK and was wrong. UX 003 did put the clinician
  // queue on the demo clock's reading frame, which makes that a plausible
  // story, and running demo-clock.spec.ts beside the baseline proves it is not
  // this one: those two pass together. The clock spec returns the clock to live
  // after every test; my spec had no way to un-close an alert.
  //
  // So the split is by what a spec DOES, not by which file it is: the writers
  // run after the readers, and serially among themselves — the two tests in
  // that file were also consuming each other's rows.
  projects: [
    {
      // BEFORE EVERYTHING, ONCE. Admitting a real participant requires all five
      // gates the environment policy names — two attestations, a completed
      // clinical copy review and a run parity check — and there is no flag that
      // skips that, deliberately: a policy with a test-only door is a policy
      // with a door. Clearing them WRITES state other specs read, so it belongs
      // here rather than in a `beforeAll`, where it ran once per enrollment
      // file inside the parallel project and took three unrelated specs down
      // with it.
      name: "pilot-setup",
      testMatch: /pilot-tier\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testIgnore: [STATEFUL, /pilot-tier\.setup\.ts/],
      dependencies: ["pilot-setup"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "stateful",
      // THESE SPECS WRITE. They run after the read-only projects and in order,
      // because a recorded contact and a completed review change the queue the
      // other one reads. The demo clock joined them after turning up as a flake
      // in a full parallel run and passing every time it was run alone: it
      // moves a ONE-ROW GLOBAL clock and asserts on what other consoles then
      // show, so any spec reading a date while it is mid-move sees a different
      // environment. Serial is not a workaround here — it is what the thing
      // under test actually is.
      testMatch: STATEFUL,
      dependencies: ["chromium"],
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
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
          // Enrollment is closed when no code is set, and the closed path is
          // worth testing too — tests/enrollment-gate.test.ts covers it by
          // unsetting the variable, so the browser suite exercises the open one.
          // Same shape and the same promise: local to this ephemeral server.
          EMDR_ENROLLMENT_CODE: "e2e-placeholder-enrollment-code",
        },
      },
});
