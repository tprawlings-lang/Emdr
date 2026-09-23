import type { Page } from "@playwright/test";

/**
 * Bring a deployment to the pilot tier, through the product's own screens.
 *
 * NOT A TEST BYPASS, AND THE DIFFERENCE IS THE POINT. An enrollment code no
 * longer admits a real participant: the environment policy requires all five
 * gates the pilot depends on to pass. There is no flag that skips that,
 * deliberately — a policy with a test-only door is a policy with a door. So
 * this drives the consoles exactly as a reviewer would, and if any of those
 * screens break, the enrollment specs fail. That is correct: enrolling a real
 * person in a deployment whose gates nobody cleared is what the policy exists
 * to stop.
 *
 * WHAT IT COSTS IS THE HONEST PRICE OF THE POLICY, and worth naming: admitting
 * a real participant now requires a COMPLETED CLINICAL COPY REVIEW and a RUN
 * PARITY CHECK, not just two signatures. Eleven surfaces are approved here one
 * at a time because that is how a reviewer approves them.
 *
 * ONCE PER FILE, NOT PER TEST. These are durable records — a signature, a copy
 * decision, a recorded parity result — so re-doing them before every test
 * would cost minutes and prove nothing.
 *
 * THE POLICY'S OWN REFUSAL IS PROVEN IN THE NODE SUITE, not here.
 * tests/enrollment-gate.test.ts asserts that a configured deployment with
 * gates outstanding is closed. Asserting it in a browser would depend on which
 * spec ran first — these share one server, and every record here is durable —
 * and a test whose result depends on file ordering is worse than no test.
 */
export async function openPilotTier(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("reviewer.demo@steady.local");
  await page.locator('input[name="password"]').fill("reviewer1234");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForLoadState("networkidle");

  // 1. The two attestations. A machine cannot check either, so a named
  //    reviewer asserts them with a pointer to the evidence.
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

  // 2. The clinical copy review. The gate passes when every reviewable surface
  //    is approved at the current copy version — so the words a patient reads
  //    have been read by a clinician before a patient is admitted.
  await page.goto("/review/clinical");
  await page.waitForLoadState("networkidle");
  const surfaceIds = await page
    .locator('input[name="surface_id"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  for (const id of surfaceIds) {
    await page.goto("/review/clinical");
    await page.waitForLoadState("networkidle");
    const form = page.locator(`form:has(input[name="surface_id"][value="${id}"])`).first();
    if (!(await form.count())) continue;
    await form.locator('select[name="decision"]').selectOption("approved");
    const confirm = form.locator('input[type="checkbox"]');
    if (await confirm.count()) await confirm.first().check();
    await form.getByRole("button", { name: /record/i }).first().click();
    await page.waitForLoadState("networkidle");
  }

  // 3. The parity run. A ledger rebuild is too expensive for a page load, so
  //    it happens when asked for — and the release console records the result,
  //    keyed to the deployed commit, for the signup page that cannot afford to
  //    ask.
  await page.goto("/review/release?parity=1");
  await page.waitForLoadState("networkidle");

  // Signed out again, so what follows meets the public signup page as a
  // stranger would rather than as a signed-in reviewer.
  await page.context().clearCookies();
}
