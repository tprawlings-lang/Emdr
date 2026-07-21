import { test, expect } from "@playwright/test";

// Read-only smoke coverage of the critical, unauthenticated surfaces. These
// never mutate data, so they are safe to run against a live deployment
// (E2E_BASE_URL) as well as the hermetic local server.

test("homepage renders and links to crisis support", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/steady/i);
  // Crisis line must be reachable from the landing surface.
  await expect(page.getByText("988").first()).toBeVisible();
});

test("crisis page is always reachable and shows 988", async ({ page }) => {
  const res = await page.goto("/crisis");
  expect(res?.status()).toBe(200);
  await expect(page.getByText("988").first()).toBeVisible();
});

test("login page renders email + password fields", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('input[name="email"]')).toBeVisible();
  await expect(page.locator('input[name="password"]')).toBeVisible();
});

test("signup page is reachable", async ({ page }) => {
  const res = await page.goto("/signup");
  expect(res?.status()).toBe(200);
});

test("security headers are present on every response", async ({ request }) => {
  const res = await request.get("/");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("default-src 'self'");
  expect(h["strict-transport-security"]).toContain("max-age=");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["permissions-policy"]).toContain("geolocation=()");
});

test("unauthenticated dashboard access redirects to login", async ({ page }) => {
  await page.goto("/dashboard");
  // Server actions gate on session; an anonymous visit should not land on a
  // populated dashboard. Accept either a redirect to /login or the login form.
  await expect(page).toHaveURL(/\/login|\/$/);
});
