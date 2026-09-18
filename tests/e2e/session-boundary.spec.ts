import { test, expect } from "@playwright/test";

// FAILURE-INJECTION EVIDENCE for the failure register's
// `permissions.browser-back-restores-restricted-content` — see
// src/lib/governance/failure-register.ts.
//
// "Browser back restores restricted content → Test browser cache and session
// boundaries."
//
// ONLY A BROWSER CAN ANSWER THIS. Every other check in the suite asks what the
// server sends; this asks what the BROWSER KEPT. A person signs out on a shared
// computer, hands it back, and the next person presses the back arrow — and
// whether a clinical screen reappears is decided by a cache header and a
// history entry, not by any authorization code. A server that refuses the
// request perfectly is irrelevant if the page never leaves the machine.
//
// It passes today. That is worth having a test for rather than an assumption:
// the headers come from a framework default, and a default is one config change
// away from not being there.

test.skip(Boolean(process.env.E2E_BASE_URL), "runs only against the hermetic seeded server");

test("signing out and pressing back does not restore the clinical screen", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  const cacheHeaders: Record<string, string> = {};
  page.on("response", (r) => {
    const path = new URL(r.url()).pathname;
    if (/^\/clinician/.test(path) && !cacheHeaders[path]) {
      cacheHeaders[path] = r.headers()["cache-control"] ?? "(none)";
    }
  });

  await page.goto("/login");
  await page.locator('input[name="email"]').fill("clinician.demo@steady.local");
  await page.locator('input[name="password"]').fill("clinician1234");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/clinician/);
  await page.goto("/clinician/today");
  await expect(page.getByText(/Your attention queue/i).first()).toBeVisible();

  // THE HEADER IS THE MECHANISM, so it is asserted directly rather than
  // inferred from the behaviour below. A page that renders correctly today
  // because of a framework default is one config change from being stored.
  expect(
    cacheHeaders["/clinician/today"],
    `the clinical queue was served with cache-control "${cacheHeaders["/clinician/today"]}"`,
  ).toMatch(/no-store/);

  await page.getByRole("button", { name: /sign out/i }).first().click();
  await expect(page).toHaveURL(/\/(login|$)/, { timeout: 15000 });

  // THE INJECTION: the next person presses back.
  await page.goBack();
  await page.waitForLoadState("networkidle");

  const body = await page.locator("body").innerText();
  expect(body, "a clinical queue came back out of the browser's history after sign-out")
    .not.toMatch(/Your attention queue/i);
  expect(body, "a fabricated patient's name came back out of the browser's history after sign-out")
    .not.toMatch(/\(fabricated\)/);

  await context.close();
});
