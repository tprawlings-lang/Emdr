import { test, expect } from "@playwright/test";

// Steady Intelligence — the organization role (§26's nine screens).
//
// The unit guards prove the projections cannot carry a person and that a
// proportion cannot render without its denominator. What only a browser can
// prove is the boundary as a person experiences it: that an aggregate account
// signing in lands on aggregate screens, cannot reach a clinical one, and is
// never offered a route into a member's record.

test.skip(
  Boolean(process.env.E2E_BASE_URL),
  "authenticated flow runs only against the hermetic seeded server",
);

async function signInAsOperations(page: import("@playwright/test").Page) {
  await page.goto("/login");
  // On a cold server the first click can land while React is still hydrating
  // and the submit is swallowed — no POST is made at all. `networkidle` does
  // not cover it, and neither does asserting the URL afterwards: the assertion
  // retries against a page that was never going to navigate, so it fails once
  // per session and passes on every re-run. The most expensive kind of flake.
  //
  // Waiting on the NAVIGATION is what actually closes it, because the wait and
  // the click are then racing the same event.
  await page.waitForLoadState("networkidle");
  await page.locator('input[name="email"]').fill("org.demo@steady.local");
  await page.locator('input[name="password"]').fill("org1234");
  await Promise.all([
    page.waitForURL(/\/organization/),
    page.locator('form button[type="submit"]').click(),
  ]);
}

test("an aggregate account lands on the operating overview, not a clinical console", async ({ page }) => {
  await signInAsOperations(page);
  await expect(page).toHaveURL(/\/organization\/overview$/);
  await expect(page.getByRole("heading", { name: "Operating overview" })).toBeVisible();
  // Scoped to the shell's banner. A bare getByText matched two elements —
  // the role label AND Next's route announcer, a live region that carries the
  // document title for a moment after a client-side navigation. Strict mode
  // then failed, but only when the assertion happened to run inside that
  // moment, so it read as an unrelated flake.
  await expect(
    page.getByRole("banner").getByText("Steady Intelligence", { exact: true }),
  ).toBeVisible();
});

test("the aggregate role cannot reach a person-level surface", async ({ page }) => {
  await signInAsOperations(page);

  // §30.6: aggregate access does not create person-level care access. Every
  // one of these is a clinical surface, and each must send the account back to
  // its own rather than render.
  for (const route of ["/clinician/today", "/clinician/caseload", "/clinician/patients", "/app/today"]) {
    await page.goto(route);
    await expect(page, `${route} was reachable by an aggregate account`).toHaveURL(/\/organization\//);
  }
});

test("every organization screen renders and states its denominator", async ({ page }) => {
  await signInAsOperations(page);

  const SCREENS: Array<[string, string]> = [
    ["/organization/overview", "Operating overview"],
    ["/organization/access", "Access pipeline"],
    ["/organization/capacity", "Capacity"],
    ["/organization/care-delivery", "Care delivery"],
    ["/organization/outcomes", "Outcomes"],
    ["/organization/safety", "Safety operations"],
    ["/organization/teams", "Teams"],
    ["/organization/locations", "Locations"],
    ["/organization/reports", "Reports"],
  ];

  for (const [route, heading] of SCREENS) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    // The frame is on every one of them.
    await expect(page.getByRole("navigation", { name: "Information layers" })).toBeVisible();
  }
});

test("no percentage appears without its numerator and denominator", async ({ page }) => {
  await signInAsOperations(page);

  // §29.1's first rule, checked against what actually reaches the screen
  // rather than against the source. Every "72%" must be followed by its
  // "(3,470 / 4,820)".
  for (const route of ["/organization/overview", "/organization/access", "/organization/outcomes", "/organization/care-delivery"]) {
    await page.goto(route);
    const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    const bare = [...text.matchAll(/(\d+)%(?!\s*\()/g)].map((m) => m[0]);
    expect(bare, `${route} shows a percentage with no denominator: ${bare.join(", ")}`).toEqual([]);
  }
});

test("an operations screen never offers grounding or crisis links", async ({ page }) => {
  await signInAsOperations(page);

  // Capacity renders in the partial state, which is where the support paths
  // used to appear. There is no person on this screen to offer them to, and
  // the links point at a member surface this role must not enter.
  await page.goto("/organization/capacity");
  await expect(page.getByText("Missing sources")).toBeVisible();
  await expect(page.locator('main a[href="/app/ground"]')).toHaveCount(0);
  await expect(page.locator('main a[href="/crisis"]')).toHaveCount(0);
});

test("missing follow-up stays inside the outcomes denominator", async ({ page }) => {
  await signInAsOperations(page);
  await page.goto("/organization/outcomes");

  // §31.6 blocks a release for "any clean chart hiding incomplete data". The
  // missing slice is in the same bar, on the same total, as the three that
  // look like results.
  await expect(page.getByText("Missing follow-up", { exact: true })).toBeVisible();

  // Scoped to the chart's own figure. The standing header above it carries its
  // own denominators (covered lives, and people who started care), and reading
  // the whole page counted those as a second denominator for the slices.
  const text = (await page.locator("main figure").first().innerText()).replace(/\s+/g, " ");
  const totals = [...text.matchAll(/\/\s*([\d,]+)\)/g)].map((m) => m[1]);
  expect(totals.length, "no denominators found in the outcomes figure").toBeGreaterThan(3);
  expect(new Set(totals).size, "outcome slices are measured against different denominators").toBe(1);
});

test("a screen whose data model does not exist says so instead of rendering an empty table", async ({ page }) => {
  await signInAsOperations(page);
  await page.goto("/organization/teams");
  await expect(page.getByText(/no team record/i)).toBeVisible();
  await expect(page.locator("main table")).toHaveCount(0);

  await page.goto("/organization/reports");
  await expect(page.getByText(/not built/i).first()).toBeVisible();
  // A download button with no governance behind it is worse than no button.
  await expect(page.locator("main a[download]")).toHaveCount(0);
});
