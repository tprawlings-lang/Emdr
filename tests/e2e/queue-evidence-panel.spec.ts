import { test, expect } from "@playwright/test";

// UX 011, in the place the defect actually lived (handoff 09 §5, §8.6).
//
//   "The evidence drawer compresses queue rows and repeats actions. Define
//   responsive drawer or detail-view behavior. Acceptance: identity, action,
//   and keyboard focus remain clear."
//
// EVERY PART OF THIS WAS INVISIBLE TO THE UNIT SUITE. The class list read
// correctly while `order-first` sat on a container that was only flex at xl and
// was therefore ignored; the panel asserted that it named a focus-return target
// while no element in the document carried that id; and the id contains colons,
// so the lookup that was supposed to restore focus threw and was swallowed.
// Each one needed a browser and a ruler.

test.skip(Boolean(process.env.E2E_BASE_URL), "runs only against the hermetic seeded server");

async function signInAsClinician(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("clinician.demo@steady.local");
  await page.locator('input[name="password"]').fill("clinician1234");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/clinician/);
}

/** The width of the first queue row, which is what "compresses" is about. */
async function firstRowWidth(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const row = document.querySelector('[data-testid="queue-row"]');
    return row ? Math.round(row.getBoundingClientRect().width) : 0;
  });
}

test("opening the evidence panel does not squeeze the queue on a laptop", async ({ page }) => {
  // Measured before the fix: 678px → 262px at this width. A clinical work row
  // at 262px is not a row anybody can read.
  await page.setViewportSize({ width: 1024, height: 900 });
  await signInAsClinician(page);
  await page.goto("/clinician/today");

  const closed = await firstRowWidth(page);
  expect(closed).toBeGreaterThan(400);

  await page.locator('a[href*="row="]').first().click();
  await expect(page.getByTestId("queue-evidence-panel")).toBeVisible();

  const open = await firstRowWidth(page);
  expect(open, `a row went from ${closed}px to ${open}px when the panel opened`)
    .toBeGreaterThan(closed * 0.9);
});

test("on a phone the evidence appears where the reader is looking", async ({ page }) => {
  // Measured before the fix: the panel opened at y=3204 on an 844px screen, so
  // the visible screen did not change at all when the control was pressed.
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsClinician(page);
  await page.goto("/clinician/today");

  await page.locator('a[href*="row="]').first().click();
  const panel = page.getByTestId("queue-evidence-panel");
  await expect(panel).toBeVisible();

  const geometry = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="queue-evidence-panel"]')!.getBoundingClientRect();
    const r = document.querySelector('[data-testid="queue-row"]')!.getBoundingClientRect();
    return {
      panelTop: Math.round(p.top + window.scrollY),
      rowTop: Math.round(r.top + window.scrollY),
      viewport: window.innerHeight,
    };
  });
  expect(geometry.panelTop, "the panel opened below the fold, so pressing the control changed nothing visible")
    .toBeLessThan(geometry.viewport);
  expect(geometry.panelTop, "the panel is still behind the whole queue")
    .toBeLessThan(geometry.rowTop);
});

test("closing the panel puts the keyboard back on the control that opened it", async ({ page }) => {
  // §8.6: "return focus to the exact originating control." The panel has
  // asserted this was configured since Package 1 and focus landed on <body>.
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAsClinician(page);
  await page.goto("/clinician/today");

  const opener = page.locator('a[href*="row="]').first();
  const openerHref = await opener.getAttribute("href");
  await opener.click();
  await expect(page.getByTestId("queue-evidence-panel")).toBeVisible();

  await page.getByRole("link", { name: "Close the details" }).click();
  await expect(page.getByTestId("queue-evidence-panel")).toHaveCount(0);

  const focused = await page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? null,
    href: document.activeElement?.getAttribute?.("href") ?? null,
    isBody: document.activeElement === document.body,
  }));
  expect(focused.isBody, "focus fell back to <body>, so a keyboard reader lost their place in the queue")
    .toBe(false);
  expect(focused.tag).toBe("A");
  expect(focused.href).toBe(openerHref);
});

test("the fragment is cleaned up once it has done its job", async ({ page }) => {
  // A fragment left in the address bar re-focuses on reload, which is not what
  // a reader who has moved on expects.
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAsClinician(page);
  await page.goto("/clinician/today");
  await page.locator('a[href*="row="]').first().click();
  await page.getByRole("link", { name: "Close the details" }).click();
  await expect(page.getByTestId("queue-evidence-panel")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
});

test("the detail sits below the list on a laptop and above it on a phone", async ({ page }) => {
  // DECIDED 23 SEPTEMBER: below the list, matching every other work screen.
  // ABOVE ON A PHONE IS A MEASUREMENT, NOT A PREFERENCE. Stacking it under the
  // queue there was tried and measured at y=3204 on a 390x844 screen — 2,360px
  // below the fold — so a clinician tapped "why this is here" and the screen
  // appeared not to change. The decision was taken with that history in hand.
  await signInAsClinician(page);
  for (const [w, h, expectBelow] of [[1440, 900, true], [390, 844, false]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/clinician/today");
    await page.getByRole("link", { name: /why this is here/i }).first().click();
    await page.waitForLoadState("networkidle");

    const panel = page.locator('[data-testid="queue-evidence-panel"]');
    await expect(panel).toBeVisible();
    const list = page.locator("ul").filter({ has: page.locator('[id^="row-"]') }).first();

    const pBox = (await panel.boundingBox())!;
    const lBox = (await list.boundingBox())!;
    // Playwright's box is viewport-relative, so these compare positions on the
    // same scrolled page rather than in the document.
    const panelIsBelow = pBox.y > lBox.y;
    expect(panelIsBelow, `at ${w}px the panel is ${panelIsBelow ? "below" : "above"} the list`)
      .toBe(expectBelow);

    // AND IN VIEW WHEN IT OPENS, at both widths. A control that appears to do
    // nothing is worse than one that is merely far away — which is exactly
    // what "below the list" costs without the fragment that moves to it.
    expect(pBox.y, `at ${w}px the panel opened off the bottom of the screen`).toBeLessThan(h);
    expect(pBox.y + pBox.height, `at ${w}px the panel opened above the screen`).toBeGreaterThan(0);
  }
});
