import { test, expect } from "@playwright/test";

// The demo clock in a browser (handoff 07 §1.5, p9).
//
// The unit guards prove the clock moves the reading and cannot reach a
// governance record. What only a browser can prove is p9's second guard —
// "clock shown in shell" — and that the control is reachable by the role that
// owns it and by nobody else.

test.skip(
  Boolean(process.env.E2E_BASE_URL),
  "authenticated flow runs only against the hermetic seeded server",
);

type Page = import("@playwright/test").Page;

const ACCOUNTS = {
  admin:    { email: "admin.demo@steady.local",    password: "demoadmin1234" },
  reviewer: { email: "reviewer.demo@steady.local", password: "reviewer1234" },
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

async function setClock(page: Page, milestone: string, reason: string) {
  await page.goto("/admin/demo");
  await page.locator(`input[name="milestone"][value="${milestone}"]`).check();
  await page.locator('input[name="reason"]').fill(reason);
  await page.getByRole("button", { name: "Set the clock" }).click();
  await page.waitForLoadState("networkidle");
}

test.afterEach(async ({ page }) => {
  // Every test leaves the clock live. A suite that runs in any order cannot
  // have one test's clock decide another's population.
  await signIn(page, "admin");
  await setClock(page, "live", "e2e cleanup — return to live");
});

test("the shell shows nothing while the clock is live", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/admin/demo");
  // A live clock is the absence of a claim. A permanent "the date is today"
  // badge is noise that teaches people to stop reading the corner the
  // FABRICATED flag lives in.
  await expect(page.locator("header")).toContainText("Fabricated");
  await expect(page.locator("header")).not.toContainText("Clock:");
});

test("moving the clock shows it in the shell, on every console", async ({ page }) => {
  await signIn(page, "admin");
  await setClock(page, "half-year", "e2e — show the half-year view");

  // p9: "clock shown in shell". In the frame, so it survives a navigation to
  // a screen that knows nothing about the clock.
  await expect(page.locator("header")).toContainText(/Clock:/);
  await expect(page.locator("header")).toContainText(/Half year/);

  await page.goto("/review/planning");
  await expect(page.locator("header")).toContainText(/Clock:/);
});

test("the clock changes what the planning console reports", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/review/planning");
  const liveText = await page.locator("main").innerText();

  await setClock(page, "first-quarter", "e2e — read the first quarter");
  await page.goto("/review/planning");
  const earlyText = await page.locator("main").innerText();

  expect(earlyText).not.toEqual(liveText);
  // A signal read at a milestone says so, rather than sitting in the list
  // looking like today's.
  await expect(page.locator("main")).toContainText(/read at the first quarter/);
});

test("a reviewer cannot reach the clock control", async ({ page }) => {
  await signIn(page, "reviewer");
  await page.goto("/admin/demo");
  // p9's guard is the demo admin's. The reviewer is redirected out of the
  // console entirely rather than shown a form that will refuse them.
  await expect(page).not.toHaveURL(/\/admin\/demo/);
});

test("the clock refuses to move without a reason", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/admin/demo");
  await page.locator('input[name="milestone"][value="opening"]').check();
  // The field is required, so the browser refuses before the server has to.
  // Both halves matter: the server check is the one that holds, and this is
  // the one that stops a presenter losing their place mid-demonstration.
  const reason = page.locator('input[name="reason"]');
  await expect(reason).toHaveAttribute("required", "");
  await page.getByRole("button", { name: "Set the clock" }).click();
  await expect(page.locator("header")).not.toContainText("Clock:");
});
