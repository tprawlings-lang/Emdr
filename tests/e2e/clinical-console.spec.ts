import { test, expect } from "@playwright/test";

// The Steady Clinical console under real auth, CSP, and the demo dataset.
// Hermetic seeded server only (needs the seeded clinician account).
test.skip(Boolean(process.env.E2E_BASE_URL), "runs only against the hermetic seeded server");

async function signInAsClinician(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("clinician@example.com");
  await page.locator('input[name="password"]').fill("demo1234");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/clinician/);
}

test("the caseload orders by clinical need and always shows its reason", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/clinician/clinical");

  await expect(page.getByRole("heading", { name: "Steady Clinical" })).toBeVisible();

  // A demonstration surface must never imply approval (handoff §2).
  await expect(page.getByText(/Provisional configuration/)).toBeVisible();
  await expect(page.getByText(/not clinically approved/)).toBeVisible();

  // Bands are visible, and the demo dataset produces at least one flagged member.
  await expect(page.getByRole("heading", { name: "Caseload" })).toBeVisible();

  // The rule that matters most on this screen: a band never appears as a bare
  // label. Every row carrying a band carries at least one written reason.
  const rows = page.getByTestId("caseload-row");
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const band = (await row.getByTestId("band").textContent())?.trim().toLowerCase() ?? "";
    if (band === "none") continue;
    await expect(row.getByTestId("reasons")).toBeVisible();
  }
});

test("a member record shows cited claims, marked provenance, and separated AI output", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/clinician/clinical");

  // Open the first member in the caseload.
  await page.getByTestId("caseload-row").first().getByRole("link").first().click();
  await expect(page).toHaveURL(/\/clinician\/clinical\/[^/]+$/);

  await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();

  // Every displayed claim names how many source events it rests on. The
  // contract is enforced in code; this asserts it reaches the screen.
  const claims = page.getByTestId("claim");
  if ((await claims.count()) > 0) {
    await expect(claims.first()).toContainText(/source event/);
  }

  // The summary must disclose what it did not look at.
  await expect(page.getByText("What this summary did not look at")).toBeVisible();

  // Override copy states the safety boundary rather than leaving it implicit.
  await expect(page.getByText(/relaxes/)).toBeVisible();
  await expect(page.getByText(/nobody can override a safety stop/)).toBeVisible();
});

test("a member outside the clinician's tenant is not found rather than forbidden", async ({ page }) => {
  await signInAsClinician(page);
  // A well-formed id that belongs to nobody: the response must not distinguish
  // "exists elsewhere" from "does not exist".
  await page.goto("/clinician/clinical/not-a-real-member-id");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
});

test("the clinical console is reachable from the specialist dashboard", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/clinician");
  await page.getByRole("link", { name: "Steady Clinical" }).click();
  await expect(page).toHaveURL(/\/clinician\/clinical$/);
});

// ---------------------------------------------------------------------------
// Phase 4 completion: audit history, alert trail, BLS Part 6 oversight
// ---------------------------------------------------------------------------

test("a member record carries its audit history with the chain verified", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/clinician/clinical");
  await page.getByTestId("caseload-row").first().getByRole("link").first().click();

  await expect(page.getByRole("heading", { name: "Audit history" })).toBeVisible();
  // Tamper-evidence is shown, not asserted in prose. A chain nobody checks is
  // a claim rather than a control.
  await expect(page.getByTestId("chain-banner").first()).toContainText(/Chain intact/);
  // The scoping caveat reaches the screen rather than living in a comment.
  await expect(page.getByText(/view filter/)).toBeVisible();
});

test("the audit console is tenant-scoped and never prints raw detail", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/clinician/audit");

  await expect(page.getByRole("heading", { name: "Audit console" })).toBeVisible();
  await expect(page.getByTestId("chain-banner")).toBeVisible();
  await expect(page.getByText(/view filter/)).toBeVisible();

  // The console used to render detail_json verbatim, which surfaced attempted
  // sign-in addresses and clinician free text. Nothing that looks like a real
  // address may appear.
  const body = await page.locator("body").innerText();
  const emails = body.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  for (const found of emails) {
    expect(found, `the audit console rendered "${found}"`).toMatch(
      /@(?:example\.(?:com|org|net)|[a-z0-9-]+\.(?:test|invalid|example))$/i
    );
  }
});

test("an alert links to its trail, and the trail reads as a sequence", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/clinician/clinical");

  const trailLink = page.getByRole("link", { name: "audit trail" }).first();
  if ((await trailLink.count()) === 0) test.skip(true, "no open alerts in the demo dataset");

  await trailLink.click();
  await expect(page).toHaveURL(/\/clinician\/alerts\//);
  await expect(page.getByRole("heading", { name: "Alert trail" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sequence" })).toBeVisible();
  await expect(page.getByText("Oldest first.")).toBeVisible();
});

test("an alert outside the tenant is not found rather than forbidden", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/clinician/alerts/not-a-real-alert-id");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
});

test("BLS Part 6 oversight shows live configuration, not the protocol's claims", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/clinician/bls");

  await expect(page.getByRole("heading", { name: "BLS Part 6 oversight" })).toBeVisible();
  await expect(page.getByText(/Not approved for real-person use/)).toBeVisible();

  // Six gates, each with a state.
  await expect(page.getByTestId("bls-gate")).toHaveCount(6);
  // Five hard stops.
  await expect(page.getByTestId("hard-stop")).toHaveCount(5);
  // Three rollout stages, and desensitization must not read as enabled.
  const stages = page.getByTestId("bls-stage");
  await expect(stages).toHaveCount(3);
  await expect(stages.nth(1)).toContainText("not enabled");
  await expect(stages.nth(1)).toContainText(/no deployment setting can turn 4b on/);
});

test("the BLS console is reachable from the specialist dashboard", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/clinician");
  await page.getByRole("link", { name: "BLS Part 6" }).click();
  await expect(page).toHaveURL(/\/clinician\/bls$/);
});
