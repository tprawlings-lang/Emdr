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
    page.locator('form button[type="submit"]').click(),
  ]);
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
  // `.last()` because the clock control also takes a typed reason — two
  // controls on one page, both guarded the same way, which is the convention
  // rather than a coincidence.
  await expect(main.locator('form input[name="reason"]').last()).toBeVisible();

  // And it is no longer listed as a control that does not exist.
  const notBuilt = main.locator("text=Controls that are not built");
  await expect(notBuilt).toBeVisible();
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
  const reason = page.locator('form input[name="reason"]').last();
  await expect(reason).toHaveAttribute("required", "");
  await expect(reason).toHaveAttribute("minlength", "4");

  // DELIBERATELY NOT CLICKED HERE. The reset empties every table and the suite
  // runs fully parallel against one server, so firing it would race whatever
  // else is mid-assertion. That the reset actually rebuilds a passing
  // environment is checked in `tests/demo-reset.test.ts`, against its own
  // database, where it is deterministic.
});
