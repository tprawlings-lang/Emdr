import { test, expect } from "@playwright/test";

// p9's Reset control in a browser.
//
// WHY IT EXISTS. The admin console already blocks external demonstrations when
// the data-quality manifest fails, and until this control was built it did that
// and offered nothing to do about it — leaving a shell on the instance as the
// only remedy, which is exactly the direct row access p29 forbids. A deployed
// instance was found in that state: 240 profiles, no history, and no way to
// repair it from the page that refused to demonstrate.
//
// NOTHING HERE FIRES THE RESET. It empties every table, and this suite runs
// fully parallel against a single server, so a reset fired mid-run would pull
// the dataset out from under whatever else is mid-assertion. The rebuild is
// checked where it is deterministic — `tests/demo-reset.test.ts`, against its
// own database.

test.skip(
  Boolean(process.env.E2E_BASE_URL),
  "destructive control runs only against the hermetic seeded server",
);

type Page = import("@playwright/test").Page;

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login")),
    page.locator('form:has(input[name="password"]) button[type="submit"]').click(),
  ]);
}

/**
 * The reset form, found BY ITS OWN BUTTON.
 *
 * This used to be `page.locator('form input[name="reason"]').last()`, which
 * meant "the reset form" only for as long as the reset form happened to be the
 * last one on the page. Three controls were then built below it — a data
 * scenario, a QA export, each with its own reason field — and the assertion
 * silently moved to somebody else's form and failed on a minlength that was
 * correct for the control it had drifted onto.
 *
 * A positional selector is a guess about layout. Naming the submit button is a
 * statement about which control is meant, and it survives the page growing.
 */
function resetForm(page: Page) {
  return page.locator('form:has(button:text("Reset the dataset"))');
}

test("the reset control is on the page that refuses to demonstrate", async ({ page }) => {
  await signIn(page, "admin.demo@steady.local", "demoadmin1234");
  await page.goto("/admin/demo");
  const main = page.locator("main");

  // The control, and p9's guard on it, on the same screen as the verdict it
  // answers. A page that says "this dataset is not fit to demonstrate" and
  // offers no remedy sends the presenter to a database client.
  await expect(main).toContainText(/Reset dataset/);
  await expect(main).toContainText(/must never repair the demo by editing database rows/);
  await expect(resetForm(page).locator('input[name="reason"]')).toBeVisible();

  // And the console still keeps a place for what it lacks. The heading changes
  // when the list empties — a panel titled "controls that are not built" over
  // nothing is a screen contradicting itself — so this matches either wording
  // rather than pinning the one that happened to be true the day it was
  // written.
  await expect(main).toContainText(/Controls that are not built|What is not on this screen/);
});

test("a reviewer cannot reach the reset control", async ({ page }) => {
  await signIn(page, "reviewer.demo@steady.local", "reviewer1234");
  const res = await page.goto("/admin/demo");
  // Either refused outright or redirected away — what must not happen is a
  // reviewer being shown a button that deletes the environment.
  const body = await page.locator("body").innerText();
  expect(
    (res?.status() ?? 0) >= 400 || !/Reset the dataset/.test(body),
    "a reviewer was shown the reset control",
  ).toBe(true);
});

test("the reset control states p9's guard, and does not fire without one", async ({ page }) => {
  await signIn(page, "admin.demo@steady.local", "demoadmin1234");
  await page.goto("/admin/demo");

  // p9's guard is a TYPED REASON, refused in the browser before the server is
  // asked — and again on the server, because a form is not a permission.
  const reason = resetForm(page).locator('input[name="reason"]');
  await expect(reason).toHaveAttribute("required", "");
  await expect(reason).toHaveAttribute("minlength", "4");

  // DELIBERATELY NOT CLICKED HERE. The reset empties every table and the suite
  // runs fully parallel against one server, so firing it would race whatever
  // else is mid-assertion. That the reset actually rebuilds a passing
  // environment is checked in `tests/demo-reset.test.ts`, against its own
  // database, where it is deterministic.
});
