import { test, expect } from "@playwright/test";

// FAILURE-INJECTION EVIDENCE for the failure register's
// `uncertain.retry-returns-existing-result` — see
// src/lib/governance/failure-register.ts.
//
// THE UNIT TESTS PROVE THE LEDGER. This proves the KEY, which is the half that
// broke twice and both times only a browser showed it.
//
// `recordContact` used to deduplicate on the note text within the last twenty
// care actions. Replacing that with a real idempotency key looked like the fix
// and was not: the queue built its key from `personId:signalId`, which is
// stable for the life of the row and therefore stable across page loads — so a
// clinician who attempted contact on Monday and again on Wednesday with the
// same words had Wednesday's press replay Monday's result. The confirmation
// read exactly like a fresh one, over a record that gained nothing. Same lost
// clinical entry, one layer further down, and the node tests were all green.
//
// So this presses the button twice, with identical wording, from two separate
// page loads, and reads the person's own record afterwards. Two attempts
// happened; two must be written down.

test.skip(Boolean(process.env.E2E_BASE_URL), "runs only against the hermetic seeded server");
test.describe.configure({ mode: "serial" });

const NOTE = "Left a voicemail.";

async function signInAsClinician(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("clinician.demo@steady.local");
  await page.locator('input[name="password"]').fill("clinician1234");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/clinician/);
}

/** A caseload row: the one that offers Record contact. */
async function openAContactableRow(page: import("@playwright/test").Page): Promise<string> {
  await page.goto("/clinician/today");
  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll('a[href*="row="]')].map((a) => a.getAttribute("href")));
  const href = hrefs.find((h) => h && /row=person/.test(decodeURIComponent(h)));
  expect(href, "the queue has no caseload row, so Record contact is not offered anywhere").toBeTruthy();
  await page.goto(href!);
  await expect(page.getByTestId("queue-evidence-panel")).toBeVisible();
  return href!;
}

async function recordContactInPanel(page: import("@playwright/test").Page, note: string): Promise<string> {
  const panel = page.getByTestId("queue-evidence-panel");
  await panel.getByRole("button", { name: /Record contact/i }).first().click();
  await panel.locator("textarea").first().fill(note);
  await panel.getByRole("button", { name: /^Record it$/ }).first().click();
  const confirmed = panel.getByTestId("row-action-confirmed");
  await expect(confirmed).toBeVisible({ timeout: 15000 });
  return (await confirmed.innerText()).replace(/\s+/g, " ").trim();
}

test("two genuine contact attempts with identical wording are both recorded", async ({ page }) => {
  await signInAsClinician(page);
  const row = await openAContactableRow(page);

  const first = await recordContactInPanel(page, NOTE);
  expect(first, "the first press did not report a write").toMatch(/^Saved/);
  expect(first).toContain("Recorded that you attempted contact");

  // A SEPARATE PRESS, from a fresh load. Not a retry: the first was confirmed
  // on screen. This is a clinician trying again two days later and writing the
  // same sentence, which is the ordinary case and the one that was lost.
  await page.goto(row);
  await expect(page.getByTestId("queue-evidence-panel")).toBeVisible();
  const second = await recordContactInPanel(page, NOTE);

  // READ THE LABEL, NOT THE SENTENCE. A replayed result renders the same
  // summary as a fresh one — that is exactly how this defect hid twice — and
  // the label is the only thing that distinguishes them.
  expect(
    second,
    "the second attempt replayed the first: the words were identical, the key did not change, and the record gained nothing",
  ).toMatch(/^Saved/);
  expect(second, "a replay must announce itself rather than reading like a fresh write")
    .not.toContain("Already saved");
});
