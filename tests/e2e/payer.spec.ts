import { test, expect } from "@playwright/test";

// Steady Intelligence — the payer role (§26's ten payer screens).
//
// What only a browser can prove: that a partial month does not reach the
// screen as a value, and that an estimate never appears where a reader would
// take it for a measurement.

test.skip(
  Boolean(process.env.E2E_BASE_URL),
  "authenticated flow runs only against the hermetic seeded server",
);

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.locator('input[name="email"]').fill("operations@example.com");
  await page.locator('input[name="password"]').fill("demo1234");
  await Promise.all([
    page.waitForURL(/\/organization|\/payer/, { timeout: 30000 }),
    page.locator('form button[type="submit"]').click(),
  ]);
}

test("every payer screen renders inside the frame", async ({ page }) => {
  await signIn(page);
  const SCREENS: Array<[string, string]> = [
    ["/payer/overview", "Population overview"],
    ["/payer/utilization", "Utilisation"],
    ["/payer/outcomes", "Outcomes"],
    ["/payer/engagement", "Engagement"],
    ["/payer/access", "Access"],
    ["/payer/population-access", "Population access"],
    ["/payer/evidence", "Evidence registry"],
    ["/payer/evidence/cost", "Cost model"],
    ["/payer/contract", "Contract report"],
    ["/payer/cohorts", "Cohorts"],
    ["/payer/data-quality", "Data quality"],
  ];
  for (const [route, heading] of SCREENS) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Information layers" })).toBeVisible();
  }
});

test("months whose claims have not arrived report nothing, not a low rate", async ({ page }) => {
  await signIn(page);
  await page.goto("/payer/utilization");

  // The partial state is declared above the chart, with the source named.
  await expect(page.getByText("Missing sources")).toBeVisible();
  await expect(page.getByText(/have too few claims received to report a rate/)).toBeVisible();

  // The chart itself marks the withheld months rather than drawing them low.
  await expect(page.locator("main").getByText("no data").first()).toBeVisible();

  // And the accessible table agrees — the withheld months are "no data" there
  // too, so the gap is not a purely visual convention.
  const table = page.locator("main table").first();
  await expect(table).toContainText("no data");
});

test("an estimate is never presented as an observed value", async ({ page }) => {
  await signIn(page);

  // The observed screens carry no cost language at all, except to disown it.
  for (const route of ["/payer/overview", "/payer/utilization", "/payer/contract"]) {
    await page.goto(route);
    const text = (await page.locator("main").innerText())
      .split(/(?<=[.!?])\s+|\n/)
      .filter((s) => !/\b(no|not|never|nothing|neither|without)\b/i.test(s))
      .join(" ");
    expect(text, `${route} makes a cost claim`).not.toMatch(/\b(savings|PMPM|ROI)\b/i);
  }

  // The cost model says what it is, on the screen, in the chart and in a card.
  await page.goto("/payer/evidence/cost");
  await expect(page.getByText("modelled estimate, not observed")).toBeVisible();
  await expect(page.getByText(/Not observed savings/)).toBeVisible();
  await expect(page.getByText("Model boundary")).toBeVisible();
  // Assumptions are on the screen, not behind a link.
  await expect(page.getByText(/Assumptions this model rests on/)).toBeVisible();
});

test("the contract report shows a miss as plainly as a hit", async ({ page }) => {
  await signIn(page);
  await page.goto("/payer/contract");

  // The seeded contract deliberately contains a measure that misses, because a
  // report where everything passes demonstrates nothing about one that has to
  // show a failure.
  // Both outcomes are present and neither is softened. Located by ROW rather
  // than by the word: the result cell renders a glyph beside the word, so an
  // exact-text match on "met" finds nothing and a loose one also matches
  // "not met".
  const missed = page.getByRole("row", { name: /Median days referral to care start/ });
  await expect(missed).toContainText("not met");

  const hit = page.getByRole("row", { name: /Members who started care/ });
  await expect(hit).toContainText("met");
  await expect(hit).not.toContainText("not met");
});

test("the payer role cannot reach a person-level surface", async ({ page }) => {
  await signIn(page);
  for (const route of ["/clinician/today", "/clinician/caseload", "/app/today"]) {
    await page.goto(route);
    await expect(page, `${route} was reachable`).toHaveURL(/\/organization\/|\/payer\//);
  }
});
