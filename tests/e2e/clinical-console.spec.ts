import { test, expect } from "@playwright/test";

// The Steady Clinical console under real auth, CSP, and the demo dataset.
// Hermetic seeded server only (needs the seeded clinician account).
test.skip(Boolean(process.env.E2E_BASE_URL), "runs only against the hermetic seeded server");

async function signInAsClinician(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("clinician.demo@steady.local");
  await page.locator('input[name="password"]').fill("clinician1234");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/clinician/);
}

test("the caseload orders by clinical need and always shows its reason", async ({ page }) => {
  // REWRITTEN FOR THE TABLE THAT SHIPS. This asserted against a list of
  // `caseload-row` cards carrying a band badge and a bulleted reason list. That
  // list is still in the page — as the FALLBACK branch, taken only when the
  // clinical-state projection is unavailable — so with the demo dataset loaded
  // the assertions were waiting on markup no one sees, and the suite had been
  // red since the caseload became a state table.
  //
  // The property is the same and is worth more on the new screen than the old
  // one: a band never appears as a bare label. What changed is what supplies
  // the reason. The table's whole design is that there is no combined score —
  // each person has a separate named state per column — so the reason is those
  // states, and a row showing a band with no named state beside it is exactly
  // the verdict-without-evidence the screen exists to refuse.
  await signInAsClinician(page);
  await page.goto("/clinician/caseload");

  await expect(page.getByRole("heading", { name: "Caseload", level: 1 })).toBeVisible();

  // A demonstration surface must never imply approval (handoff §2).
  await expect(page.getByText(/Provisional configuration/)).toBeVisible();
  await expect(page.getByText(/not clinically approved/)).toBeVisible();

  const rows = page.getByTestId("caseload-state-row");
  const count = await rows.count();
  expect(count, "the caseload is empty — the rule below would pass vacuously").toBeGreaterThan(0);

  let banded = 0;
  let clear = 0;
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const text = (await row.textContent())?.trim() ?? "";
    const band = (await row.getByTestId("band-label").first().textContent())?.trim().toLowerCase() ?? "";
    if (band.includes("clear")) { clear += 1; continue; }
    banded += 1;
    // Every column reports a state in words, including when it has nothing:
    // "Not set", "Not computed", "Insufficient evidence" are readings, not
    // blanks. A banded row with none of them is a band with no account of
    // itself.
    expect(
      /Not set|Not computed|Insufficient evidence|tolerated|Held by a safety decision|appears/i.test(text),
      `a banded row carries no named state: ${text.slice(0, 120)}`
    ).toBe(true);
  }
  // Both branches were taken, so neither is dead the next time the dataset
  // shifts under it.
  expect(banded, "no banded row on the caseload — the rule went untested").toBeGreaterThan(0);
  expect(clear, "no clear row on the caseload — the skip went untested").toBeGreaterThan(0);
});

test("a member record shows cited claims, marked provenance, and separated AI output", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/clinician/caseload");

  // Open the first member in the caseload. The state table links to the person
  // record's root rather than straight to /record, which is §5's grouping — the
  // record decides which section opens, not the row that led here.
  await page.getByTestId("caseload-state-row").first().getByRole("link").first().click();
  await expect(page).toHaveURL(/\/clinician\/member\/[^/]+/);
  await page.goto(`${new URL(page.url()).pathname.replace(/\/$/, "")}/record`);
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

test("the clinical console is reachable from the navigation it actually ships", async ({ page }) => {
  // TWO SHELLS, AND THIS TEST WAS ASSERTING THE ONE THAT MOVED. Package 2 put
  // /clinician/today behind the clinician experience shell — "Steady Clinical
  // navigation", three destinations — while every other clinical and review
  // page still uses the app shell's information-layer rail. This started at
  // /clinician, which redirects to today, and then waited thirty seconds for a
  // rail that is deliberately not there.
  //
  // The property is unchanged and is asserted on both shells rather than
  // whichever one the test happened to land in: a console page is one click
  // from the console, and the navigation says where you are rather than only
  // where you can go.
  await signInAsClinician(page);

  await page.goto("/clinician/today");
  const shell = page.getByRole("navigation", { name: "Steady Clinical navigation" });
  await shell.getByRole("link", { name: "Patients" }).click();
  await expect(page).toHaveURL(/\/clinician\/patients$/);

  await page.goto("/clinician/caseload");
  const rail = page.getByRole("navigation", { name: "Information layers" });
  // The rail a clinician sees holds Overview, Progress, Evidence and the
  // crossing to the review console. Naming a layer this role does not have was
  // how the previous version of this test waited thirty seconds for a link.
  await rail.getByRole("link", { name: "Evidence" }).click();
  await expect(page).toHaveURL(/\/clinician\/reports$/);
  // Where you are, not only where you can go.
  await expect(
    page.getByRole("navigation", { name: "Information layers" })
      .getByRole("link", { name: "Evidence" })
  ).toHaveAttribute("aria-current", "page");
});

// ---------------------------------------------------------------------------
// Phase 4 completion: audit history, alert trail, BLS Part 6 oversight
// ---------------------------------------------------------------------------

test("a member record carries its audit history with the chain verified", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/clinician/caseload");
  await page.getByTestId("caseload-state-row").first().getByRole("link").first().click();
  // §5 regrouped the person record, and audit history is its own section
  // rather than a block at the bottom of /record. Reached through the record's
  // own navigation, so this asserts it is reachable rather than only that the
  // URL exists.
  await page.getByRole("link", { name: "Audit", exact: true }).first().click();
  await expect(page).toHaveURL(/\/clinician\/member\/[^/]+\/audit$/);

  // The section is titled "Audit and lineage" and leads with access and
  // decisions; "Audit history" was the old record page's block heading. The
  // property under test is not the wording — it is that a person's record
  // carries its own audit, with the chain verified on screen.
  await expect(page.getByRole("heading", { name: "Access and decisions" })).toBeVisible();
  // Tamper-evidence is shown, not asserted in prose. A chain nobody checks is
  // a claim rather than a control.
  await expect(page.getByTestId("chain-banner").first()).toContainText(/Chain intact/);
  // §14's distinction reaches the screen rather than living in a comment:
  // "nothing happened" and "you cannot see what happened" are different, and
  // the scope note says which this is.
  await expect(page.getByText(/scope|filtered view/i).first()).toBeVisible();
});

