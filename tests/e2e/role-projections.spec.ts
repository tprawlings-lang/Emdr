import { test, expect } from "@playwright/test";

// Six roles, one ledger, in a browser (handoff 07 §4.1 p40, §4.2 p41, §6.1 p52).
//
// The unit guards prove the projections agree and that the aggregate one
// refuses a person identifier. What only a browser can prove is the part a
// reviewer will actually check: that signing in as a clinician shows names and
// signing in as an analyst shows none, from the same underlying facts.

test.skip(
  Boolean(process.env.E2E_BASE_URL),
  "authenticated flow runs only against the hermetic seeded server",
);

type Page = import("@playwright/test").Page;

const ACCOUNTS = {
  clinician:    { email: "clinician.demo@steady.local", password: "clinician1234" },
  // The NETWORK operator, not `org.demo`. There are two organization
  // populations and they are separate by design: Northside's 4,820 have no
  // names so an aggregate drilldown is impossible, and handoff 07's 240 are
  // enrolled with the eight demo care networks. `org.demo` reports on the
  // first and correctly renders EMPTY on the population screen — which is the
  // right behaviour and the wrong account to assert against.
  organization: { email: "network.demo@steady.local", password: "org1234" },
  northside:    { email: "org.demo@steady.local",     password: "org1234" },
  payer:        { email: "payer.demo@steady.local",     password: "payer1234" },
} as const;

async function signIn(page: Page, who: keyof typeof ACCOUNTS) {
  const a = ACCOUNTS[who];
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.locator('input[name="email"]').fill(a.email);
  await page.locator('input[name="password"]').fill(a.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login")),
    page.locator('form button[type="submit"]').click(),
  ]);
}

test("the clinician's panel shows real people, by name", async ({ page }) => {
  await signIn(page, "clinician");
  await page.goto("/clinician/population");
  const main = page.locator("main");

  // Names, because a clinician reading their own panel has the care
  // relationship that makes one appropriate.
  await expect(main).toContainText(/\(fabricated\)/);
  // The two narrative personas moved into this tenant with the clinician.
  await expect(main).toContainText("Alex Rivera");
  await expect(main).toContainText("Sam Okafor");

  // Every row carries a baseline AND a latest, or says it has neither. A
  // single reading is a baseline, not a trajectory.
  await expect(main).toContainText(/Baseline . latest/);

  // Groups are fixed states with a count, and the screen says they overlap —
  // so it reads as work to do rather than as a ranking.
  await expect(main).toContainText(/Under an active safety gate/);
  await expect(main).toContainText(/may appear in more than one group/);
});

test("an empty group says it is empty rather than rendering blank", async ({ page }) => {
  // A blank space reads as a failure to load. §30.8 requires an absence to
  // explain whether it is expected.
  await signIn(page, "clinician");
  await page.goto("/clinician/population");

  // Read the GROUPS, not the page text. The first version matched headings out
  // of innerText and sliced the body between one heading and the next — which
  // meant the LAST group's "body" was the whole rest of the page, and anything
  // counted inside it was counting the page footer.
  const groups = page.getByTestId("panel-group");
  const count = await groups.count();
  expect(count, "no groups rendered on the panel").toBeGreaterThanOrEqual(3);

  let empties = 0;
  let listedGroups = 0;
  for (let i = 0; i < count; i++) {
    const group = groups.nth(i);
    const heading = (await group.getByTestId("group-heading").textContent())?.trim() ?? "";
    const claimed = Number(/\((\d+)\)\s*$/.exec(heading)?.[1] ?? "-1");
    expect(claimed, `the group "${heading}" does not state a count`).toBeGreaterThanOrEqual(0);

    const listed = await group.getByTestId("group-member").count();
    // A count that disagrees with what is listed is worse than a blank group:
    // it reads as authoritative.
    expect(listed, `the group "${heading}" claims ${claimed} and lists ${listed}`).toBe(claimed);

    if (claimed === 0) {
      // A blank space reads as a failure to load, so an empty group has to say
      // in words that it is empty and that this is expected.
      const body = (await group.innerText()).replace(heading, "").trim();
      expect(body, `the empty group "${heading}" renders blank`).toMatch(/[a-z]{4,}\s+[a-z]{2,}/i);
      empties += 1;
    } else {
      listedGroups += 1;
    }
  }
  // The previous version required at least one group to be EMPTY, so that the
  // empty rendering was exercised. That held only because the attention list
  // had nobody on it — a guard resting on an absence, which failed the moment
  // the panel had somebody to show. The empty rendering is covered by the
  // no-population test below; what is guarded here is that every group's count
  // matches what it lists, in both branches.
  expect(listedGroups + empties).toBe(count);
  expect(listedGroups, "no group lists anybody — the panel is not being tested")
    .toBeGreaterThan(0);
});

