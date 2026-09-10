import { test, expect } from "@playwright/test";

// A new patient's onboarding, walked from the login screen (demo only).
//
// WHAT THIS COVERS THAT THE UNIT TESTS CANNOT. `tests/demo-walkthrough.test.ts`
// owns the four safety properties — demo-only, no input, fabricated, does not
// pre-satisfy the consent gate. This owns the thing they cannot see: that the
// screens actually appear, in order, and that a clinician can then watch the
// far side of them.
//
// THE FIRST VERSION LANDED ON A BLANK PAGE, which is why the route assertions
// below are specific rather than "left the login screen". The action redirected
// to /app/welcome, which is not a gate destination — so the member layout ran
// the care gate on it and redirected again, and a server-action redirect INTO a
// route that redirects leaves the browser sitting at the first URL with nothing
// rendered. A plain GET to the same address behaved correctly, so nothing about
// the page was wrong. Only an assertion on WHERE it lands and WHAT is on the
// screen catches that; "the URL changed" passes it happily.

test.skip(
  Boolean(process.env.E2E_BASE_URL),
  "creates fabricated data — runs only against the hermetic seeded server",
);

const START = /Start an onboarding walkthrough/i;

test("the login screen offers a new patient's onboarding, and it starts at consent", async ({ page }) => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  const start = page.getByRole("button", { name: START });
  await expect(start, "the login screen offers no way to onboard a new patient").toHaveCount(1);
  await start.scrollIntoViewIfNeeded();

  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 }),
    start.click(),
  ]);

  // Step 2 of 4, informed consent — the gate's own first destination.
  await expect(page).toHaveURL(/\/app\/onboarding$/);
  const main = page.locator("main");
  // Rendered, not merely navigated to. This is the blank-page assertion.
  await expect(main, "the onboarding screen rendered nothing").toContainText(/Before you begin/i);
  await expect(main).toContainText(/Step 2 of 4/);
  await expect(main).toContainText(/Informed consent/i);
  // Nothing is pre-agreed: the consent button is still there to press.
  await expect(page.getByRole("button", { name: /I understand and continue/i })).toBeVisible();

  // The person is fabricated and the environment says so, in the banner rather
  // than only in the database.
  await expect(page.locator("body")).toContainText(/Fabricated persona:/);
  await expect(page.locator("body")).toContainText(/\(fabricated\)/);
});

test("consent leads to the program-fit questions, and those lead to a baseline measure", async ({ page }) => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  const start = page.getByRole("button", { name: START });
  await start.scrollIntoViewIfNeeded();
  await Promise.all([
    page.waitForURL(/\/app\/onboarding$/, { timeout: 20_000 }),
    start.click(),
  ]);

  await Promise.all([
    page.waitForURL(/\/app\/screening/, { timeout: 20_000 }),
    page.getByRole("button", { name: /I understand and continue/i }).click(),
  ]);

  // Step 3 of 4: eight yes-or-no questions, and the first one is the one that
  // matters most. Asserted by text because the wording IS the deliverable here
  // — a clinician evaluating this is evaluating how it asks.
  const main = page.locator("main");
  await expect(main).toContainText(/Step 3 of 4/);
  await expect(main).toContainText(/Question 1 of 8/);
  await expect(main).toContainText(/suicidal thoughts or urges to harm yourself/i);
  await expect(page.getByRole("button", { name: /^Yes$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^No$/ })).toBeVisible();

  // Answer through the screener. Bounded rather than `while`, so a screener
  // that stopped advancing fails here instead of hanging the suite.
  for (let i = 0; i < 10; i += 1) {
    const no = page.getByRole("button", { name: /^No$/ });
    if ((await no.count()) === 0) break;
    await no.first().click();
    await page.waitForTimeout(400);
  }
  await page.waitForLoadState("networkidle");

  // Past the fit questions, a baseline instrument is what comes next.
  await expect(page).toHaveURL(/\/app\/screening/);
  await expect(main, "the fit questions did not lead to a baseline measure")
    .toContainText(/PC-PTSD-5|PHQ-9|GAD-7/);
});

test("the clinician sees the person the walkthrough created", async ({ page }) => {
  // THE OTHER HALF OF WHAT THIS FEATURE IS FOR. An onboarding a clinician
  // cannot see the far side of demonstrates the questionnaire and nothing about
  // the product. The walkthrough person is created in NE Care Network A, which
  // is Dr. Maya Chen's tenant, and the caseload is tenant-scoped.
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  const start = page.getByRole("button", { name: START });
  await start.scrollIntoViewIfNeeded();
  await Promise.all([
    page.waitForURL(/\/app\/onboarding$/, { timeout: 20_000 }),
    start.click(),
  ]);

  const banner = (await page.locator("body").innerText()).match(
    /Fabricated persona:\s*(.+?)\s*\(member\)/,
  );
  expect(banner, "the shell never named the walkthrough person").not.toBeNull();
  const name = banner![1].trim();
  expect(name, "the walkthrough person carries no fabricated marker").toMatch(/\(fabricated\)$/);

  // A separate context would be cleaner, but signing in over the top is what a
  // presenter does — and it also proves the walkthrough session yields cleanly
  // to a real account rather than leaving a half-state behind.
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.locator('input[name="email"]').fill("clinician.demo@steady.local");
  await page.locator('input[name="password"]').fill("clinician1234");
  await Promise.all([
    page.waitForURL(/\/clinician\//, { timeout: 20_000 }),
    page.locator('form:has(input[name="password"]) button[type="submit"]').click(),
  ]);

  await page.goto("/clinician/caseload");
  await page.waitForLoadState("networkidle");
  await expect(
    page.locator("main"),
    `the caseload does not show ${name} — the walkthrough is invisible to the clinician`,
  ).toContainText(name);
});

test("the demo admin console counts walkthrough people against the cap", async ({ page }) => {
  // So a presenter can see the environment filling up before the button
  // refuses, and knows a reset is what clears them.
  //
  // A WALKTHROUGH IS CREATED FIRST, deliberately. The count renders only when
  // there is something to count — a line reading "0 of 25" on every visit is
  // noise on a console whose whole job is to lead with what needs attention —
  // so asserting it on an untouched environment would be asserting the empty
  // case. This also makes the assertion mean something: the number moved
  // because a person was created, not because a constant is on the page.
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  const start = page.getByRole("button", { name: START });
  await start.scrollIntoViewIfNeeded();
  await Promise.all([
    page.waitForURL(/\/app\/onboarding$/, { timeout: 20_000 }),
    start.click(),
  ]);

  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.locator('input[name="email"]').fill("admin.demo@steady.local");
  await page.locator('input[name="password"]').fill("demoadmin1234");
  await Promise.all([
    page.waitForURL(/\/admin\/demo/, { timeout: 20_000 }),
    page.locator('form:has(input[name="password"]) button[type="submit"]').click(),
  ]);
  const main = page.locator("main");
  await expect(main).toContainText(/Onboarding walkthroughs/i);
  // At least the one just created, and the cap named beside it.
  await expect(main).toContainText(/Onboarding walkthroughs: [1-9]\d* of 25/);
  await expect(main).toContainText(/A reset clears them/i);
});
