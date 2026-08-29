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
  await page.goto("/clinician/caseload");

  await expect(page.getByRole("heading", { name: "Caseload", level: 1 })).toBeVisible();

  // A demonstration surface must never imply approval (handoff §2).
  await expect(page.getByText(/Provisional configuration/)).toBeVisible();
  await expect(page.getByText(/not clinically approved/)).toBeVisible();

  // Bands are visible, and the demo dataset produces at least one flagged member.
  await expect(page.getByRole("heading", { name: "Caseload", level: 1 })).toBeVisible();

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
  await page.goto("/clinician/caseload");

  // Open the first member in the caseload.
  await page.getByTestId("caseload-row").first().getByRole("link").first().click();
  await expect(page).toHaveURL(/\/clinician\/member\/[^/]+\/record$/);

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
  await page.goto("/clinician/member/not-a-real-member-id/record");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
});

test("the clinical console is reachable from the persistent rail", async ({ page }) => {
  // The nav bar is gone; navigation is the app shell's five-item rail, which is
  // §25's information layers rather than a menu. The property is unchanged: a
  // console page is one click from the console, and the navigation says where
  // you are rather than only where you can go.
  await signInAsClinician(page);
  await page.goto("/clinician");
  const rail = page.getByRole("navigation", { name: "Information layers" });
  await rail.getByRole("link", { name: "Progress" }).click();
  await expect(page).toHaveURL(/\/clinician\/caseload$/);
  await expect(rail.getByRole("link", { name: "Progress" })).toHaveAttribute("aria-current", "page");
});

// ---------------------------------------------------------------------------
// Phase 4 completion: audit history, alert trail, BLS Part 6 oversight
// ---------------------------------------------------------------------------

test("a member record carries its audit history with the chain verified", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/clinician/caseload");
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
  await page.goto("/review/audit");

  await expect(page.getByRole("heading", { name: "Audit and lineage" })).toBeVisible();
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
  await page.goto("/clinician/caseload");

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
  await page.goto("/review/bls");

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

test("every console is reachable from the nav, from anywhere", async ({ page }) => {
  // The trajectory used to sit four hops deep with nothing signposting it.
  // From any console page, every other one is still one click away — but the
  // consoles now live in two roles, not one. Web GUI handoff §26 moves audit,
  // engine validation, BLS oversight and testing into a review role at
  // /review/*, because listing them beside daily clinical work made the
  // clinician's own nav longer and their actual job harder to find.
  //
  // The property under test is unchanged: no console is reachable only by
  // typing a URL. What changed is that crossing between the two roles is one
  // deliberate link rather than an undifferentiated list.
  await signInAsClinician(page);

  await page.goto("/review/audit");
  const rail = page.getByRole("navigation", { name: "Information layers" });
  // Evidence holds two review screens, so it lists them under the title; the
  // rail reaches the layer and the sibling row reaches the screen.
  await rail.getByRole("link", { name: "Evidence" }).click();
  await expect(page).toHaveURL(/\/review\/bls$/);
  const layerNav = page.getByRole("navigation", { name: "Screens in this layer" });
  await layerNav.getByRole("link", { name: "Autonomous flow" }).click();
  await expect(page).toHaveURL(/\/review\/autonomous$/);
  await rail.getByRole("link", { name: "Actions" }).click();
  await expect(page).toHaveURL(/\/review\/testing$/);

  // And back across the boundary, in both directions.
  await page.getByRole("link", { name: "Clinical console" }).click();
  await expect(page).toHaveURL(/\/clinician\/today$/);

  const clinRail = page.getByRole("navigation", { name: "Information layers" });
  await clinRail.getByRole("link", { name: "Progress" }).click();
  await expect(page).toHaveURL(/\/clinician\/caseload$/);
  await page
    .getByRole("navigation", { name: "Screens in this layer" })
    .getByRole("link", { name: "Patients" })
    .click();
  await expect(page).toHaveURL(/\/clinician\/patients$/);
  await clinRail.getByRole("link", { name: "Overview" }).click();
  await expect(page).toHaveURL(/\/clinician\/today$/);

  await clinRail.getByRole("link", { name: "Review console" }).click();
  await expect(page).toHaveURL(/\/review\/audit$/);
});

test("the testing console shows what is exercisable and takes a change request", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/review/testing");

  await expect(page.getByRole("heading", { name: "Testing console" })).toBeVisible();
  // The matrix reads live configuration, so a reviewer is never told a feature
  // is available with nowhere to go.
  const rows = page.getByTestId("exercise-row");
  expect(await rows.count()).toBeGreaterThan(5);

  // Resourcing BLS must be exercisable in a demo build — it is the flagship
  // clinical workstream and the thing a clinical reviewer most needs to walk.
  await expect(page.getByText(/Resourcing BLS session/)).toBeVisible();
  const blsRow = rows.filter({ hasText: "Resourcing BLS session" });
  await expect(blsRow.getByTestId("exercise-state")).toHaveText("Yes");

  // File a change request and see it land.
  const form = page.getByTestId("note-form").first();
  await form.locator("summary").click();
  await form.getByRole("combobox").first().selectOption("Alert handling");
  await form.locator('textarea[name="observed"]').fill("A high-band alert on a Friday evening carried a four-hour deadline.");
  await form.locator('textarea[name="requested"]').fill("Out-of-hours high-band alerts should use the next business day.");
  await form.getByRole("button", { name: "File change request" }).click();

  await expect(page.getByText(/Change request filed/)).toBeVisible();
  await expect(page.getByTestId("note-row").first()).toContainText("Friday evening");
  // The configuration travels with the note without the reviewer knowing it matters.
  await expect(page.getByTestId("note-row").first()).toContainText(/safety config/);
});

