import { test, expect } from "@playwright/test";

// The shared access states, as a visitor meets them (§26).
//
// The unit guards check the source. What only a browser can show is that these
// screens are actually SERVED — a not-found page that exists as a file but is
// not wired to Next's convention is a file, not a screen — and that the ones
// meant to reveal nothing reveal nothing once rendered.

test("a wrong address gets the product's own page, not the framework's", async ({ page }) => {
  const res = await page.goto("/definitely-not-a-real-page");
  expect(res?.status()).toBe(404);

  await expect(page.getByRole("heading", { name: "That page isn't here" })).toBeVisible();
  // The framework default this replaced.
  await expect(page.getByText("This page could not be found")).toHaveCount(0);
  // The demo boundary survives, per §26's role-level acceptance.
  await expect(page.getByText(/FABRICATED DATA/)).toBeVisible();
});

test("a missing page never echoes the address that was asked for", async ({ page }) => {
  // The specific leak: a 404 that prints the path back lets someone confirm
  // what they guessed, and read it out of a screenshot or a shared link.
  await page.goto("/secret-clinic-name/patient-12345");
  const body = (await page.locator("body").innerText()).toLowerCase();
  expect(body).not.toContain("secret-clinic-name");
  expect(body).not.toContain("patient-12345");
});

test("every access state renders and offers a route to crisis", async ({ page }) => {
  const SCREENS: Array<[string, RegExp]> = [
    ["/login", /Review sign in/],
    ["/verify", /Two-factor sign-in isn't set up here/],
    ["/reset", /Password reset isn't available here/],
    ["/invite/abc123", /Invitation links aren't set up yet/],
    ["/session-expired", /You were signed out/],
    ["/status/degraded", /working/],
  ];

  for (const [route, heading] of SCREENS) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    // §6: the way out is on the screen, not only in the global footer.
    await expect(
      page.locator('main a[href="/crisis"]'),
      `${route} offers no route to crisis support`,
    ).not.toHaveCount(0);
  }
});

test("the invitation screen does not put the token on the page", async ({ page }) => {
  await page.goto("/invite/tok_9f3ac1e5b7");
  // innerText, not the HTML source, and deliberately: Next embeds the
  // requested path in the RSC router-state payload on every page, so the raw
  // source contains it no matter what this page does. The token was in the URL
  // the browser sent and is already in history and the access log. What this
  // page controls is whether it is RENDERED — where it would reach a
  // screenshot, a shared screen or a shoulder.
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("tok_9f3ac1e5b7");
});

test("no unbuilt auth flow presents a control that implies it works", async ({ page }) => {
  for (const route of ["/verify", "/reset", "/invite/abc"]) {
    await page.goto(route);
    await expect(page.locator("main input"), `${route} shows an input`).toHaveCount(0);
    await expect(page.locator("main button"), `${route} shows a button`).toHaveCount(0);
  }
});

test("the status page reports measured state and never crisis as unavailable", async ({ page }) => {
  await page.goto("/status/degraded");

  // Grounding and crisis are listed first and marked always open.
  await expect(page.getByText("Grounding exercises")).toBeVisible();
  await expect(page.getByText("Crisis resources")).toBeVisible();
  await expect(page.getByText("always open").first()).toBeVisible();

  // Neither may ever carry a not-available state. The rows are ordered, so the
  // first two are the ones that must be available.
  const rows = page.locator("main li");
  for (const i of [0, 1]) {
    await expect(rows.nth(i)).toContainText("Available");
  }

  // And the page must state when it looked, rather than implying "now".
  await expect(page.getByText(/^checked \d{4}-\d{2}-\d{2}/)).toBeVisible();
});

test("an expired session is told apart from never having signed in", async ({ page, context }) => {
  // No cookie at all: the sign-in page.
  await page.goto("/app/today");
  await expect(page).toHaveURL(/\/login/);

  // A session cookie that no longer resolves: the expiry screen, which says
  // what happened to unsaved text. The value is deliberately junk — a forged
  // cookie and an expired one must be told the same thing.
  await context.addCookies([
    { name: "emdr_session", value: "not-a-valid-token", url: "http://127.0.0.1:3000" },
  ]);
  await page.goto("/app/today");
  await expect(page).toHaveURL(/\/session-expired/);
  await expect(page.getByText(/was not kept/)).toBeVisible();
});
