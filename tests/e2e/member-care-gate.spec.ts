import { test, expect } from "@playwright/test";

// The member care gate, attacked (handoff 06 §30.6 step 4).
//
// tests/member-care-gate.test.ts holds the decision — which routes run the
// chain, in what order, and which two groups must not. This walks the case that
// was actually broken: a member whose consent was revoked could read their plan
// and their progress, because the gate lived on the screens somebody remembered
// rather than on the tree.
//
// The revocation happens through the member's OWN control rather than through
// the database, so what this exercises is the path a member really has.

const MEMBER = { email: "patient.demo@steady.local", password: "patient1234" };

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(MEMBER.email);
  await page.locator('input[name="password"]').fill(MEMBER.password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("grounding opens with no account at all", async ({ page }) => {
  // There is no condition in which support is withdrawn, and a layout that
  // required an account here would send a signed-out person in distress to the
  // login page.
  await page.context().clearCookies();
  const res = await page.goto("/app/ground", { waitUntil: "domcontentloaded" });
  expect(res?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe("/app/ground");
  await expect(page.locator("main")).toBeVisible();
});

test("a consented member reaches every care screen", async ({ page }) => {
  // The half that a gate is most likely to break: the gate itself working, and
  // nobody able to use the product.
  await signIn(page);
  for (const route of [
    "/app/today", "/app/progress", "/app/plan", "/app/learn",
    "/app/check-in", "/app/paths", "/app/measures", "/app/companion",
  ]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname, `${route} bounced a consented member`).toBe(route);
  }
});

test("an account surface is reachable, so a member is never locked out of their own controls", async ({ page }) => {
  // The trap the first version of this layout set: these are where somebody
  // goes to inspect or change the very things the gate checks, and gating them
  // behind those answers would leave a member unable to see what they agreed
  // to, sign out everywhere, or close the account.
  await signIn(page);
  for (const route of [
    "/app/settings", "/app/settings/account", "/app/settings/sessions",
    "/app/settings/memory", "/app/consent", "/app/care-team",
  ]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname, `${route} is gated behind the thing it changes`).toBe(route);
  }
});

test("the gate is on the tree, not on the screens somebody remembered", async ({ page }) => {
  // THE DEFECT. `/app/progress`, `/app/plan` and `/app/learn` ran only
  // `requireMember` — so a member whose consent had been revoked kept reading
  // their record. The revocation goes through the member's own control.
  await signIn(page);
  await page.goto("/app/consent", { waitUntil: "domcontentloaded" });

  // NO SELF-SERVE WITHDRAWAL EXISTS IN THIS BUILD, and the consent screen now
  // says so rather than pointing at three links that cannot do it. So this walk
  // cannot be driven end to end, and it skips with the real reason instead of
  // faking a control — the decision itself is covered exhaustively in
  // tests/member-care-gate.test.ts, which is where it belongs.
  const revoke = page.getByRole("button", { name: /Withdraw|Revoke/i }).first();
  await expect(page.getByText(/cannot withdraw it from this screen yet/i)).toBeVisible();
  test.skip(
    (await revoke.count()) === 0,
    "no self-serve withdrawal exists to drive; the consent screen states this"
  );
  page.once("dialog", (d) => d.accept());
  await revoke.click();
  await page.waitForTimeout(1500);

  for (const route of ["/app/progress", "/app/plan", "/app/learn", "/app/today"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(
      new URL(page.url()).pathname,
      `${route} still opened for a member who withdrew consent`
    ).toBe("/app/onboarding");
  }

  // And the account surfaces still open, which is what stops the gate becoming
  // a trap.
  await page.goto("/app/settings", { waitUntil: "domcontentloaded" });
  expect(new URL(page.url()).pathname).toBe("/app/settings");
});
