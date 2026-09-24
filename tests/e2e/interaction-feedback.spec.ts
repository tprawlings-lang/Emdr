import { test, expect } from "@playwright/test";

// THE TWO THINGS THAT ANSWER A PRESS AND A TAB, measured in a browser because
// neither can be seen in the source.
//
// WHY THIS FILE EXISTS: both of these were silently wrong, and both looked
// right in the diff.
//
//   THE FOCUS RING FADED IN. A 2px indicator in the product's own ink was
//   added and it worked — 400ms after the element was focused. Tailwind's
//   `transition-colors` includes `outline-color`, and most interactive
//   elements here carry it, so the ring animated FROM the element's own text
//   colour. On a nav item that is olive on a pale rail, about 1.9:1. Anybody
//   tabbing at a normal speed never saw the ring at full contrast, which is
//   precisely the failure a focus indicator exists not to have. The source
//   read correctly the whole time.
//
//   THE PRESS RULE DID NOTHING. The first version paired `transform: scale()`
//   with a `transition` shorthand. The shorthand resets `transition-property`,
//   and on every button already carrying `transition-colors` the utility won
//   on specificity, so the rule was inert on most of the product.
//
// So these assert the rendered result at the moment it matters — at 0ms for
// the ring, and mid-press for the button — rather than the presence of a rule.

test.skip(Boolean(process.env.E2E_BASE_URL), "runs only against the hermetic seeded server");

const INK = "rgb(23, 58, 50)"; // --color-app-ink

async function signInAsClinician(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("clinician.demo@steady.local");
  await page.locator('input[name="password"]').fill("clinician1234");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/clinician/);
}

test("the focus ring is at full contrast the instant a control receives focus", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/clinician/today");
  await page.locator("main").waitFor({ state: "visible" });

  // Read immediately after each Tab, with no wait. A ring that is only correct
  // once a transition has finished is the defect this guards.
  const stops: Array<{ what: string; color: string; width: string }> = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        what: (el.textContent || el.tagName).trim().slice(0, 30),
        color: cs.outlineColor,
        width: cs.outlineWidth,
      };
    });
    if (stop) stops.push(stop);
  }

  expect(stops.length, "nothing took keyboard focus, so this proved nothing").toBeGreaterThan(8);
  const faded = stops.filter((s) => s.color !== INK || s.width !== "2px");
  expect(
    faded,
    "a control's focus ring was not at its full colour and width the moment it was focused — " +
    "check whether outline-color is being transitioned again"
  ).toEqual([]);
});

test("pressing a button is answered by the button, on pointer-down", async ({ page }) => {
  await signInAsClinician(page);
  await page.goto("/clinician/today");
  await page.locator("main").waitFor({ state: "visible" });

  const button = page.locator("main button").first();
  const box = await button.boundingBox();
  expect(box, "no button on the queue to press").toBeTruthy();

  const before = await button.evaluate((el) => getComputedStyle(el).transform);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  // Deliberately short: the feedback has to be there while the finger is down,
  // not once something settles.
  await page.waitForTimeout(50);
  const during = await button.evaluate((el) => getComputedStyle(el).transform);
  await page.mouse.up();

  expect(before, "a button is transformed before anybody touches it").toBe("none");
  expect(
    during,
    "pressing a button produced no visible response — every clinical command here is a " +
    "server round trip, so this is the one moment the screen is guaranteed to be busy"
  ).not.toBe("none");
});

test("a person who asked for less motion still gets an answer to the press", async ({ browser }) => {
  // REDUCED MOTION IS NOT NO FEEDBACK. It is the same confirmation without the
  // movement — the distinction the accessibility guidance makes and the one a
  // blanket `transform: none` would lose.
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await signInAsClinician(page);
  await page.goto("/clinician/today");
  await page.locator("main").waitFor({ state: "visible" });

  const button = page.locator("main button").first();
  const box = await button.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(50);
  const during = await button.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { transform: cs.transform, filter: cs.filter };
  });
  await page.mouse.up();
  await context.close();

  expect(during.transform, "the button still moves for somebody who asked it not to").toBe("none");
  expect(
    during.filter,
    "the press is answered with nothing at all under reduced motion, which is not what " +
    "reduced motion asks for"
  ).not.toBe("none");
});

