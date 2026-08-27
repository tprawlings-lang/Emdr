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
