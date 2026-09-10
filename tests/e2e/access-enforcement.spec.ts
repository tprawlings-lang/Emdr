import { test, expect } from "@playwright/test";
import { ROUTE_REGISTER } from "../../src/lib/app/route-register";

// The permission sequence, attacked rather than read (handoff 06 §30.6, §31.5).
//
// tests/access-enforcement.test.ts inventories which guards are CALLED on which
// route. That is the half a scan can do, and it is explicitly not a proof that
// any guard is correct — the review screen says so where a reader cannot miss
// it. This file is the other half: it takes the sequence's first three steps to
// a running server and tries to get past them.
//
// It is deliberately small. The exhaustive cross-tenant work is in
// tests/tenant-isolation.ts and the three boundary suites, which attack the
// data layer directly and can afford hundreds of cases. What only a browser can
// check is the part that happens BEFORE any of that: whether the route itself
// lets somebody through, and what it says when it does not.

const ROLES = {
  member: { email: "patient.demo@steady.local", password: "patient1234" },
  clinician: { email: "clinician.demo@steady.local", password: "clinician1234" },
  reviewer: { email: "reviewer.demo@steady.local", password: "reviewer1234" },
} as const;

async function signIn(page: import("@playwright/test").Page, role: keyof typeof ROLES) {
  const who = ROLES[role];
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(who.email);
  await page.locator('input[name="password"]').fill(who.password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

// One route per protected console, chosen for what it holds rather than at
// random: a caseload, an aggregate population, the audit trail, a member's own
// day, and the demo administration.
const PROTECTED = [
  "/clinician/today",
  "/clinician/caseload",
  "/organization/overview",
  "/payer/overview",
  "/review/audit",
  "/review/security",
  "/app/today",
  "/admin/demo",
];

test("step 1: no protected console opens without an account", async ({ page }) => {
  // §30.6 step 1's failure behaviour is a generic denied state. Reaching any of
  // these signed out must not render the thing behind it, whatever else it
  // does.
  for (const route of PROTECTED) {
    await page.context().clearCookies();
    await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(page.url(), `${route} opened without an account`).toMatch(/\/(login|session-expired|403|app\/today)/);
  }
});

test("step 2: a member is refused every console that is not theirs", async ({ page }) => {
  // The role check, from the account most likely to reach for something it
  // should not — and the one whose denial must be gentlest. §30.6's own note:
  // a member goes to their own home, because a denial screen would be an answer
  // to a question they did not ask.
  await signIn(page, "member");
  for (const route of ["/clinician/today", "/organization/overview", "/payer/overview", "/review/audit"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(page.url(), `a member reached ${route}`).not.toContain(route);
    await expect(page.locator("main")).not.toContainText("Your attention queue");
  }
});

test("step 2: a clinician is refused the aggregate consoles", async ({ page }) => {
  // The boundary §30.6 states outright: aggregate access does not create care
  // access, and care access does not create aggregate access. A clinician has
  // a care relationship with people; they have no contract with a population.
  await signIn(page, "clinician");
  for (const route of ["/organization/overview", "/payer/overview"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(page.url(), `a clinician reached ${route}`).not.toContain(route);
  }
});

test("step 3: a person outside the caseload is not found, not forbidden", async ({ page }) => {
  // THE DIFFERENCE THAT MATTERS. A forbidden record and a missing one must be
  // indistinguishable, or the denial itself confirms the person exists — which
  // is what §30.6 step 2's "do not reveal protected subject existence" is
  // about. A well-formed id that is not in this clinician's tenant is the test:
  // it cannot be told from an id nobody has ever used.
  await signIn(page, "clinician");
  const fabricated = "00000000000000000000000000000001";
  const res = await page.goto(`/clinician/member/${fabricated}`, { waitUntil: "domcontentloaded" });
  expect(res?.status(), "a record outside the caseload answered with something other than not-found").toBe(404);
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/forbidden|not authori[sz]ed|permission denied/i);
});

test("a reviewer can open every screen their own console lists", async ({ page }) => {
  // THE REVIEW CONSOLE LISTED A SCREEN THE REVIEWER COULD NOT OPEN. The audit
  // trail's layout calls `requireReviewAccess` and its page called
  // `requireClinician` — guards that disagree by exactly one role — so clicking
  // "Audit trail" in the reviewer's own navigation bounced them back to the
  // console's landing page with no explanation. The register calls it a
  // reviewer route, and §6 gives the security reviewer this exact artefact:
  // "who accessed or changed what, and can the record be trusted?".
  //
  // Found by a performance run. The gate refuses to time a redirect, and this
  // route answered 25 out of 25 with one.
  // Driven from the ROUTE REGISTER rather than from the rendered navigation.
  // The console's nav shows only the screens in the layer you are already on,
  // so no single page lists them all — and the register is the canonical
  // statement of what exists for whom in any case.
  await signIn(page, "reviewer");
  const screens = ROUTE_REGISTER
    .filter((r) => r.audience === "reviewer" && r.state === "working" && !r.path.includes("["))
    .map((r) => r.path);
  expect(screens.length, "the register lists no working reviewer screens").toBeGreaterThan(10);

  const bounced: string[] = [];
  for (const href of screens) {
    await page.goto(href, { waitUntil: "domcontentloaded" });
    if (new URL(page.url()).pathname !== href) {
      bounced.push(`${href} -> ${new URL(page.url()).pathname}`);
    }
  }
  expect(bounced, "screens the register offers a reviewer and the app refuses them").toEqual([]);
});

test("the review console states what its own inventory cannot prove", async ({ page }) => {
  // The screen is evidence for a security reviewer, and evidence that overclaims
  // is worse than none. A full row means the guard is called; it never means the
  // guard is right.
  await signIn(page, "reviewer");
  await page.goto("/review/security", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Access enforcement", level: 1 })).toBeVisible();
  await expect(page.locator("main")).toContainText(/does not\s+prove the guard is correct/);
  await expect(page.locator("main")).toContainText(/attacking the boundary/);
  // And it shows the open questions rather than only what passed.
  //
  // BY ROLE, NOT BY TEXT. `getByText("Open questions")` matched the heading
  // alone until the panel's empty state started explaining where the open
  // questions had GONE — and then matched two elements and failed in strict
  // mode, on a page that was working. A phrase is not a selector: the thing
  // being asserted is that the section exists, so ask for the heading.
  await expect(page.getByRole("heading", { name: "Open questions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Declared exemptions" })).toBeVisible();
});
