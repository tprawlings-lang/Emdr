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
  await page.goto("/review/autonomous?harmUrge=on&companionText=" + encodeURIComponent("I care about you"));
  await expect(page.getByRole("heading", { name: /autonomous review console/i })).toBeVisible();
  await expect(page.getByText(/access ceiling: crisis/i)).toBeVisible();
  await expect(page.getByText(/DAILY_HARM_URGE/).first()).toBeVisible();
  await expect(page.getByText(/Blocked —/)).toBeVisible();

  // A clear scenario reaches the steady ceiling — but activating sessions
  // still show blocked: the signed beta config (beta-clinrev-2026-07) keeps
  // autonomous stimulation OFF, a clinician sign-off condition. The safe
  // behavior IS the expected behavior.
  await page.goto("/review/autonomous?track=steady");
  await expect(page.getByText(/access ceiling: steady/i)).toBeVisible();
  await expect(page.getByText(/✗ blocked/)).toBeVisible();

  // Sign-off register: record Agree for a rule and confirm it persists.
  await expect(page.getByRole("heading", { name: "Rule sign-off register", exact: true })).toBeVisible();
  const ruleForm = page.locator('form:has(input[name="rule_id"][value="FIT_UNDER_18"])');
  await ruleForm.locator('input[name="note"]').fill("Threshold correct per DSM age gate.");
  await ruleForm.getByRole("button", { name: "Agree" }).click();
  // Assert what THIS action did, not what the whole register contains: the rule
  // now carries an agreed verdict and the note persisted. An absolute count
  // ("1 agreed") would couple this spec to every other spec's sign-offs, which
  // is what made it pass on a fresh database and fail on re-runs.
  const ruleRow = page.locator(
    'div[class*="bg-linen/40"]:has(input[name="rule_id"][value="FIT_UNDER_18"])'
  );
  await expect(ruleRow.getByText("agreed", { exact: true })).toBeVisible();
  await expect(ruleForm.locator('input[name="note"]')).toHaveValue(/DSM age gate/);

  // Session-runtime simulator: a +5 jump from a start of 3 must contain.
  await page.goto("/review/autonomous?s_startSuds=3&s_postSuds=8");
  await expect(page.getByRole("heading", { name: /what the session engine decides/i })).toBeVisible();
  await expect(page.getByText("containment", { exact: true })).toBeVisible();
  await expect(page.getByText(/8h|48h/)).toBeVisible(); // cooldown shown

  // Session-rule register: sign off a session threshold as needs-change.
  await expect(page.getByRole("heading", { name: /session-rule sign-off register/i })).toBeVisible();
  const sessForm = page.locator('form:has(input[name="rule_id"][value="SESSION_MAX_SETS"])');
  await sessForm.getByRole("button", { name: "Needs change" }).click();
  await expect(page.getByText(/1 needs change/)).toBeVisible();
  await expect(page.getByText(/1 agreed/)).toBeVisible();

  // Voice-response review: the section renders and its guardrails are sign-offable.
  await page.goto("/review/autonomous");
  await expect(page.getByRole("heading", { name: /voice responses/i })).toBeVisible();
  const voiceForm = page.locator('form:has(input[name="rule_id"][value="VOICE_INPUT_CONFIRM"])');
  await voiceForm.getByRole("button", { name: "Agree" }).click();
  await expect(page.getByText(/agreed/).first()).toBeVisible();

  // CSV export (fetched in-page so it carries the clinician session cookie).
  const out = await page.evaluate(async () => {
    const r = await fetch("/review/autonomous/export");
    return { status: r.status, ct: r.headers.get("content-type") ?? "", text: await r.text() };
  });
  expect(out.status).toBe(200);
  expect(out.ct).toContain("text/csv");
  expect(out.text).toContain("rule_id,category,config_version,verdict,note");
  expect(out.text).toMatch(/FIT_UNDER_18,[^,]*,[^,]*,agree/);
  expect(out.text).toMatch(/SESSION_MAX_SETS,[^,]*,[^,]*,needs_change/);
  expect(out.text).toMatch(/VOICE_INPUT_CONFIRM,[^,]*,[^,]*,agree/);
});
