import { test, expect } from "@playwright/test";

// Queue stability (17 September handoff, P3): "Revalidate consequential
// actions against current server state. Do not move a row beneath a pointer
// while an action is being taken."
//
// THE CHECK EXISTED AND WAS DISABLED FOR THE LIFE OF THE FEATURE. completeReview
// compares the version the reader's page was built from against the one the
// server holds now, and returns `stale` rather than acknowledging on top of
// somebody else's decision — but the queue passed `expectedVersion={null}` at
// both call sites, and the comparison reads `if (command.expectedVersion && …)`.
// It short-circuited on every request ever made, and no test noticed, because a
// guard that is never armed passes everything written about the code around it.
//
// TWO THINGS HAVE TO BE TRUE AND ONLY A BROWSER CAN SHOW BOTH. Arming a check
// like this can just as easily reject every legitimate action, which would be
// worse than the defect — so the first test presses the button normally and
// expects it to work, and the second stages a real collision between two
// signed-in readers.

test.skip(Boolean(process.env.E2E_BASE_URL), "runs only against the hermetic seeded server");

// SERIAL, AND THIS FILE WRITES. Staging a collision means actually completing a
// review, which closes that person's open alerts and cannot be undone — so
// playwright.config.ts runs this project after the read-only specs, and these
// two tests run in order because they were otherwise consuming each other's
// rows: the first reviewed the row the second needed.
test.describe.configure({ mode: "serial" });

async function signInAsClinician(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("clinician.demo@steady.local");
  await page.locator('input[name="password"]').fill("clinician1234");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/clinician/);
}

/**
 * Open the evidence panel of a row that CARRIES A VERSION.
 *
 * Not simply the first row, which is what the first version of this spec did
 * and why it failed against the seeded dataset while passing by hand. A
 * caseload row deliberately has no version — completing a review of one closes
 * nothing and changes nothing, so there is no state for a second clinician to
 * collide with and a warning there could only ever be a false alarm. A
 * collision test that lands on one is asserting the check fires where the
 * design says it must not.
 */
async function openAVersionedRow(page: import("@playwright/test").Page): Promise<string> {
  await page.goto("/clinician/today");
  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll('a[href*="row="]')].map((a) => a.getAttribute("href")));
  // `signal:` and `alert:` rows carry a version; `person:` rows are the caseload.
  const href = hrefs.find((h) => h && /row=(signal|alert)/.test(decodeURIComponent(h)));
  expect(href, "the queue has no signal or alert row, so there is no versioned row to collide on")
    .toBeTruthy();
  await page.goto(href!);
  await expect(page.getByTestId("queue-evidence-panel")).toBeVisible();
  return href!;
}

/**
 * The two-step review, INSIDE THE PANEL: the primary action opens the note,
 * "Record it" sends.
 *
 * Scoped to the evidence panel, which the first version of this helper was not.
 * The queue renders a row's actions on every row, so `.first()` pressed row
 * one's button while the panel — and the version this test is about — belonged
 * to a different row. The test then staged a collision on a row nobody was
 * colliding over and reported that the guard had not fired.
 */
async function completeReviewInPanel(page: import("@playwright/test").Page, note: string) {
  const panel = page.getByTestId("queue-evidence-panel");
  await panel.getByRole("button", { name: /Complete review/i }).first().click();
  await panel.locator("textarea").first().fill(note);
  await panel.getByRole("button", { name: /^Record it$/ }).first().click();
}

test("a review still goes through when nothing has changed", async ({ page }) => {
  // The half that matters most: a version check sent from the surface must
  // match what the server recomputes. A version built from one field at one end
  // and a different field at the other compiles, reads correctly, and rejects
  // every review a clinician ever takes.
  await signInAsClinician(page);
  await openAVersionedRow(page);
  await completeReviewInPanel(page, "Called and confirmed safe; follow-up booked Thursday.");

  await expect(page.getByText(/Recorded your review/i).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("queue-evidence-panel")
    .getByTestId("row-action-problem")).toHaveCount(0);
});

// FAILURE-INJECTION EVIDENCE for the failure register's
// `concurrency.two-clinicians-one-row` — see src/lib/governance/failure-register.ts.
// The register verifies that this file names that id, so the scenario and the
// injection can be found from each other. A row claiming evidence from a file
// that never mentions it is the drift P6's acceptance exists to prevent.
test("two clinicians acting on one row: the second is told, not overwritten", async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const a = await first.newPage();
  const b = await second.newPage();

  await signInAsClinician(a);
  const row = await openAVersionedRow(a);

  // The other reader opens the same row and acts on it.
  await signInAsClinician(b);
  await b.goto(row);
  await expect(b.getByTestId("queue-evidence-panel")).toBeVisible();
  await completeReviewInPanel(b, "Spoke with them; nothing further needed today.");
  await expect(b.getByText(/Recorded your review/i).first()).toBeVisible({ timeout: 15000 });

  // The first reader now presses their own button, holding the older version.
  await completeReviewInPanel(a, "Reviewed; no action needed.");

  // LOOKED FOR ABOVE THE LIST, NOT INSIDE THE ROW, and finding out why was the
  // point of this test. A server action re-renders the route; by then the row
  // the other clinician resolved is gone, the panel unmounts, and the conflict
  // message unmounted with it — so the reader watched the row vanish and would
  // have read that as their own action succeeding. Conflicts are lifted now,
  // the way confirmations already were.
  const problem = a.getByTestId("queue-problem-notice");
  await expect(problem, "the second decision landed on top of the first with nobody told")
    .toContainText(/changed/i, { timeout: 15000 });
  const said = await problem.first().innerText();

  // And it says what the server holds now, so the reader can go and read it
  // rather than being told only that they failed.
  expect(said, `the conflict does not say what the server now holds: ${said}`)
    .toMatch(/queue now holds|open now/i);

  // And it is never dressed as success: the reader must not be able to mistake
  // it for the confirmation that sits in the same region.
  await expect(a.getByTestId("queue-confirmed-notice")).toHaveCount(0);

  await first.close();
  await second.close();
});
