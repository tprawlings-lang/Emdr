import { test, expect } from "@playwright/test";

// The planning console in a browser (handoff 07 §3.5 p35, §4.5 p44, §5.4 p49,
// §6.1 p52).
//
// The unit guards prove the rules, the state machine and the action set. What
// only a browser can prove is the part p49 is actually about: that the buttons
// on the page are the server's list, that posting an action the page did not
// offer is refused, and that a role without planning authority is told the
// console is closed rather than shown an empty one.

test.skip(
  Boolean(process.env.E2E_BASE_URL),
  "authenticated flow runs only against the hermetic seeded server",
);

type Page = import("@playwright/test").Page;

const ACCOUNTS = {
  reviewer: { email: "reviewer.demo@steady.local", password: "reviewer1234" },
  payer:    { email: "payer.demo@steady.local",    password: "payer1234" },
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

const REQUIRED_PHRASE =
  "This is a planning hypothesis based on the stated cohort and data window. It is not a " +
  "diagnosis, treatment order or proof that the observed factor caused the result.";

test("the planning list shows what fired and every rule that did not", async ({ page }) => {
  await signIn(page, "reviewer");
  await page.goto("/review/planning");
  const main = page.locator("main");

  await expect(main).toContainText(REQUIRED_PHRASE);
  // p34's seven rules are all named, whether or not they produced anything —
  // a console listing only what fired makes "no signal" and "the rule could
  // not run" look identical.
  for (const id of [
    "ACCESS_GAP", "FOLLOWUP_GAP", "MODULE_SIGNAL", "REGION_CAPACITY",
    "FAIRNESS_ALERT", "SAFETY_REVIEW_LOAD", "DATA_QUALITY",
  ]) {
    await expect(main).toContainText(id);
  }
  // Four of the seven produce output on this deployment, and each names its
  // recommended action rather than an instruction.
  await expect(main).toContainText(/Operational capacity review/);
  await expect(main).toContainText(/Coverage and workflow review/);
  await expect(main).toContainText(/Human fairness review/);

  // And every rule that produced nothing says p34's reason. REGION_CAPACITY
  // both FIRES and withholds — on a strained region and on one whose slot feed
  // froze — and the screen has to show both halves. It showed only the firing
  // once, and the stale-feed finding was invisible on the screen built to
  // surface it.
  await expect(main).toContainText(/days old, past the/);
  await expect(main).toContainText(/confidence interval crosses zero/);
  await expect(main).toContainText(/below the minimum analysis size/);
});

test("the detail screen carries p44's sections, and the blocked actions", async ({ page }) => {
  await signIn(page, "reviewer");
  await page.goto("/review/planning");
  await page.locator('main a[href^="/review/planning/sig-"]').first().click();
  await page.waitForURL(/\/review\/planning\/sig-/);
  const main = page.locator("main");

  // p44's nine sections, by heading.
  for (const section of [
    "Statement", "Why it fired", "Population", "Evidence",
    "Alternative explanations", "Fairness", "Allowed next actions",
    "Blocked actions", "Audit",
  ]) {
    await expect(main.getByRole("heading", { name: section, exact: true })).toBeVisible();
  }
  await expect(main).toContainText(REQUIRED_PHRASE);

  // p44's blocked-actions row, named on the page rather than merely enforced
  // on the server: a reader should be able to see that the three were
  // considered and refused.
  for (const b of ["route_person", "change_gate", "deny_access"]) {
    await expect(main).toContainText(b);
  }
  // Level 1 wording — the statement itself opens with p36's permitted phrase.
  await expect(main).toContainText("Observed among this cohort");
});

test("the server refuses an action the page did not offer, and a blocked one", async ({ page }) => {
  await signIn(page, "reviewer");
  await page.goto("/review/planning");
  const href = await page.locator('main a[href^="/review/planning/sig-"]').first().getAttribute("href");
  const id = String(href).split("/").pop();

  // In-page fetch, so the session cookie travels. `page.request` does not
  // carry it, which once made every API assertion in this suite read the
  // login page at status 200.
  const post = (action: string) =>
    page.evaluate(async ([sid, act]) => {
      const r = await fetch(`/api/planning/signals/${sid}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: act }),
      });
      return { status: r.status, body: await r.text() };
    }, [id, action] as const);

  // p49: the client never invents or widens the action set. `approve` is a
  // real action — it is simply not an exit from this signal's state — and the
  // server re-derives that rather than trusting what the page was given.
  const notOffered = await post("approve");
  expect(notOffered.status).toBe(409);

  // A blocked action gets its own status, because "not from this state" and
  // "this system does not route people" are different answers.
  const blocked = await post("route_person");
  expect(blocked.status).toBe(403);
  expect(blocked.body).toContain("route_person");
});

test("the lineage endpoint returns definitions and no person", async ({ page }) => {
  await signIn(page, "reviewer");
  await page.goto("/review/planning");
  const href = await page.locator('main a[href^="/review/planning/sig-"]').first().getAttribute("href");
  const id = String(href).split("/").pop();

  const lineage = await page.evaluate(async (sid) => {
    const r = await fetch(`/api/planning/signals/${sid}/lineage`);
    return { status: r.status, body: await r.text() };
  }, id);

  expect(lineage.status).toBe(200);
  expect(lineage.body).toContain("required_phrase");
  expect(lineage.body).toContain("filters");
  for (const banned of ["person_id", "display_name", "@steady.local"]) {
    expect(lineage.body).not.toContain(banned);
  }
});

test("a payer is told the console is closed, not shown an empty one", async ({ page }) => {
  await signIn(page, "payer");
  await page.goto("/review/planning");
  // The review console admits reviewer, clinician and demo admin. A payer is
  // redirected out of it entirely, which is the stronger answer.
  await expect(page).not.toHaveURL(/\/review\/planning/);

  // And the API answers without content rather than with somebody else's.
  const listed = await page.evaluate(async () => {
    const r = await fetch("/api/planning/signals");
    return { status: r.status, body: await r.text() };
  });
  expect(listed.status).toBe(200);
  expect(JSON.parse(listed.body).signals).toEqual([]);
});
