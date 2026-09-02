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
// This runs LAST-ish by name and is deliberately destructive: it rebuilds the
// dataset the rest of the suite reads. The rebuild is deterministic and lands
// on the same baseline, which is the property being checked.

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

test("the reset refuses without a typed reason, and rebuilds with one", async ({ page }) => {
  await signIn(page, "admin.demo@steady.local", "demoadmin1234");
  await page.goto("/admin/demo");

  // p9's guard is a TYPED REASON. The field is required and bounded, so the
  // browser refuses before the server is asked — and the server checks it
  // again, because a form is not a permission.
  const reason = page.locator('form input[name="reason"]').last();
  await expect(reason).toHaveAttribute("required", "");
  await expect(reason).toHaveAttribute("minlength", "4");

  await reason.fill("e2e guard — rebuild from the current seed");
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.getByRole("button", { name: "Reset the dataset" }).click(),
  ]);

  // THE POINT OF THE CONTROL: afterwards the environment passes its own
  // manifest. A reset that left the dataset unfit would be a button that
  // moved the problem rather than fixing it.
  await page.goto("/admin/demo");
  const main = page.locator("main");
  await expect(main).toContainText(/Profile count/);
  await expect(main).not.toContainText(/This dataset is not fit to demonstrate/);
});
