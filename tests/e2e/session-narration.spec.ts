import { test, expect } from "@playwright/test";

// Regression for the "conversational system wasn't working" report: a session
// must actually TALK the member through it (guided narration), not just show a
// static text card. Hermetic seeded server only (needs the demo member).
test.skip(Boolean(process.env.E2E_BASE_URL), "runs only against the hermetic seeded server");

test("calm-place session speaks the member through it (guided narration)", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("demo@example.com");
  await page.locator('input[name="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).not.toHaveURL(/\/login/);

  await page.goto("/app/session/calm-place");
  // If the member is cleared, we stay on the session; otherwise the test is moot.
  await expect(page).toHaveURL(/\/app\/session\/calm-place/);

  // Start the session (intro → running).
  await page.getByRole("button", { name: /^Begin/ }).click();

  // The guided narration renders. Reveal it all instantly, then assert a beat.
  await page.getByRole("button", { name: /show all at once/i }).click();
  await expect(
    page.getByText(/set up your calm place together/i).first()
  ).toBeVisible();
});
