import { test, expect, type Page } from "@playwright/test";

// The gate as a paced sequence (Presentation Layer Handoff §5).
//
// The unit tests cover the state machine. These cover the thing a unit test
// cannot: that a person can actually walk it, leave it, and come back — with
// no JavaScript required, because every step is a form post.

test.skip(Boolean(process.env.E2E_BASE_URL), "runs only against the hermetic seeded server");

// Sam is the intake-stage persona: screenings seeded but the profile
// incomplete, so /dashboard routes to the gate. Exactly the member this flow
// exists for.
/** Click an option and wait for the redirect to land.
 *
 *  Each option is a form post, so the button detaches the moment it is clicked.
 *  Playwright's auto-retry then chases a stale element until it times out —
 *  waiting on the URL is what actually expresses "the step completed". */
async function answer(page: Page, nth = 0) {
  const before = page.url();
  await page.getByTestId("gate-option").nth(nth).click({ noWaitAfter: true });
  await page.waitForFunction((u) => location.href !== u, before, { timeout: 15_000 });
}

async function signInAsSam(page: Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("demo2@example.com");
  await page.locator('input[name="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("one question per screen, with position rather than a percentage", async ({ page }) => {
  await signInAsSam(page);
  // pcl-5 is the read-only instrument for this suite — no test writes to it,
  // so "Question 1 of" is a stable assertion. Every other test owns a
  // different questionnaire, because the suite runs in parallel against one
  // server and one persona.
  await page.goto("/screening/pcl-5");

  // Exactly one question. Vol 1 B-6: one primary task per screen, minimal
  // reading during activation.
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByTestId("gate-position")).toHaveText(/Question 1 of \d+/);

  // §5: "Avoid a progress bar reading 30% — percentage framing invites
  // abandonment maths."
  await expect(page.locator("main")).not.toContainText("%");
  await expect(page.locator("main [role=progressbar]")).toHaveCount(0);

  // Nothing is preselected: the question has not been answered.
  await expect(page.locator("[data-testid=gate-option][aria-current]")).toHaveCount(0);
});

test("answering advances, and leaving entirely resumes where you were", async ({ page }) => {
  await signInAsSam(page);
  await page.goto("/screening/gad-7");
  await expect(page.getByTestId("gate-position")).toHaveText(/Question 1 of/);

  await answer(page);
  await expect(page.getByTestId("gate-position")).toHaveText(/Question 2 of/);

  // Leave the flow completely — not a back button, an actual departure.
  await page.goto("/dashboard");
  await page.goto("/screening/gad-7");

  // §5: "Resumable by default, saved continuously… Never a 'start over.'"
  await expect(page.getByTestId("gate-position")).toHaveText(/Question 2 of/);
});

test("stepping back shows the answer you gave, and it can be changed", async ({ page }) => {
  await signInAsSam(page);
  await page.goto("/screening/itq");
  await answer(page);
  await expect(page.getByTestId("gate-position")).toHaveText(/Question 2 of/);

  await page.getByRole("link", { name: "Previous question" }).click();
  await expect(page.getByTestId("gate-position")).toHaveText(/Question 1 of/);
  // The recorded answer comes back marked, so someone correcting a mis-tap can
  // see what they are correcting.
  await expect(page.locator("[data-testid=gate-option][aria-current]")).toHaveCount(1);

  // And changing it works — a member fixing a mistake is not an attacker.
  await answer(page, 1);
  await page.goto("/screening/itq?i=0");
  await expect(page.getByTestId("gate-option").nth(1)).toHaveAttribute("aria-current", "true");
});

test("every step offers a pause, never a quit", async ({ page }) => {
  await signInAsSam(page);
  await page.goto("/screening/phq-9");

  for (let step = 0; step < 3; step++) {
    // §5: "Exit affordance on every step. Labeled as a pause, not a quit —
    // the 'no-guilt close.' Consistent position across all 14."
    const pause = page.getByTestId("gate-pause");
    await expect(pause).toBeVisible();
    await expect(pause).toHaveText(/pause/i);
    await expect(page.locator("main")).not.toContainText(/\b(quit|cancel|discard|start over)\b/i);
    await answer(page);
  }

  // Pausing leaves, and nothing is lost by it.
  await page.getByTestId("gate-pause").click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/screening/phq-9");
  await expect(page.getByTestId("gate-position")).toHaveText(/Question 4 of/);
});

test("the gate terminates in a day, not a score", async ({ page }) => {
  await signInAsSam(page);
  // pc-ptsd-5 is the shortest instrument — walk it to the end.
  await page.goto("/screening/pc-ptsd-5");
  // Walk to the end. Each click is a form post that redirects, so the button
  // detaches mid-click — wait for the URL to actually change rather than
  // letting Playwright retry against a stale element.
  for (let i = 0; i < 12; i++) {
    if (/done=1/.test(page.url())) break;
    const options = page.getByTestId("gate-option");
    if ((await options.count()) === 0) break;
    await answer(page);
  }
  // If every item is answered but we are not on the finish screen, follow the
  // explicit link — the sequence offers one rather than trapping anyone.
  if (!/done=1/.test(page.url())) {
    const finish = page.getByRole("link", { name: "Finish" });
    if (await finish.count()) await finish.click();
  }
  await expect(page).toHaveURL(/done=1/);

  // §5: "No result screen with a number. The gate terminates in a Day State,
  // not a score."
  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/\b\d+\s*\/\s*\d+\b/);
  expect(body.toLowerCase()).not.toContain("score");
  expect(body.toLowerCase()).not.toContain("severity");
});

test("the gate is never rendered in an alarm register", async ({ page }) => {
  // §5: "Denial is not an error state… No red. No warning iconography. No
  // apology." The whole flow stays in one visual register.
  await signInAsSam(page);
  await page.goto("/screening/pcl-5");
  const alarm = await page.locator("main [class*='support'], main [class*='red-']").count();
  expect(alarm, "the gate uses an alarm colour").toBe(0);
});

test("the sequence works as plain form posts", async ({ page, context }) => {
  // No JavaScript. A member on a bad connection at 2am is exactly who this
  // flow exists for, and "resumable by default" has to survive an unhydrated
  // page.
  await signInAsSam(page);
  await context.addInitScript(() => {
    // Nothing to disable — the assertion is that each option is a real submit
    // button inside its own form, which works without client JS at all.
  });
  await page.goto("/screening/pcl-5");
  const isFormButton = await page.getByTestId("gate-option").first().evaluate(
    (el) => el.tagName === "BUTTON" && Boolean(el.closest("form"))
  );
  expect(isFormButton, "an option is not a plain form submit").toBe(true);
});
