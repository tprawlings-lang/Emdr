import { test, expect } from "@playwright/test";

// ONE MEMBER, ONE SHELL, ON EVERY SCREEN THEY CAN REACH.
//
// THE DEFECT THIS EXISTS FOR was found by a person signing in and clicking.
// Today carried a horizontal row — Today, Tools, Progress, Care team — and
// following any link from it replaced that with a vertical rail reading
// Overview, Progress, Actions, Evidence. Not the same destinations rearranged:
// DIFFERENT WORDS. Somebody who pressed "Care team" arrived somewhere with no
// "Care team" in its navigation and no visible way back to Today.
//
// AND THE LAYOUT WAS THE SMALLER HALF OF IT. The frame those other screens used
// does not render the support dock, so "Ground now" and "Talk to someone" were
// on Today and on nothing else. Measured before the fix: of ten member routes,
// one had the dock and nine did not. In a product for people who may be
// activated at the moment they are using it, a crisis route that disappears
// when you navigate is not a styling inconsistency.
//
// SO THIS WALKS THE JOURNEY rather than reading a manifest. The release
// definition already had a line asserting the member shell's four destinations,
// and it passed throughout — because it asked `navigationFor` what a member's
// destinations ARE, which was right, rather than asking the screens what they
// DREW, which was not. A computed check over the manifest cannot see this.

test.skip(Boolean(process.env.E2E_BASE_URL), "runs only against the hermetic seeded server");

// Every member destination, plus the screens reachable from them. Not the whole
// route table: the activity and session players are deliberately full-bleed
// (they carry their own shell and their own support), and a person inside a
// processing set should not have navigation competing with it.
const MEMBER_ROUTES = [
  "/app/today",
  "/app/progress",
  "/app/care-team",
  "/app/activities",
  "/app/plan",
  "/app/modules",
  "/app/measures",
  "/app/learn",
  "/app/check-in",
  "/app/companion",
  "/app/paths",
  "/app/settings",
];

async function signInAsMember(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("patient.demo@steady.local");
  await page.locator('input[name="password"]').fill("patient1234");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app\//);
}

test("every member screen carries the same destinations, in the same words", async ({ page }) => {
  await signInAsMember(page);

  const seen: Array<{ route: string; destinations: string }> = [];
  for (const route of MEMBER_ROUTES) {
    await page.goto(route);
    await page.locator("main").waitFor({ state: "visible" });
    const destinations = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Member navigation"]');
      if (!nav) return "NO MEMBER NAVIGATION ON THIS SCREEN";
      return [...nav.querySelectorAll("a")].map((a) => (a.textContent || "").trim()).join(" | ");
    });
    seen.push({ route, destinations });
  }

  // Compared against each other rather than against a list written here: the
  // destinations are the product's decision and may change. What may not change
  // is that they change everywhere at once.
  const distinct = [...new Set(seen.map((s) => s.destinations))];
  expect(
    distinct,
    "member screens disagree about what the navigation is:\n" +
    seen.map((s) => `  ${s.route}  ->  ${s.destinations}`).join("\n")
  ).toHaveLength(1);
  expect(distinct[0], "no member screen renders the member's navigation at all").not.toContain("NO MEMBER");
});

test("support is on every member screen, not only the one they land on", async ({ page }) => {
  await signInAsMember(page);

  const without: string[] = [];
  for (const route of MEMBER_ROUTES) {
    await page.goto(route);
    await page.locator("main").waitFor({ state: "visible" });
    const hasDock = await page.evaluate(() => !!document.querySelector("[data-support-dock]"));
    if (!hasDock) without.push(route);
  }

  expect(
    without,
    "these member screens have no persistent support path — somebody who needs " +
    "grounding or a person to talk to has to navigate away to find one"
  ).toEqual([]);
});

test("the screen a member is on is the one marked in the navigation", async ({ page }) => {
  // WAYFINDING'S FIRST QUESTION. A row of four identical-looking destinations
  // that never says which one you are on answers "where can I go" and not
  // "where am I".
  await signInAsMember(page);

  for (const [route, expected] of [
    ["/app/today", "Today"],
    ["/app/progress", "Progress"],
    ["/app/care-team", "Care team"],
    ["/app/activities", "Tools"],
  ] as const) {
    await page.goto(route);
    await page.locator("main").waitFor({ state: "visible" });
    const selected = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Member navigation"]');
      return [...(nav?.querySelectorAll('[aria-current="page"]') ?? [])]
        .map((a) => (a.textContent || "").trim());
    });
    // Exactly one: two selected states is the same failure as none.
    expect(selected, `${route} does not mark exactly one destination`).toEqual([expected]);
  }
});
