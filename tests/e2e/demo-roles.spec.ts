import { test, expect } from "@playwright/test";

// The six demo roles, as a presenter and an attacker each experience them
// (handoff 07 §1.2 p6, §1.4 p8).
//
// p8 lists five required negative tests, and they are the deliverable of this
// wave rather than an afterthought. Each one is a way the role model could be
// undone by a convenient line, and none of them is visible in the source: they
// are about what a running server answers.

test.skip(
  Boolean(process.env.E2E_BASE_URL),
  "authenticated flow runs only against the hermetic seeded server",
);

type Page = import("@playwright/test").Page;

const ACCOUNTS = {
  patient:      { email: "patient.demo@steady.local",   password: "patient1234",   landing: /\/app\/today/ },
  clinician:    { email: "clinician.demo@steady.local", password: "clinician1234", landing: /\/clinician\/today/ },
  reviewer:     { email: "reviewer.demo@steady.local",  password: "reviewer1234",  landing: /\/review\/safety/ },
  organization: { email: "org.demo@steady.local",       password: "org1234",       landing: /\/organization\/overview/ },
  payer:        { email: "payer.demo@steady.local",     password: "payer1234",     landing: /\/payer\/overview/ },
  demo_admin:   { email: "admin.demo@steady.local",     password: "demoadmin1234", landing: /\/admin\/demo/ },
} as const;

/** Sign in, waiting on the navigation the server action produces rather than
 *  on network idle — a server-action submit does not settle the way a fetch
 *  does, and asserting the URL afterwards races the redirect. */
async function signIn(page: Page, who: keyof typeof ACCOUNTS, selectRole?: string) {
  const a = ACCOUNTS[who];
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  if (selectRole !== undefined) {
    await page.locator('select[name="role"]').selectOption(selectRole);
  }
  await page.locator('input[name="email"]').fill(a.email);
  await page.locator('input[name="password"]').fill(a.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login") || u.search.includes("error")),
    page.locator('form button[type="submit"]').click(),
  ]);
}

test("every demo role signs in and lands on its own page", async ({ page }) => {
  // p6: "a presenter can choose any role and reach its correct landing page in
  // two actions." Six roles, six homes, and none of them a 404.
  for (const who of Object.keys(ACCOUNTS) as (keyof typeof ACCOUNTS)[]) {
    await signIn(page, who);
    await expect(page, `${who} did not land correctly`).toHaveURL(ACCOUNTS[who].landing);
    await expect(page.locator("main")).toBeVisible();
  }
});

