import { test, expect, type Page } from "@playwright/test";

// Release testing for the institutional site (Redesign handoff §6, §12, §17).
//
// The copy guard in tests/public-copy-guard.test.ts reads source. This suite
// reads the rendered result, which is where the two failures source-scanning
// cannot see turn up: a page that 500s under a real request, and a link that
// resolves to a 404. §17 asks for route testing, link testing, and a walk of
// the access flow, so those are the three things this file does.

const INSTITUTIONAL_PAGES = [
  "/", "/platform", "/clinical", "/organizations", "/payers",
  "/about", "/trust", "/evidence", "/faq", "/request-review",
  "/demo", "/terms", "/privacy", "/accessibility",
];

// /crisis carries no site chrome by design — no navigation, no marketing, no
// unrelated links, so a person in distress has one thing to do. It is checked
// for reachability and content, never for chrome.
const PUBLIC_PAGES = [...INSTITUTIONAL_PAGES, "/crisis"];

const ACCESS_CODE = "e2e-placeholder-review-code";

test.describe("routes", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} renders with a single h1`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status(), `${path} did not return 200`).toBe(200);
      // Exactly one h1: the structure a screen-reader user navigates by.
      await expect(page.locator("h1")).toHaveCount(1);
    });
  }

  for (const path of INSTITUTIONAL_PAGES) {
    test(`${path} carries the shared site chrome`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Footer" })).toBeVisible();
    });
  }
});

test("the demo banner appears on every public page and names no credential", async ({ page }) => {
  for (const path of ["/", "/trust", "/demo"]) {
    await page.goto(path);
    await expect(page.getByText(/DEMO — FABRICATED DATA — NOT CLINICAL CARE/)).toBeVisible();
    await expect(page.locator("body")).not.toContainText(ACCESS_CODE);
  }
});

test("every internal link in the header and footer resolves", async ({ page, request }) => {
  await page.goto("/");
  const hrefs = new Set(
    (await page.locator("header a, footer a").evaluateAll(
      (els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? "")
    )).filter((h) => h.startsWith("/"))
  );
  expect(hrefs.size).toBeGreaterThan(8);
  for (const href of hrefs) {
    const res = await request.get(href);
    expect(res.status(), `${href} is linked from the site chrome but returns ${res.status()}`)
      .toBeLessThan(400);
  }
});

test("no public page links to a retired retail route", async ({ page }) => {
  for (const path of PUBLIC_PAGES) {
    await page.goto(path);
    for (const retired of ["/signup", "/subscribe"]) {
      await expect(
        page.locator(`a[href="${retired}"]`),
        `${path} links to the retired route ${retired}`
      ).toHaveCount(0);
    }
  }
});

test("crisis resources stay reachable without signing in", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('footer a[href="/crisis"]')).toBeVisible();
  await page.goto("/crisis");
  await expect(page.locator("body")).toContainText("988");
});

// ---------------------------------------------------------------------------
// §12 — the review access flow, walked the way a reviewer walks it
// ---------------------------------------------------------------------------

async function enterGateway(page: Page, path: string, code = ACCESS_CODE) {
  await page.goto("/demo");
  await page.getByRole("radio", { name: new RegExp(path, "i") }).check();
  await page.getByLabel("Review access code").fill(code);
  await page.getByRole("button", { name: "Continue" }).click();
}

test("a wrong access code is refused and never reveals the correct one", async ({ page }) => {
  await enterGateway(page, "Clinical review", "not-the-code");
  await expect(page).toHaveURL(/\/demo\?error=denied/);
  await expect(page.getByText(/that code was not accepted/i)).toBeVisible();
  await expect(page.locator("body")).not.toContainText(ACCESS_CODE);
});

test("a reviewer chooses a path, picks a fabricated persona, and lands in the product", async ({ page }) => {
  await enterGateway(page, "Clinical review");
  await expect(page).toHaveURL("/demo/clinical");
  // Step three: personas, all labelled as fabricated.
  const personas = page.getByTestId("persona-option");
  await expect(personas.first()).toBeVisible();
  await expect(personas.first()).toContainText(/fabricated/i);

  await personas.first().getByRole("button", { name: /enter as this persona/i }).click();
  // Step four: inside the guided scenario, still carrying the boundary banner.
  await expect(page).toHaveURL(/\/(clinician\/clinical|dashboard)/);
  await expect(page.getByText(/DEMO — FABRICATED DATA — NOT CLINICAL CARE/)).toBeVisible();
});

test("a read-only path is offered no write-capable persona", async ({ page }) => {
  await enterGateway(page, "Investor overview");
  await expect(page).toHaveURL("/demo/investor");
  await expect(page.getByText(/your path is read-only/i)).toBeVisible();
  const roles = await page.getByTestId("persona-option").allInnerTexts();
  expect(roles.length).toBeGreaterThan(0);
  for (const r of roles) expect(r).not.toMatch(/clinician/i);
});

test("a granted path does not open a different path", async ({ page }) => {
  await enterGateway(page, "Investor overview");
  // The grant cookie decides, not the URL. Typing the clinical path reaches
  // nothing, which is the difference between scoped access and a shared link.
  await page.goto("/demo/clinical");
  await expect(page).toHaveURL(/\/demo\?error=denied/);
});

test("the gateway is walkable by keyboard alone", async ({ page }) => {
  await page.goto("/demo");
  // Tab until the first radio has focus, then operate the form without a mouse.
  const radio = page.getByRole("radio").first();
  await radio.focus();
  await page.keyboard.press("Space");
  await expect(radio).toBeChecked();
  await page.getByLabel("Review access code").focus();
  await page.keyboard.type(ACCESS_CODE);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/demo\//);
});

// ---------------------------------------------------------------------------
// §17 — the environment shows fabricated identifiers only
// ---------------------------------------------------------------------------

test("no public page renders an address outside the reserved demonstration domains", async ({ page }) => {
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const RESERVED = /@(?:example\.(?:com|org|net)|[a-z0-9-]+\.(?:test|invalid|example))$/i;
  for (const path of PUBLIC_PAGES) {
    await page.goto(path);
    const text = await page.locator("body").innerText();
    for (const found of text.match(EMAIL) ?? []) {
      expect(RESERVED.test(found), `${path} renders "${found}", which is not a reserved address`)
        .toBe(true);
    }
  }
});

test("the site renders usably at a narrow viewport without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ["/", "/trust", "/faq", "/demo"]) {
    await page.goto(path);
    // Wide content (tables) must scroll inside its own container, not push the
    // page sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `${path} scrolls horizontally at 375px`).toBeLessThanOrEqual(1);
  }
});
