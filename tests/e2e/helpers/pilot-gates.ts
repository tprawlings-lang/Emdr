import type { Page } from "@playwright/test";

/**
 * Sign the gates the pilot tier requires, through the product's own form.
 *
 * NOT A TEST BYPASS, AND THE DIFFERENCE IS THE POINT. An enrollment code no
 * longer admits a real participant on its own: the environment policy requires
 * the safety replay to pass and the authorization and accessibility gates to be
 * signed off. There is no flag that skips that, deliberately — a policy with a
 * test-only door is a policy with a door. So this drives the release console
 * exactly as a reviewer would, and if the sign-off form breaks these specs fail,
 * which is correct: enrolling a real person in a deployment whose gates nobody
 * signed is precisely what the policy exists to stop.
 *
 * THE POLICY'S OWN REFUSAL IS PROVEN IN THE NODE SUITE, not here.
 * tests/enrollment-gate.test.ts asserts that a configured deployment with
 * unsigned gates is closed. Asserting it in a browser would depend on which
 * spec ran first — these share one server, and a sign-off is durable — and a
 * test whose result depends on file ordering is worse than no test.
 */
export async function signOffPilotGates(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("reviewer.demo@steady.local");
  await page.locator('input[name="password"]').fill("reviewer1234");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForLoadState("networkidle");

  for (const gateId of ["authorization", "accessibility"]) {
    await page.goto("/review/release");
    await page.waitForLoadState("networkidle");
    const form = page.locator(`form:has(input[name="gate_id"][value="${gateId}"])`).first();
    await form.locator('select[name="decision"]').selectOption("approved");
    await form.locator('input[name="evidence_ref"]').fill(`docs/approvals/${gateId}-e2e.md`);
    await form.locator('input[type="checkbox"]').check();
    await form.getByRole("button", { name: /record decision/i }).first().click();
    await page.waitForLoadState("networkidle");
  }

  // Signed out again, so what follows meets the public signup page as a
  // stranger would rather than as a signed-in reviewer.
  await page.context().clearCookies();
}