test("the audit console is tenant-scoped and never prints raw detail", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/review/audit");

  await expect(page.getByRole("heading", { name: "Audit trail" })).toBeVisible();
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

  // Crossing back the other way lands on /clinician/today, which is the one
  // clinical page behind the experience shell — so the walk continues in that
  // shell's navigation rather than in the rail. Reaching a console must not
  // depend on which shell the previous click left you in.
  const shell = page.getByRole("navigation", { name: "Steady Clinical navigation" });
  await shell.getByRole("link", { name: "Patients" }).click();
  await expect(page).toHaveURL(/\/clinician\/patients$/);

  const clinRail = page.getByRole("navigation", { name: "Information layers" });
  await clinRail.getByRole("link", { name: "Progress" }).click();
  await expect(page).toHaveURL(/\/clinician\/caseload$/);
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

// ---------------------------------------------------------------------------
// §29's person-level charts
// ---------------------------------------------------------------------------

async function openMemberWithSessions(page: import("@playwright/test").Page): Promise<string> {
  // FOUND BY NAME, not by position.
  //
  // This read `ids[1]` off the caseload, under a comment saying the seeded
  // member with a session history is the second row. That was true until the
  // caseload's ordering changed: twenty-six check-ins that had routed to crisis
  // gained the urgent alerts they should always have raised, three of those
  // people banded immediate ahead of this one, and both charts below started
  // being read on a member who has no sessions at all. The tests failed for a
  // reason that had nothing to do with what they are about, which is what a
  // positional fixture buys.
  //
  // Exactly one seeded person carries the history these two charts are about —
  // the hard stop that opened at 6 and closed at 9, and the fixed gate events
  // beside it. The patient directory names everybody, so they are found there.
  await page.goto("/clinician/patients");
  const href = await page
    .locator('a[href*="/clinician/member/"]')
    .filter({ hasText: "Alex Rivera" })
    .first()
    .getAttribute("href");
  const id = (href ?? "").split("/")[3];
  if (!id) throw new Error("the seeded member with a session history is not in the patient directory");
  return id;
}

test("session response shows both readings, and keeps the session that went the wrong way", async ({ page }) => {
  await signInAsClinician(page);
  const id = await openMemberWithSessions(page);
  await page.goto(`/clinician/member/${id}/sessions`);

  await expect(page.getByText("Activation before and after each session")).toBeVisible();

  // The hard stop is the row a clinician most needs, and it is the one a
  // status filter would remove: it opened at 6 and closed at 9.
  await expect(page.getByText("6 → 9")).toBeVisible();
  await expect(page.getByText("higher at close")).toBeVisible();

  // The footnote accounts for every session in the window: how many were
  // looked at, and how many of the plotted ones recorded a close. Whether the
  // seed happens to contain an unplottable session depends on the time of day
  // the demo was built, so the assertion is on the ACCOUNTING being present,
  // not on a particular gap existing.
  await expect(page.getByText(/Last \d+ sessions\./)).toBeVisible();
  await expect(page.getByText(/recorded a reading at close/)).toBeVisible();
});

test("the safety timeline shows fixed gates and never a risk score", async ({ page }) => {
  await signInAsClinician(page);
  const id = await openMemberWithSessions(page);
  await page.goto(`/clinician/member/${id}/safety`);

  await expect(page.getByText("Fixed gate events and human response")).toBeVisible();
  // The marks carry a word, not only a colour.
  await expect(page.getByText("BLOCK", { exact: true })).toBeVisible();
  await expect(page.getByText("CLEAR", { exact: true })).toBeVisible();

  // §29.1's rule, stated on the screen a clinician reads.
  await expect(page.getByText(/No predictive risk score/)).toBeVisible();

  // And nothing on the page offers a forward-looking number. The screen's own
  // disclaimer says the words "risk score", so it comes out before the scan —
  // otherwise the safeguard reads as the violation.
  const body = (await page.locator("main").innerText())
    .replace(/No predictive risk score[^.]*\./g, " ");
  expect(body).not.toMatch(/\b(risk score|likelihood|probability of|predicted)\b/i);
});

test("engagement shows which days, not a rate, and never counts pre-enrolment days", async ({ page }) => {
  await signInAsClinician(page);
  const id = await openMemberWithSessions(page);
  await page.goto(`/clinician/member/${id}`);

  const strip = page.locator('section[aria-labelledby="engagement"]');
  await expect(strip).toBeVisible();
  await expect(strip.getByText("Days present, most recent last")).toBeVisible();

  // Three states, each named in the legend. A day nobody could have checked in
  // on is drawn differently from a day they skipped. Exact matching, because
  // every cell also carries a screen-reader label using the same words —
  // which is itself the point: the strip is readable without seeing it.
  for (const state of ["checked in", "no check-in", "before enrolment"]) {
    await expect(strip.getByText(state, { exact: true })).toBeVisible();
  }

  // The denominator is enrolled days, not the window.
  await expect(strip.getByText(/of \d+ enrolled days carry a check-in/)).toBeVisible();

  // No rate, no streak, no adherence framing. The screen's own disclaimers use
  // two of those words to disown them — "not adherence", "not a compliance
  // failure" — so they come out before the scan, or the safeguard reads as the
  // violation. Same trap as the timeline's "No predictive risk score".
  const text = (await strip.innerText())
    .replace(/not a compliance failure/gi, " ")
    .replace(/not adherence/gi, " ");
  expect(text).not.toMatch(/\b(streak|consecutive|adherence|compliance)\b/i);
  expect(text).not.toMatch(/\d+%/);

  // And the interpretation a clinician needs before reading a gap.
  await expect(strip.getByText(/reason to ask, not a compliance failure/)).toBeVisible();
});

// ---------------------------------------------------------------------------
// The row actions actually work — the test whose absence let them break
// ---------------------------------------------------------------------------

test("completing a review from the queue records it, and says what it recorded", async ({ page }) => {
  // THIS TEST EXISTS BECAUSE ALL THREE ROW ACTIONS WERE DEAD AND EVERYTHING
  // PASSED. `resolveCommand` refuses a payload carrying an authority field, and
  // `personId` was on that list — so record contact, assign and complete review
  // each threw before doing anything, and "Could not save" was the only outcome
  // any of them had ever produced. A unit test pinned the list and another
  // asserted the three functions were exported; nothing pressed the button.
  //
  // So this presses the button. It is deliberately end-to-end rather than a
  // unit test of the action: the defect was in the seam between a payload the
  // component builds and a rule the command layer applies, and a test on either
  // side of that seam could not see it.
  await signInAsClinician(page);
  await page.goto("/clinician/today");

  // The queue's own control, opened from the first row that offers a review.
  const open = page.getByRole("button", { name: "Complete review" }).first();
  await expect(open).toBeVisible();
  await open.click();

  await page.locator("textarea").first().fill("Called them; agreed a grounding-only week.");
  await page.getByRole("button", { name: "Record it" }).first().click();

  // §5: "Show exactly what the action changed after the server confirms it."
  //
  // ASSERTED ON THE REGION ABOVE THE LIST, NOT ON THE ROW, and that is the
  // third finding in this seam. Reviewing an alert-derived row closes that
  // person's open alerts, and the queue reads an alert's status — so the row
  // leaves the list and used to take its confirmation with it. The clinician
  // pressed "Record it" on a safety row and it silently vanished, which is
  // indistinguishable from a re-sort.
  const confirmations = page.getByTestId("queue-confirmations");
  await expect(confirmations).toContainText(/Recorded your review/, { timeout: 15000 });
  // And it says WHAT changed, not that something did.
  await expect(confirmations).toContainText(/closed \d+ open alert/);
  await expect(page.getByText("Could not save")).toHaveCount(0);

  // The row it came from is gone, and the confirmation outlived it.
  await expect(page.getByText(/\d+ items need review\./)).toBeVisible();
});

test("a safety row will not close on an acknowledgement", async ({ page }) => {
  // The rule that survives the fix above. An immediate-band alert closes with a
  // documented action, never an empty note — and the drawer calls the note
  // optional, which is true for a caseload row and not for this one. So the
  // refusal has to SAY which rule refused it rather than failing quietly.
  await signInAsClinician(page);
  await page.goto("/clinician/today");

  await page.getByRole("button", { name: "Complete review" }).first().click();
  await page.getByRole("button", { name: "Record it" }).first().click();

  await expect(page.getByText(/closes with a documented action/)).toBeVisible({ timeout: 15000 });
  // Including the article. A clinician read "A immediate-band alert" until the
  // article was chosen rather than assumed.
  await expect(page.getByText(/An immediate-band alert/)).toBeVisible();
});
