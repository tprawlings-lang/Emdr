import { test, expect, type Page } from "@playwright/test";

// Integration coverage of the signup gate pipeline through the real Server
// Actions (DOB age gate → account creation → subscription gate). Creates fresh
// users each run, so it never touches seeded data; hermetic server only.
test.skip(
  Boolean(process.env.E2E_BASE_URL),
  "signup gate flows create users and run only on the hermetic seeded server"
);

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

function isoYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function submitSignup(
  page: Page,
  opts: { email: string; dob: string; ack?: boolean }
) {
  await page.goto("/signup");
  await page.locator('input[name="name"]').fill("E2E Tester");
  await page.locator('input[name="email"]').fill(opts.email);
  await page.locator('input[name="password"]').fill("test-password-123");
  await page.locator('input[name="dob"]').fill(opts.dob);
  if (opts.ack !== false) await page.locator('input[name="wellness_ack"]').check();
  await page.getByRole("button", { name: /begin with a free week/i }).click();
}

test("under-18 applicants are rejected at the age gate", async ({ page }) => {
  await submitSignup(page, { email: uniqueEmail(), dob: isoYearsAgo(10) });
  await expect(page).toHaveURL(/\/signup\?error=age/);
  // No session was minted: the dashboard still bounces to login.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("valid 18+ signup lands on the subscribe gate and cannot skip it", async ({ page }) => {
  await submitSignup(page, { email: uniqueEmail(), dob: isoYearsAgo(30) });
  // Account created + session set → routed to the first gate, not the dashboard.
  await expect(page).toHaveURL(/\/subscribe/);
  // Gate enforcement: an unsubscribed member is redirected off /dashboard.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/subscribe/);
});

test("duplicate email is rejected", async ({ page, context }) => {
  const email = uniqueEmail();
  await submitSignup(page, { email, dob: isoYearsAgo(30) });
  await expect(page).toHaveURL(/\/subscribe/);

  // Fresh session (no cookie) so the second attempt is a clean signup that
  // collides on the unique email.
  const clean = await context.browser()!.newContext();
  const page2 = await clean.newPage();
  await submitSignup(page2, { email, dob: isoYearsAgo(30) });
  await expect(page2).toHaveURL(/\/signup\?error=exists/);
  await clean.close();
});
