import { test, expect, devices } from "@playwright/test";

// Can a person actually PRESS Continue, on the device they have?
//
// THE REPORT THIS EXISTS FOR was "I can't even hit the button" from an iPad,
// against a build whose every login test was green. They were all green
// because every one of them drives the form with a MOUSE CLICK from a desktop
// profile, and a mouse click is not the thing that failed. Three ways the
// button can be dead to a real visitor, none of them visible to `click()`:
//
//   1. Something is painted over it. `click()` is Playwright's, not the
//      browser's — it scrolls, waits for actionability and dispatches. A
//      banner or sticky footer covering the button changes nothing about
//      whether that call passes.
//   2. Nothing dispatches a touch at all. A pointer-events or overlay problem
//      that only shows up under `hasTouch` is invisible to a profile that has
//      no touch.
//   3. The page never hydrated — a slow link, Lockdown Mode, a content
//      blocker — and the form has no non-JS path. Then Continue is a button
//      that genuinely does nothing, and the server sees no request to log.
//
// So this drives it the way the report describes: a touch device, a real tap,
// and once with JavaScript switched off entirely. It is about the CONTROL, not
// about authorization — demo-roles.spec.ts owns what each role may then see.

test.skip(
  Boolean(process.env.E2E_BASE_URL),
  "authenticated flow runs only against the hermetic seeded server",
);

// All seven seeded accounts, including the second clinician, which no other
// spec signs in as — a caseload boundary is demonstrated by switching between
// the two, so a presenter meets this login too.
const ACCOUNTS = [
  { email: "patient.demo@steady.local",    password: "patient1234",   role: "member",       landing: /\/app\/today/ },
  { email: "clinician.demo@steady.local",  password: "clinician1234", role: "clinician",    landing: /\/clinician\/today/ },
  { email: "clinician2.demo@steady.local", password: "clinician1234", role: "clinician",    landing: /\/clinician\/today/ },
  { email: "reviewer.demo@steady.local",   password: "reviewer1234",  role: "reviewer",     landing: /\/review\/safety/ },
  { email: "org.demo@steady.local",        password: "org1234",       role: "organization", landing: /\/organization\/overview/ },
  { email: "payer.demo@steady.local",      password: "payer1234",     role: "payer",        landing: /\/payer\/overview/ },
  { email: "admin.demo@steady.local",      password: "demoadmin1234", role: "demo_admin",   landing: /\/admin\/demo/ },
] as const;

const TOUCH = { ...devices["iPad (gen 7)"], hasTouch: true };

test("every demo account signs in by touch, on a touch device", async ({ browser, baseURL }) => {
  // `baseURL` is passed through explicitly: a context built here does NOT
  // inherit the one in `use`, and a relative goto in it fails as an invalid
  // URL rather than as a missing server.
  const context = await browser.newContext({ ...TOUCH, baseURL });
  try {
    for (const account of ACCOUNTS) {
      const page = await context.newPage();
      await page.goto("/login");
      await page.waitForLoadState("networkidle");

      // The role dropdown is selected to MATCH, because a presenter picking
      // the role they are demonstrating is the normal path and it must
      // succeed. The mismatch case is demo-roles.spec.ts's, and it is a
      // refusal rather than a dead control.
      await page.locator('select[name="role"]').selectOption(account.role);
      await page.locator('input[name="email"]').fill(account.email);
      await page.locator('input[name="password"]').fill(account.password);

      const button = page.locator('form button[type="submit"]');
      await button.scrollIntoViewIfNeeded();

      // `tap()`, not `click()`. On a `hasTouch` context this dispatches the
      // touch sequence a finger produces, which is the input the report was
      // about.
      await Promise.all([
        page.waitForURL((u) => !u.pathname.startsWith("/login") || u.search.includes("error")),
        button.tap(),
      ]);

      await expect(page, `${account.email} did not land after a tap`).toHaveURL(account.landing);
      await page.close();
    }
  } finally {
    await context.close();
  }
});