test("display type is not tracked at one value across every size", async ({ page }) => {
  // A fixed `letter-spacing` in `em` scales proportionally, which is not the
  // same as scaling correctly: large type needs progressively tighter tracking
  // and small dense type needs looser. One value was written on everything from
  // 14px to 48px, so it was wrong at both ends by construction.
  await signInAsClinician(page);
  await page.goto("/clinician/today");
  await page.locator("main").waitFor({ state: "visible" });

  const bySize = await page.evaluate(() => {
    const out: Record<string, number> = {};
    for (const el of document.querySelectorAll(".type-display")) {
      const cs = getComputedStyle(el as HTMLElement);
      const px = parseFloat(cs.fontSize);
      out[String(px)] = parseFloat(cs.letterSpacing) / px;
    }
    return out;
  });

  const sizes = Object.keys(bySize).map(Number).sort((a, b) => a - b);
  expect(sizes.length, "only one display size on the page, so nothing can be compared").toBeGreaterThan(1);

  // BIGGER TYPE, MEANINGFULLY TIGHTER TRACKING — and `meaningfully` is doing
  // real work here rather than hedging. A strict `toBeLessThan` was written
  // first and PASSED against a deliberately flattened stylesheet: at one fixed
  // -0.021em, 30px computes to -0.63px and 20px to -0.42px, and -0.63/30 is
  // fractionally smaller than -0.42/20 in floating point. The guard was
  // satisfied by a margin of 2e-18. A step has to be a step somebody can see.
  const STEP = 0.002;
  for (let i = 1; i < sizes.length; i++) {
    const tighter = bySize[String(sizes[i - 1])] - bySize[String(sizes[i])];
    expect(
      tighter,
      `${sizes[i]}px is tracked ${tighter.toFixed(5)}em tighter than ${sizes[i - 1]}px, which is ` +
      "not a step — the size-specific scale has gone flat again"
    ).toBeGreaterThan(STEP);
  }
});

test("a command says it is running, and a second press inside it writes nothing", async ({ page }) => {
  // MEASURED BEFORE IT WAS BUILT, and this is why it is not a polish item.
  // "Record that you prepared" is a server action — a write, a revalidate and a
  // redirect, 221ms against a local database with a warm build. Through all of
  // it the button read exactly as before and stayed live. Pressed twice inside
  // that window the ledger took TWO care-time records for one piece of work:
  // the record said a clinician prepared for a session twice when they did it
  // once. A record of care that did not happen is the one thing this ledger
  // cannot survive.
  await signInAsClinician(page);
  await page.goto("/clinician/caseload");
  const link = await page.locator('a[href^="/clinician/member/"]').first().getAttribute("href");
  expect(link, "no person on the caseload to open").toBeTruthy();
  // The caseload links into a sub-route; the care-time control and the ledger
  // both live on the record's root.
  const person = link!.split("/").slice(0, 4).join("/");
  await page.goto(person);

  const entries = () => page.getByTestId("care-history-entry").count();
  const before = await entries();

  const button = page.locator('form:has(input[name="action"]) button').first();
  await expect(button, "the record's care-time control is not on this screen").toBeVisible();
  const idle = (await button.textContent())?.trim();

  await button.click({ noWaitAfter: true });

  // WHILE IT RUNS: the control says so, in the control the person is already on.
  await expect(button).toHaveAttribute("data-pending", "true");
  expect(
    (await button.textContent())?.trim(),
    "the button says the same thing while the server is working as it did before"
  ).not.toBe(idle);
  await expect(button).toHaveAttribute("aria-disabled", "true");

  // AND THE SECOND PRESS IS REFUSED. `force` because the control is deliberately
  // still focusable and still hit-testable — it is aria-disabled rather than
  // disabled, so a keyboard user does not lose their place mid-task.
  await button.click({ noWaitAfter: true, force: true, timeout: 3000 }).catch(() => {});

  await page.waitForLoadState("networkidle");
  await page.goto(person);
  const after = await entries();
  expect(
    after - before,
    "two presses inside one round trip wrote more than one care-time record"
  ).toBe(1);
});