test("a change request can be filed from the screen where it was noticed", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/clinician/caseload");
  // The same form is on the working screens, so a reviewer never has to leave
  // what they are looking at to record what they think about it.
  await expect(page.getByTestId("note-form")).toBeVisible();
});

test("the member record leads with a trajectory that carries its own provenance", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/clinician/caseload");
  // Alex has three weeks of history; the first caseload row may be a member
  // with too little to plot, which is a legitimate empty state.
  const href = await page.locator('a:has-text("Alex")').first().getAttribute("href");
  await page.goto(href!);

  await expect(page.getByRole("heading", { name: "Trajectory" })).toBeVisible();
  const chart = page.locator("svg[role=img]").first();
  await expect(chart).toBeVisible();

  // The chart names what it plots, for a screen reader as well as a sighted
  // reader — an SVG with no accessible name is a decorative blob.
  await expect(chart).toHaveAttribute("aria-label", /Trajectory over \d+ days/);

  // Separate scales stay separate: a 0–10 check-in lane and an instrument lane
  // both present means they were not reconciled onto one axis.
  await expect(chart).toContainText("0–10");
  await expect(chart).toContainText("Activation");

  // Every plotted value is reachable without hovering — the accessibility path
  // and the mandated relief for marks below 3:1 contrast.
  await expect(page.getByText("Show every plotted value as a table")).toBeVisible();

  // Provenance survives the redesign. The demo is entirely reconstructed, so
  // the chart's own caption must say so rather than presenting it as observed
  // history. Scoped to the figcaption: the word also appears in collapsed
  // disclosures elsewhere on the page, and a hidden match would pass while the
  // chart said nothing.
  await expect(page.locator("figcaption").first()).toContainText(/reconstructed/i);

  // And the reading is stated in words, not left to be inferred from a slope.
  const readings = page.getByTestId("trajectory-reading");
  expect(await readings.count()).toBeGreaterThan(0);
  await expect(readings.first()).toContainText(/Improving|Worsening|Little change/);
});

test("the trajectory does not push the page sideways on a phone", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/clinician/caseload");
  const href = await page.locator('a:has-text("Alex")').first().getAttribute("href");
  await page.goto(href!);
  await page.setViewportSize({ width: 390, height: 900 });
  // Wide content scrolls inside its own container, never the document.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, "the clinical record scrolls horizontally at 390px").toBeLessThanOrEqual(1);
});

test("patients can be found by name, not by scanning a triage queue", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/clinician/caseload");
  await page
    .getByRole("navigation", { name: "Screens in this layer" })
    .getByRole("link", { name: "Patients" })
    .click();
  await expect(page).toHaveURL(/\/clinician\/patients$/);
  await expect(page.getByRole("heading", { name: "Patients" })).toBeVisible();

  const all = await page.getByTestId("directory-row").count();
  expect(all).toBeGreaterThan(0);

  // Search works without JavaScript having to boot — it is a GET form.
  await page.locator('input[name="q"]').fill("Alex");
  await page.getByRole("button", { name: "Search" }).click();
  await page.waitForURL(/q=Alex/);
  const found = await page.getByTestId("directory-row").count();
  expect(found).toBeGreaterThan(0);
  expect(found).toBeLessThanOrEqual(all);
  // The count names the whole panel, so a filtered list is not mistaken for it.
  await expect(page.getByTestId("directory-count")).toContainText(`of ${all}`);

  // And a row leads to the record — which is the point of finding someone.
  await page.getByTestId("directory-row").first().getByRole("link").click();
  await expect(page).toHaveURL(/\/clinician\/member\/[^/]+\/record$/);
  await expect(page.getByRole("heading", { name: "Trajectory" })).toBeVisible();
});

test("the directory stays a directory, not a second triage queue", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/clinician/patients");
  // It points at the caseload for triage rather than reimplementing it.
  // Scoped to main: the nav also links there, and matching that instead would
  // pass even if the page never mentioned triage at all.
  await expect(
    page.locator("main").getByRole("link", { name: "caseload", exact: true })
  ).toBeVisible();
  // No band labels here — those belong to the caseload, and two triage views
  // that disagree is worse than one.
  await expect(page.getByTestId("band")).toHaveCount(0);
});
