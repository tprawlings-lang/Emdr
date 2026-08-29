import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

// The governed export, as a person actually performs it (§29.1's export rule,
// §30.4's POST /exports, §31.4's export row).
//
// The unit guards prove createExport refuses, suppresses, signs and audits.
// None of that reaches anyone unless the screen refuses too — and a screen is
// where the interesting failures live, because the browser's own validation
// looks exactly like a server control until you turn it off.
//
// So this spec does three things a unit test cannot: it submits a purpose the
// browser would have blocked, to prove the SERVER refuses; it follows the
// released file to the endpoint that serves it, to prove the signature is
// checked on the way out rather than only on the way in; and it reads the
// history back, because a console that can export but cannot show what it has
// exported has a disclosure log nobody can read.

test.skip(
  Boolean(process.env.E2E_BASE_URL),
  "authenticated flow runs only against the hermetic seeded server",
);

type Page = import("@playwright/test").Page;

async function signInAsOperations(page: Page) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.locator('input[name="email"]').fill("operations@example.com");
  await page.locator('input[name="password"]').fill("demo1234");
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/organization/);
}

function exportForm(page: Page) {
  // Scoped to the form that carries the purpose field. The shell also renders
  // a sign-out form, and a bare `form button` would sign the account out
  // halfway through a spec about exporting.
  return page.locator('form:has(textarea[name="purpose"])');
}

/** Submit the export form with a purpose, waiting for the navigation the
 *  server action produces. `networkidle` does not cover a server-action
 *  submit — the redirect is the completion signal. */
async function exportWith(page: Page, purpose: string, expectUrl: RegExp) {
  await page.locator('textarea[name="purpose"]').fill(purpose);
  await Promise.all([
    page.waitForURL(expectUrl),
    exportForm(page).getByRole("button", { name: "Create export" }).click(),
  ]);
}

/**
 * Fetch a route the way the page itself would.
 *
 * Not `page.request`: that is a separate context and does not carry the
 * session cookie, so every call comes back as the sign-in page with status
 * 200 — which looks exactly like a passing assertion against a served file.
 * An in-page fetch is authenticated by the same cookie the user has, which is
 * the thing being tested.
 */
async function fetchAsUser(page: Page, path: string) {
  return page.evaluate(async (p) => {
    const r = await fetch(p);
    return { status: r.status, url: r.url, body: await r.text() };
  }, path);
}

test("a file cannot be produced without saying what it is for", async ({ page }) => {
  await signInAsOperations(page);
  await page.goto("/organization/reports");

  // The browser's own control comes first: the field is required, so an empty
  // submit never reaches the network at all.
  await exportForm(page).getByRole("button", { name: "Create export" }).click();
  await expect(page).toHaveURL(/\/organization\/reports$/);
  await expect(page.getByText(/Export released/)).toHaveCount(0);

  // Now the part that matters. Client validation is a courtesy, not a control:
  // anyone can remove the attributes, and a rule enforced only in the browser
  // is a rule enforced only against people who are not trying. Strip them and
  // submit a purpose that says nothing.
  await page.evaluate(() => {
    const t = document.querySelector('textarea[name="purpose"]') as HTMLTextAreaElement | null;
    t?.removeAttribute("required");
    t?.removeAttribute("minLength");
    t?.removeAttribute("minlength");
  });
  await exportWith(page, "report", /refused=/);

  // The refusal is on the page, in words, and no file was released.
  await expect(page.getByRole("status")).toContainText(/Export refused/);
  await expect(page.getByRole("status")).toContainText(/what this file is for/);
  await expect(page.getByText(/Export released/)).toHaveCount(0);
});

test("a released export carries its filter, its cohort and its purpose out of the building", async ({ page }) => {
  await signInAsOperations(page);
  await page.goto("/organization/reports");

  const PURPOSE = "Quarterly access review with the North site lead, 14 March";
  await exportWith(page, PURPOSE, /export=/);

  // What the screen says about the release.
  const released = page.getByText(/Export released/);
  await expect(released).toBeVisible();
  const summary = await page.locator("main").innerText();
  const filterHash = summary.match(/filter ([0-9a-f]{16})/)?.[1];
  expect(filterHash, "the screen does not show the filter hash it released under").toBeTruthy();

  // The id travels in the URL, and the file is fetched separately — §30.4's
  // point that a disclosure is a POST and the artefact is its own request.
  const exportId = new URL(page.url()).searchParams.get("export");
  expect(exportId, "no export id was returned").toBeTruthy();

  // Taken by clicking the link, not by calling the route: this proves the
  // manifest DOWNLOADS. A manifest that renders inline is one that gets
  // screenshotted instead of kept, and the download event only fires because
  // the response says attachment.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download the signed manifest" }).click(),
  ]);
  const path = await download.path();
  expect(path, "the manifest link did not produce a file").toBeTruthy();
  const manifest = readFileSync(path!, "utf8");
  expect(download.suggestedFilename()).toContain(exportId!.slice(0, 8));

  // Filter parity is the whole point: the file must be checkable against the
  // view that produced it, and that is only true if the hash matches.
  expect(manifest).toContain(`# Filter hash: ${filterHash}`);
  expect(manifest).toContain(`# Purpose: ${PURPOSE}`);
  expect(manifest).toMatch(/# Cohort version: network:/);
  expect(manifest).toMatch(/# Signature verified: yes/);
  expect(manifest).toMatch(/FABRICATED DEMONSTRATION DATA/);

  // And the release is in the history, under the name of whoever asked. That
  // list IS the disclosure log.
  await page.goto("/organization/reports");
  const history = page.locator('section:has(> h2:text-is("Export history"))');
  await expect(history).toContainText(PURPOSE);
  await expect(history).toContainText(/Jordan Idowu/);
  await expect(history).toContainText(filterHash!);
});

test("an export id nobody released is not served", async ({ page }) => {
  await signInAsOperations(page);
  // A well-formed id that does not exist answers not-found rather than
  // forbidden. "Forbidden" would confirm which ids are real.
  const res = await fetchAsUser(page, "/api/exports/00000000-0000-4000-8000-000000000000");
  expect(res.status, `an unreleased id answered ${res.status}`).toBe(404);
});

test("the export endpoint is not reachable without an aggregate account", async ({ page }) => {
  // Signed out entirely. The manifest names a cohort and a purpose, so it is
  // not a public artefact even though the console it came from is described on
  // the public site.
  await page.goto("/login");
  const res = await fetchAsUser(page, "/api/exports/00000000-0000-4000-8000-000000000000");
  // The redirect is followed, so what matters is where it lands: the sign-in
  // page, never a manifest.
  expect(res.url).toMatch(/\/login|\/session-expired/);
  expect(res.body).not.toMatch(/Steady export manifest/);
});

test("the payer console exports its own contract report, with its own cohort", async ({ page }) => {
  await signInAsOperations(page);
  await page.goto("/payer/contract");

  const PURPOSE = "Joint operating committee pack for the April contract review";
  await exportWith(page, PURPOSE, /export=/);
  await expect(page.getByText(/Export released/)).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download the signed manifest" }).click(),
  ]);
  const manifest = readFileSync((await download.path())!, "utf8");

  expect(manifest).toContain("# Surface: payer/contract");
  // The contract's own cohort version, not the network's — a payer report
  // reproduced against the wrong cohort is a different report.
  expect(manifest).not.toMatch(/# Cohort version: network:/);
  expect(manifest).toMatch(/# Cohort version: .+/);
  // Complete months only, recorded in the filter so the file can be checked
  // against the table that produced it.
  expect(manifest).toMatch(/completeMonthsOnly":true/);
});
