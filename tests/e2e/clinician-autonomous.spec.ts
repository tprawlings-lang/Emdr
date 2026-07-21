import { test, expect } from "@playwright/test";

// The clinician "Autonomous Review" console renders under real auth + CSP and
// shows the deterministic decision + output-guard result. Hermetic seeded
// server only (needs the seeded clinician account).
test.skip(Boolean(process.env.E2E_BASE_URL), "runs only against the hermetic seeded server");

test("clinician can open the autonomous review console and see gated decisions", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("clinician@example.com");
  await page.locator('input[name="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/clinician/);

  // A harm-urge scenario must show the crisis ceiling; a banned message blocked.
  await page.goto("/clinician/autonomous?harmUrge=on&companionText=" + encodeURIComponent("I care about you"));
  await expect(page.getByRole("heading", { name: /autonomous review console/i })).toBeVisible();
  await expect(page.getByText(/access ceiling: crisis/i)).toBeVisible();
  await expect(page.getByText(/DAILY_HARM_URGE/).first()).toBeVisible();
  await expect(page.getByText(/Blocked —/)).toBeVisible();

  // A clear scenario passes to a session.
  await page.goto("/clinician/autonomous?track=steady");
  await expect(page.getByText(/access ceiling: steady/i)).toBeVisible();
  await expect(page.getByText(/✓ allowed/)).toBeVisible();

  // Sign-off register: record Agree for a rule and confirm it persists.
  await expect(page.getByRole("heading", { name: /rule sign-off register/i })).toBeVisible();
  const ruleForm = page.locator('form:has(input[name="rule_id"][value="FIT_UNDER_18"])');
  await ruleForm.locator('input[name="note"]').fill("Threshold correct per DSM age gate.");
  await ruleForm.getByRole("button", { name: "Agree" }).click();
  // After the server action + reload, the register shows one agreed verdict.
  await expect(page.getByText(/1 agreed/)).toBeVisible();
  await expect(ruleForm.locator('input[name="note"]')).toHaveValue(/DSM age gate/);
});
