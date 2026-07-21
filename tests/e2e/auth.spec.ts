import { test, expect } from "@playwright/test";

// Authenticated flow against the seeded demo member (EMDR_DEMO=1 creates
// demo@example.com / demo1234). Exercises the real Server Action login path —
// a plain HTTP POST cannot, since Next.js actions require the framework
// protocol a browser produces. Runs only on the hermetic local server, which
// seeds the demo dataset; skipped when pointed at an external deployment we
// must not mutate.
test.skip(
  Boolean(process.env.E2E_BASE_URL),
  "authenticated flow runs only against the hermetic seeded server"
);

test("member can log in and reach an authenticated session", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("demo@example.com");
  await page.locator('input[name="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Continue" }).click();

  // A successful login leaves /login; a failed one stays with an error.
  await expect(page).not.toHaveURL(/\/login/);

  // The session is real: the dashboard is now reachable and offers sign-out
  // (requireMember would bounce an anonymous visitor back to /login).
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
});

test("invalid credentials are rejected", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("demo@example.com");
  await page.locator('input[name="password"]').fill("wrong-password");
  await page.getByRole("button", { name: "Continue" }).click();
  // Stays on the login surface; no session is minted.
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