test("the button receives the press itself — nothing is painted over it", async ({ browser, baseURL }) => {
  // Asked of the BROWSER rather than of Playwright. `tap()` and `click()` both
  // succeed against a covered button; `elementFromPoint` is the same
  // calculation the browser performs when a finger lands, so it is the one
  // that answers whether the press reaches the control.
  const context = await browser.newContext({ ...TOUCH, baseURL });
  try {
    const page = await context.newPage();
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    const button = page.locator('form button[type="submit"]');
    await button.scrollIntoViewIfNeeded();

    const box = await button.boundingBox();
    expect(box, "the submit button has no box at all").not.toBeNull();

    // Four corners inset from the edge, and the centre. One point at the
    // middle would miss a bar overlapping the lower half — which is exactly
    // the shape a keyboard accessory or a sticky footer has.
    const points: [number, number, string][] = [
      [box!.x + box!.width / 2, box!.y + box!.height / 2, "centre"],
      [box!.x + 8, box!.y + 8, "top-left"],
      [box!.x + box!.width - 8, box!.y + 8, "top-right"],
      [box!.x + 8, box!.y + box!.height - 8, "bottom-left"],
      [box!.x + box!.width - 8, box!.y + box!.height - 8, "bottom-right"],
    ];
    for (const [x, y, where] of points) {
      const hit = await page.evaluate(([px, py]) => {
        const el = document.elementFromPoint(px as number, py as number);
        return el ? { tag: el.tagName, type: el.getAttribute("type"), text: (el.textContent ?? "").trim().slice(0, 40) } : null;
      }, [x, y]);
      expect(hit, `nothing is at the button's ${where}`).not.toBeNull();
      expect(
        hit!.tag === "BUTTON" && hit!.type === "submit",
        `the button's ${where} is covered by <${hit!.tag}> "${hit!.text}"`,
      ).toBe(true);
    }

    // A control that cannot be pressed accurately is a control that reads as
    // broken. 44px is the platform's own minimum on the device that reported
    // this.
    expect(box!.height, "the submit button is under the 44px touch minimum").toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);

    // And it is never handed to a visitor already inert.
    await expect(button).toBeEnabled();
  } finally {
    await context.close();
  }
});

test("Continue works with JavaScript switched off", async ({ browser, baseURL }) => {
  // THE ONLY WAY THE BUTTON IS TRULY DEAD. If the form ever depends on
  // hydration to submit, a device that failed to run the bundle gets a control
  // that does nothing at all — no error, no request, nothing to find in a log.
  // The server action renders a real `method="POST"` form with its action id
  // in a hidden field, and this is the test that says so, because that is a
  // framework behaviour rather than something written here.
  const context = await browser.newContext({ ...TOUCH, baseURL, javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto("/login");

    // Stated about the markup as well as the outcome, so a regression is
    // legible: a form with no method has no non-JS path even if some other
    // route happened to answer.
    const form = page.locator("form", { has: page.locator('input[name="password"]') });
    await expect(form, "the sign-in form declares no POST method").toHaveAttribute("method", /post/i);

    await page.locator('input[name="email"]').fill("clinician.demo@steady.local");
    await page.locator('input[name="password"]').fill("clinician1234");
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith("/login")),
      page.locator('form button[type="submit"]').click(),
    ]);
    await expect(page, "signing in without JavaScript went nowhere").toHaveURL(/\/clinician\/today/);
  } finally {
    await context.close();
  }
});

test("a refused sign-in says the Demo role has to match", async ({ page }) => {
  // The screen a presenter meets after the likeliest mistake. Picking "Demo
  // Admin" while signing in as a clinician is a reasonable reading of "which
  // demo am I giving", and it refuses — correctly, and by design silently
  // about WHY.
  //
  // The clause below is what makes that survivable, and it is asserted on the
  // WRONG-PASSWORD failure deliberately: it has to appear where the dropdown
  // was never touched, or it is an oracle for which role an address holds.
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.locator('input[name="email"]').fill("clinician.demo@steady.local");
  await page.locator('input[name="password"]').fill("not-the-password");
  await Promise.all([
    page.waitForURL(/error=/),
    page.locator('form button[type="submit"]').click(),
  ]);
  const banner = page.locator("main p").filter({ hasText: /didn't match/ });
  await expect(banner).toContainText(/Demo role/i);
  await expect(banner).toContainText(/Any role/i);

  // And it is on screen without hunting for it — a message the visitor has to
  // scroll to find is why "nothing happened" is a reasonable thing to report.
  await expect(banner).toBeInViewport();
});
