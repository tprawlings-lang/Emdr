import { test, expect } from "@playwright/test";

// Enrolling in the pilot, from the public signup page.
//
// tests/enrollment-gate.test.ts owns the gate's rules — closed when
// unconfigured, constant-time comparison, the cap, both doors asking. This
// owns what a person actually meets: whether the page says what it is about to
// ask for, whether the code stops them, and whether an account that gets
// through lands in the onboarding rather than a dead end.
//
// A REAL PERSON'S ROW IS CREATED BY THIS SPEC, which is why it never runs
// against a deployment. The account is `provenance = 'real'` by design, so it
// is not fabricated data and a reset will now refuse over it — see the reset
// guard in demo-reset-actions.ts.

test.skip(
  Boolean(process.env.E2E_BASE_URL),
  "creates real-provenance accounts — runs only against the hermetic seeded server",
);

// Matches playwright.config.ts's webServer env.
const CODE = "e2e-placeholder-enrollment-code";

/** A fresh address per run, so a re-run is not refused as a duplicate. */
function freshEmail(tag: string): string {
  return `pilot-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

async function fillEnrollment(
  page: import("@playwright/test").Page,
  opts: { code?: string; email?: string; dob?: string; ackWellness?: boolean; ackData?: boolean } = {},
) {
  await page.locator('input[name="access_code"]').fill(opts.code ?? CODE);
  await page.locator('input[name="name"]').fill("Pilot Tester");
  await page.locator('input[name="email"]').fill(opts.email ?? freshEmail("ok"));
  await page.locator('input[name="password"]').fill("pilot-password-1234");
  await page.locator('input[name="dob"]').fill(opts.dob ?? "1990-04-12");
  if (opts.ackWellness !== false) await page.locator('input[name="wellness_ack"]').check();
  if (opts.ackData !== false) await page.locator('input[name="data_ack"]').check();
}

test("the page says what it is about to ask for, before it asks for a name", async ({ page }) => {
  // THE PART THAT MATTERS MOST HERE. Two screens after this form a real person
  // is asked whether they have had suicidal thoughts in the past thirty days.
  // Collecting that without saying so first is the actual failure this feature
  // could contain, and it is a property of the page rather than of the gate.
  await page.goto("/signup");
  await page.waitForLoadState("networkidle");

  const main = page.locator("main");
  await expect(main).toContainText(/Before you enter anything/i);
  await expect(main).toContainText(/suicidal thoughts/i);
  await expect(main).toContainText(/not monitored in real time|no one is watching in real time/i);
  await expect(main).toContainText(/988/);
  await expect(main).toContainText(/read by the people building this|read by the team/i);

  // Above the first field, not under the button.
  const notice = main.getByText(/Before you enter anything/i).first();
  const nameField = page.locator('input[name="name"]');
  const noticeBox = await notice.boundingBox();
  const nameBox = await nameField.boundingBox();
  expect(noticeBox, "the notice is not on the page").not.toBeNull();
  expect(nameBox, "the name field is not on the page").not.toBeNull();
  expect(noticeBox!.y, "the notice renders below the name field").toBeLessThan(nameBox!.y);

  // Nothing is pre-agreed.
  await expect(page.locator('input[name="wellness_ack"]')).not.toBeChecked();
  await expect(page.locator('input[name="data_ack"]')).not.toBeChecked();
});

test("a wrong access code is refused, and no account is created", async ({ page }) => {
  const email = freshEmail("wrongcode");
  await page.goto("/signup");
  await page.waitForLoadState("networkidle");
  await fillEnrollment(page, { code: "not-the-code", email });
  await Promise.all([
    page.waitForURL(/refused=/, { timeout: 20_000 }),
    page.getByRole("button", { name: /Create my account/i }).click(),
  ]);
  await expect(page.locator("main")).toContainText(/access code is not valid/i);

  // And the address really is free afterwards — a refusal that had written the
  // row would answer "already exists" on the retry.
  await fillEnrollment(page, { email });
  await Promise.all([
    page.waitForURL(/\/app\/onboarding$/, { timeout: 20_000 }),
    page.getByRole("button", { name: /Create my account/i }).click(),
  ]);
});

test("an unticked acknowledgement is refused", async ({ page }) => {
  for (const missing of ["wellness", "data"] as const) {
    await page.goto("/signup");
    await page.waitForLoadState("networkidle");
    await fillEnrollment(page, {
      email: freshEmail(`ack-${missing}`),
      ackWellness: missing !== "wellness",
      ackData: missing !== "data",
    });
    await Promise.all([
      page.waitForURL(/refused=/, { timeout: 20_000 }),
      page.getByRole("button", { name: /Create my account/i }).click(),
    ]);
    await expect(page.locator("main"), `a missing ${missing} acknowledgement was accepted`)
      .toContainText(/acknowledge/i);
  }
});

test("a minor is refused at account creation", async ({ page }) => {
  // Compliance 4A.7: age is decided once, here, and never re-litigated
  // downstream. The fitness screener re-checks FIT, not age.
  const year = new Date().getUTCFullYear() - 15;
  await page.goto("/signup");
  await page.waitForLoadState("networkidle");
  await fillEnrollment(page, { email: freshEmail("minor"), dob: `${year}-06-01` });
  await Promise.all([
    page.waitForURL(/refused=/, { timeout: 20_000 }),
    page.getByRole("button", { name: /Create my account/i }).click(),
  ]);
  await expect(page.locator("main")).toContainText(/18 and older/i);
});

test("a correct code enrolls, and lands in the onboarding rather than a dead end", async ({ page }) => {
  await page.goto("/signup");
  await page.waitForLoadState("networkidle");
  await fillEnrollment(page, { email: freshEmail("enrolled") });
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/signup"), { timeout: 20_000 }),
    page.getByRole("button", { name: /Create my account/i }).click(),
  ]);

  // NOT /subscribe, which says enrollment and billing are closed and is a dead
  // end, and not a blank page. Step 2 of 4, rendered.
  await expect(page).toHaveURL(/\/app\/onboarding$/);
  const main = page.locator("main");
  await expect(main, "the onboarding screen rendered nothing").toContainText(/Before you begin/i);
  await expect(main).toContainText(/Step 2 of 4/);

  // And it goes on to the real safety questions, which is what a pilot is for.
  await Promise.all([
    page.waitForURL(/\/app\/screening/, { timeout: 20_000 }),
    page.getByRole("button", { name: /I understand and continue/i }).click(),
  ]);
  await expect(main).toContainText(/Question 1 of 8/);
  await expect(main).toContainText(/suicidal thoughts or urges to harm yourself/i);
});

test("an enrolled person is not marked as fabricated on screen", async ({ page }) => {
  // The banner names a fabricated persona for seeded accounts and for the
  // onboarding walkthrough. A real enrollee is not one, and a screen that
  // called them fabricated would be telling a person their own answers were
  // invented data.
  await page.goto("/signup");
  await page.waitForLoadState("networkidle");
  await fillEnrollment(page, { email: freshEmail("prov") });
  await Promise.all([
    page.waitForURL(/\/app\/onboarding$/, { timeout: 20_000 }),
    page.getByRole("button", { name: /Create my account/i }).click(),
  ]);
  const body = await page.locator("body").innerText();
  expect(body, "an enrolled person is labelled a fabricated persona")
    .not.toMatch(/Fabricated persona:\s*Pilot Tester/);
});

test("the reset console refuses to delete enrolled people without a deliberate tick", async ({ page }) => {
  // resetDemoData runs DELETE FROM over users, persons, consents, checkins and
  // screenings unconditionally, and reports success. For a pilot that is every
  // answer anybody gave.
  await page.goto("/signup");
  await page.waitForLoadState("networkidle");
  await fillEnrollment(page, { email: freshEmail("reset") });
  await Promise.all([
    page.waitForURL(/\/app\/onboarding$/, { timeout: 20_000 }),
    page.getByRole("button", { name: /Create my account/i }).click(),
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
  await expect(main).toContainText(/would be deleted/i);
  await expect(main).toContainText(/no undo/i);
  // The deliberate tick exists and is not pre-ticked.
  const discard = page.locator('input[name="discardEnrolled"]');
  await expect(discard).toHaveCount(1);
  await expect(discard).not.toBeChecked();
  // And the count is stated, not implied.
  await expect(main).toContainText(/Enrollment: \d+ of 25 places used/);
});
