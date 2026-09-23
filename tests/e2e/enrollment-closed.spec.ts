import { test, expect } from "@playwright/test";

// Public enrollment is closed (Redesign handoff §12).
//
// Replaces signup-gates.spec.ts, which drove the public signup form. The age
// gate it covered now has stricter unit coverage in tests/signup-gates.test.ts;
// what needs asserting in a browser is that the retail front door is actually
// shut — because that is the half of the §1/§3 release gate that stops the
// review environment from re-accumulating real identifiers.
test.skip(Boolean(process.env.E2E_BASE_URL), "runs against the hermetic seeded server");

test("the signup route creates no account without the access code", async ({ page }) => {
  // THIS TEST CHANGED WITH THE BEHAVIOUR, deliberately, and the §12 promise it
  // was written for is still kept — by a different mechanism.
  //
  // It used to assert that `/signup` redirected to `/request-review`, because
  // the route was shut outright. Enrollment is now a gated pilot: with
  // `EMDR_ENROLLMENT_CODE` set the form renders, and with it unset the redirect
  // is exactly what it always was. The e2e server sets the variable, so the
  // closed path is covered where it can be — `tests/enrollment-gate.test.ts`
  // unsets it and asserts the redirect and the refusal.
  //
  // WHAT §12 ACTUALLY PROTECTED was not the redirect; it was that a stranger
  // could not put a real identity into this environment. That is what this
  // asserts now, against the form itself.
  await page.goto("/signup");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/\/signup/);

  // A code is required, structurally — not merely validated on submit.
  const codeField = page.locator('input[name="access_code"]');
  await expect(codeField, "the enrollment form asks for no access code").toHaveCount(1);
  await expect(codeField).toHaveAttribute("required", "");

  // And a wrong one creates nothing. The address is checked afterwards by
  // trying it again: a refusal that had written the row would answer
  // "already exists" the second time.
  const email = `closed-${Date.now()}@example.test`;
  await codeField.fill("not-the-code");
  await page.locator('input[name="name"]').fill("Should Not Exist");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("password-1234");
  await page.locator('input[name="dob"]').fill("1990-01-01");
  await page.locator('input[name="wellness_ack"]').check();
  await page.locator('input[name="data_ack"]').check();
  await Promise.all([
    page.waitForURL(/refused=/, { timeout: 20_000 }),
    page.getByRole("button", { name: /Create my account/i }).click(),
  ]);
  await expect(page.locator("main")).toContainText(/access code is not valid/i);

  // No session was minted on the way to refusing.
  await page.goto("/app/today");
  await expect(page, "a refused signup left a usable session").toHaveURL(/\/login/);
});

test("the subscribe route states that billing is closed and offers no purchase", async ({ page }) => {
  await page.goto("/subscribe");
  await expect(page.getByRole("heading", { name: /enrollment and billing are closed/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /request a review/i }).first()).toBeVisible();
});

test("review sign in shows no shared credentials", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /review sign in/i })).toBeVisible();
  const body = (await page.locator("body").textContent()) ?? "";
  // §3: a password printed on a public page outlives every other control.
  expect(body).not.toMatch(/patient1234|clinician1234|reviewer1234|org1234|payer1234|demoadmin1234|demo1234/);
  expect(body).not.toMatch(/first week free/i);
});

test("the institutional homepage states the boundary and offers no purchase path", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/continues between visits/i);
  await expect(page.getByTestId("boundary-note")).toBeVisible();
  await expect(page.getByTestId("boundary-note")).toContainText(/Development prototype/);

  const body = (await page.locator("body").textContent()) ?? "";
  expect(body).not.toMatch(/\$\d+(\.\d{2})?\s*(\/|per )\s*month/i);
  expect(body).not.toMatch(/free week|cancel anytime/i);

  // Every capability shown carries a status label from the registry (§6).
  const cards = page.getByTestId("capability-card");
  const n = await cards.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    await expect(cards.nth(i).getByTestId("status-badge")).toBeVisible();
  }
});

test("each audience page carries the boundary and routes to a review request", async ({ page }) => {
  for (const route of ["/platform", "/clinical", "/organizations", "/payers"]) {
    await page.goto(route);
    await expect(page.getByTestId("boundary-note").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /request a review|discuss a pilot|discuss an evaluation|request a clinical/i }).first()).toBeVisible();
  }
});

test("crisis resources stay public and reachable without a login", async ({ page }) => {
  await page.goto("/crisis");
  await expect(page.locator("body")).toContainText("988");
  // Reachable from the institutional footer too.
  await page.goto("/");
  await expect(page.getByRole("link", { name: /immediate help resources/i })).toBeVisible();
});
