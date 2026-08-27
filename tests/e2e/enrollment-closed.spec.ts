import { test, expect } from "@playwright/test";

// Public enrollment is closed (Redesign handoff §12).
//
// Replaces signup-gates.spec.ts, which drove the public signup form. The age
// gate it covered now has stricter unit coverage in tests/signup-gates.test.ts;
// what needs asserting in a browser is that the retail front door is actually
// shut — because that is the half of the §1/§3 release gate that stops the
// review environment from re-accumulating real identifiers.
test.skip(Boolean(process.env.E2E_BASE_URL), "runs against the hermetic seeded server");

test("the signup route no longer creates accounts", async ({ page }) => {
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/request-review/);
  // No account-creation form survives anywhere on the destination.
  await expect(page.locator('input[name="password"]')).toHaveCount(0);
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
  expect(body).not.toMatch(/demo1234/);
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