test("the role dropdown grants nothing — clinician credentials with Demo Admin selected fail", async ({ page }) => {
  // p8's first required negative test, and the one the whole dropdown design
  // turns on. The answer must be the SAME generic failure as any other invalid
  // pairing: a distinct message would make the dropdown an oracle for which
  // role an address holds, and the addresses are published in docs/demo.
  await signIn(page, "clinician", "demo_admin");
  await expect(page).toHaveURL(/\/login\?error=1/);
  await expect(page.locator("main")).toContainText(/didn't match/i);

  // And the failure is indistinguishable from a wrong password.
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.locator('input[name="email"]').fill(ACCOUNTS.clinician.email);
  await page.locator('input[name="password"]').fill("not-the-password");
  await Promise.all([
    page.waitForURL(/error=/),
    page.locator('form button[type="submit"]').click(),
  ]);
  await expect(page).toHaveURL(/\/login\?error=1/);
});

test("selecting the right role still signs in", async ({ page }) => {
  // The other half of the same rule. A selector that only ever fails would be
  // a working guard and a broken feature.
  await signIn(page, "payer", "payer");
  await expect(page).toHaveURL(/\/payer\/overview/);
});

test("an aggregate role cannot reach a person, by any route", async ({ page }) => {
  // p6: an organization "cannot see payer-wide data"; a payer "cannot see
  // patient-level clinical records or person search". §30.6 of handoff 06:
  // aggregate access never becomes person-level care access.
  for (const who of ["organization", "payer"] as const) {
    await signIn(page, who);
    for (const route of ["/clinician/today", "/clinician/caseload", "/clinician/patients", "/app/today"]) {
      await page.goto(route);
      await expect(page, `${who} reached ${route}`).not.toHaveURL(new RegExp(route.replace(/\//g, "\\/") + "$"));
    }
  }
});

test("the two aggregate consoles cannot read each other", async ({ page }) => {
  // The boundary that did not exist while one `admin` role served both. A
  // payer account on /organization/* and an organization account on /payer/*
  // must both be refused — not merely un-linked.
  await signIn(page, "payer");
  await page.goto("/organization/overview");
  await expect(page, "a payer account read the organization console").not.toHaveURL(/\/organization\//);

  await signIn(page, "organization");
  await page.goto("/payer/overview");
  await expect(page, "an organization account read the payer console").not.toHaveURL(/\/payer\//);
});

test("a patient cannot change person_id in a URL and learn whether another subject exists", async ({ page }) => {
  // p8's third required negative test. The rule is about EXISTENCE, not
  // permission: a forbidden record must answer the same way as one that was
  // never there, or the URL bar becomes a directory of who is enrolled.
  await signIn(page, "patient");
  const real = "/clinician/member/00000000-0000-4000-8000-000000000001";
  const fake = "/clinician/member/00000000-0000-4000-8000-000000000002";

  // The final URL, not the status. A Next redirect answers 200 at the end of
  // the chain, so a status comparison would pass on a server that happily
  // served both records.
  await page.goto(real);
  const afterReal = new URL(page.url()).pathname;
  await page.goto(fake);
  const afterFake = new URL(page.url()).pathname;

  expect(afterReal, "a member reached a clinical record").not.toContain("/clinician/member/");
  expect(afterFake, "the two ids answered differently — the URL bar is now a directory of who exists")
    .toBe(afterReal);
});

test("a role switch keeps nothing from the previous role", async ({ page }) => {
  // p8's fourth. p7: "clear all session state when the presenter switches
  // roles." The risk is not the next page — it is a cached fragment of the
  // previous role's data surviving into a screen that must not show it.
  await signIn(page, "clinician");
  await page.goto("/clinician/caseload");
  const caseload = await page.locator("main").innerText();
  const names = caseload.match(/(Alex Rivera|Sam Okafor)/g) ?? [];
  expect(names.length, "the caseload showed no member to check against").toBeGreaterThan(0);

  await signIn(page, "payer");
  for (const route of ["/payer/overview", "/payer/outcomes", "/payer/engagement"]) {
    await page.goto(route);
    const text = await page.locator("main").innerText();
    for (const n of new Set(names)) {
      expect(text, `${route} still shows "${n}" after a role switch`).not.toContain(n);
    }
  }
});

test("the reviewer console replays the real gate engine, and says so", async ({ page }) => {
  // p3 prohibits "a separate relaxed demo safety path" and p54 blocks release
  // on one. The check has to be visible in the environment being demonstrated,
  // not only in a test report.
  await signIn(page, "reviewer");
  await expect(page).toHaveURL(/\/review\/safety/);
  const main = page.locator("main");
  await expect(main).toContainText(/scenarios match the expected result/i);
  // Every scenario carries expected AND actual — a screen showing only the
  // outcome proves nothing about what was expected.
  await expect(main).toContainText("Expected");
  await expect(main).toContainText("Actual");
  // Pass and fail are words, not only colours (§29.1 accessibility).
  await expect(main).toContainText(/matches/);
  // No scenario is failing on this build.
  await expect(main).not.toContainText(/does not match/);
});

test("demo administration says how far it reaches, and where it must not", async ({ page }) => {
  await signIn(page, "demo_admin");
  await expect(page).toHaveURL(/\/admin\/demo/);
  const main = page.locator("main");
  // p6's warning is on the screen, not in a comment: the breadth is safe here
  // and must never be carried into production.
  await expect(main).toContainText(/purpose-limited permissions and break-glass access/i);
  await expect(main).toContainText(/never be carried/i);
  // Controls that do not exist are named as sentences, not rendered as
  // disabled buttons a presenter might click mid-demonstration.
  await expect(main).toContainText(/Controls that are not built/i);
  await expect(main.locator("button[disabled]")).toHaveCount(0);
});

test("no demo password appears on any public page", async ({ page }) => {
  // The addresses and passwords live in docs/demo/demo-logins.md. A public,
  // unauthenticated page that carries them is a credential leak whatever the
  // environment.
  const PASSWORDS = /patient1234|clinician1234|reviewer1234|org1234|payer1234|demoadmin1234/;
  for (const route of ["/", "/login", "/request-review", "/trust", "/platform"]) {
    await page.goto(route);
    expect(await page.content(), `${route} contains a demo password`).not.toMatch(PASSWORDS);
  }
});
