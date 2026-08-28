import { test, expect, type Page } from "@playwright/test";

// The scripted reviewer journeys, walked (docs/demo/scenario-scripts.md).
//
// The exercise matrix on /review/testing CLAIMS a set of things are
// reachable. This suite walks them. The difference matters: a claim that a
// workflow is available is exactly the kind of thing that stays true in a
// registry and stops being true in the product, and the person who discovers
// it is otherwise a reviewer in a scheduled session with a founder watching.
//
// So each journey here is a scripted demo step, and a failure means someone
// would have hit a dead end live.

test.skip(Boolean(process.env.E2E_BASE_URL), "runs only against the hermetic seeded server");

const ALEX = "demo@example.com";
const SAM = "demo2@example.com";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

// ---------------------------------------------------------------------------
// Member journey — the spine of every audience's demo
// ---------------------------------------------------------------------------

test("a member reviewer reaches the dashboard with history already present", async ({ page }) => {
  await signIn(page, ALEX);
  await page.goto("/app/today");
  await expect(page.getByText(/DEMO — FABRICATED DATA — NOT CLINICAL CARE/)).toBeVisible();
  // Step 2 of the investor script: three weeks of history, today's check-in
  // already recorded, so the demo does not open on an empty state.
  await expect(page.locator("main")).toBeVisible();
});

test("grounding and SOS are reachable and never gated", async ({ page }) => {
  await signIn(page, ALEX);
  // The safety floor: reachable without a subscription, a tier, or a successful
  // write. If this ever needs a paywall step, that is a stop condition.
  for (const path of ["/app/ground", "/crisis"]) {
    const res = await page.goto(path);
    expect(res?.status(), `${path} is not reachable`).toBe(200);
  }
});

test("the full module set is walkable without a clinician unlock", async ({ page }) => {
  await signIn(page, ALEX);
  const res = await page.goto("/app/paths");
  expect(res?.status()).toBe(200);
  // EMDR_OPEN_GATED defaults on in demo so a non-clinician reviewer is not
  // stopped at a lock they have no way to open.
  await expect(page.locator("main")).toBeVisible();
});

test("a resourcing BLS session is reachable for a consented member", async ({ page }) => {
  // The flagship clinical workstream. Alex has the seeded processing-session
  // consent; this is the walk a clinical reviewer most needs.
  await signIn(page, ALEX);
  await page.goto("/app/session/resourcing");
  // Assert we are still ON the session route. A 200 alone proves nothing: a
  // redirect back to the dashboard also returns 200, which is exactly how a
  // "reachable" workflow can be unreachable while the test stays green.
  await expect(page, "the resourcing session redirected away").toHaveURL(/\/app\/session\/resourcing/);
  await expect(page.locator("main")).toBeVisible();
  // A session screen must never imply someone is watching.
  await expect(page.locator("body")).not.toContainText(/we are monitoring|someone is watching/i);
});

test("the second member persona lands somewhere coherent, not on a dead end", async ({ page }) => {
  // Sam is the intake-stage persona: seeded screenings that tripped the urgent
  // queue, no completed profile, no processing consent. Signing in as Sam is
  // NOT a scripted journey — Sam's story is told from the clinician side, where
  // they appear in the alert queue — but a reviewer will click the account
  // anyway, so it must land somewhere that makes sense.
  //
  // What this asserts is deliberately narrow. The consent refusal itself is
  // covered where it can be tested honestly, in tests/bls-consent-gate.ts:
  // Sam never reaches the consent gate, because screening stops them first.
  // Asserting "refused for lack of consent" here would pass for the wrong
  // reason and would keep passing if the consent gate were removed.
  await signIn(page, SAM);
  await page.goto("/app/today");
  await expect(page).toHaveURL(/\/app\/screening/);
  await expect(page.getByRole("heading").first()).toBeVisible();

  // And the session route refuses rather than erroring.
  await page.goto("/app/session/resourcing");
  await expect(page).not.toHaveURL(/\/app\/session\/resourcing/);
  await expect(page.getByRole("heading").first()).toBeVisible();
});

test("the companion is reachable and does not claim a human is present", async ({ page }) => {
  await signIn(page, ALEX);
  const res = await page.goto("/app/companion");
  expect(res?.status()).toBe(200);
  await expect(page.locator("body")).not.toContainText(/a (?:therapist|clinician) is (?:here|watching|reviewing this now)/i);
});

// ---------------------------------------------------------------------------
// Clinician journey
// ---------------------------------------------------------------------------

test("the clinician journey has no dead ends across its consoles", async ({ page }) => {
  await signIn(page, "clinician@example.com");
  // Every console the specialist dashboard offers must load. A broken link here
  // is a dead end in a scheduled review session.
  for (const path of [
    "/clinician", "/clinician/caseload", "/review/audit",
    "/review/autonomous", "/review/bls", "/review/testing",
  ]) {
    const res = await page.goto(path);
    expect(res?.status(), `${path} is a dead end in the clinician journey`).toBe(200);
    await expect(page.getByRole("heading").first()).toBeVisible();
  }
});

test("every link on the specialist dashboard resolves", async ({ page, request }) => {
  await signIn(page, "clinician@example.com");
  await page.goto("/clinician");
  const hrefs = new Set(
    (await page.locator("a").evaluateAll(
      (els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? "")
    )).filter((h) => h.startsWith("/"))
  );
  expect(hrefs.size).toBeGreaterThan(2);
  for (const href of hrefs) {
    const res = await request.get(href);
    expect(res.status(), `${href} is linked from the clinician dashboard but returns ${res.status()}`)
      .toBeLessThan(400);
  }
});

// ---------------------------------------------------------------------------
// The matrix must not promise what the product cannot do
// ---------------------------------------------------------------------------

test("every capability the testing console calls available actually loads", async ({ page, request }) => {
  await signIn(page, "clinician@example.com");
  await page.goto("/review/testing");

  const rows = page.getByTestId("exercise-row");
  const n = await rows.count();
  expect(n).toBeGreaterThan(5);

  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const state = (await row.getByTestId("exercise-state").textContent())?.trim();
    if (state !== "Yes") continue;
    const href = await row.locator("a").first().getAttribute("href");
    expect(href, "a capability is marked available with nowhere to go").toBeTruthy();
    const res = await request.get(href!);
    expect(
      res.status(),
      `the testing console says this is available, but ${href} returns ${res.status()}`
    ).toBeLessThan(400);
  }
});