test("an organization with no demo population says so instead of showing zeros", async ({ page }) => {
  // A console reporting "0 covered, 0 active, 0 improved" has told the reader
  // something false with great confidence. §30.8's empty state exists for
  // exactly this, and it has to say whether the absence is expected.
  await signIn(page, "northside");
  await page.goto("/organization/population");
  const main = page.locator("main");
  await expect(main).toContainText(/No demo-population enrolment/);
  expect(await main.innerText(), "a zeroed figure rendered as a result").not.toMatch(/\b0 of 0\b/);
});

test("the organization sees the same population with no names at all", async ({ page }) => {
  await signIn(page, "organization");
  await page.goto("/organization/population");
  const main = page.locator("main");

  await expect(main).toContainText(/Covered/);
  // Not one fabricated name, and not one person id. The projection refuses
  // rather than hides — a page that rendered with the identifier merely
  // invisible would still have carried it into every cache on the way.
  const text = await main.innerText();
  expect(text, "a person's name reached the organization console").not.toMatch(/\(fabricated\)/);
  expect(text).not.toMatch(/Alex Rivera|Sam Okafor/);
  expect(await main.innerHTML(), "a person id reached the organization console")
    .not.toMatch(/person_?id|personId/i);
});

test("every proportion on the aggregate screen shows its denominator", async ({ page }) => {
  await signIn(page, "organization");
  await page.goto("/organization/population");
  const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  const percentages = [...text.matchAll(/(\d+)%/g)];
  expect(percentages.length, "no percentage on the page, so this asserts nothing").toBeGreaterThan(0);

  // Every percentage carries "n of N" within a short window. The window is 40
  // characters rather than 80: at 80 the surrounding prose supplied a stray
  // "of 1,889" and the check passed against a card whose own denominator had
  // been deleted.
  for (const m of percentages) {
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 40);
    // Both notations. The aggregate charts render "3,470 / 4,820" and the
    // population cards render "40 of 60"; a check that knew only one of them
    // would fail on a correct screen.
    expect(
      /[\d,]+\s*(of|\/)\s*[\d,]+/.test(after),
      `"${m[0]}" is shown without a denominator beside it: "${after.slice(0, 40)}"`,
    ).toBe(true);
  }
});

test("the payer reads the same contract, across the organizations it covers", async ({ page }) => {
  await signIn(page, "payer");
  await page.goto("/payer/population");
  const main = page.locator("main");
  await expect(main).toContainText(/Covered/);
  await expect(main).toContainText(/cannot reach/i);
  // Same boundary as the organization's.
  expect(await main.innerText()).not.toMatch(/\(fabricated\)/);
});

test("the organization and the payer report different populations, and both say so", async ({ page }) => {
  // The honest shape of the difference: an organization sees the people
  // enrolled with it, a payer sees the people it covers. Two different numbers
  // from one ledger, neither wrong.
  await signIn(page, "organization");
  await page.goto("/organization/population");
  const orgCovered = (await page.locator("main").innerText()).match(/Covered\s+([\d,]+)/)?.[1];

  await signIn(page, "payer");
  await page.goto("/payer/population");
  const payerCovered = (await page.locator("main").innerText()).match(/Covered\s+([\d,]+)/)?.[1];

  expect(orgCovered, "the organization console reports no covered population").toBeTruthy();
  expect(payerCovered, "the payer console reports no covered population").toBeTruthy();
  expect(Number(payerCovered!.replace(/,/g, "")))
    .toBeGreaterThan(Number(orgCovered!.replace(/,/g, "")));
});

test("a clinician cannot open the aggregate population screens", async ({ page }) => {
  await signIn(page, "clinician");
  for (const route of ["/organization/population", "/payer/population"]) {
    await page.goto(route);
    expect(new URL(page.url()).pathname, `a clinician reached ${route}`).not.toBe(route);
  }
});

test("an aggregate account cannot open the clinician's panel", async ({ page }) => {
  for (const who of ["organization", "payer"] as const) {
    await signIn(page, who);
    await page.goto("/clinician/population");
    expect(new URL(page.url()).pathname, `${who} reached the clinician panel`)
      .not.toBe("/clinician/population");
  }
});
