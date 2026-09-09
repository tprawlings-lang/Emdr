import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Cross-role quality, signed in (handoff 09 §8.6, §10's Package 7).
//
// WHY THIS EXISTS BESIDE tests/e2e/a11y.spec.ts. That suite audits every
// unauthenticated institutional page, and it has been green throughout — which
// is exactly the trap. §8.6 asks for "a manual screen-reader script [covering]
// each role home and one full primary task", and the product a member,
// clinician or reviewer actually uses is the half nothing was auditing. The
// first run of these checks found three defects on the signed-in side, all of
// them invisible in a screenshot and none of them on a public page:
//
//   • No route in the product had a skip link. Nothing was missing on screen,
//     because a skip link is invisible until it is focused.
//   • /app/ground had no <main> landmark at all: the activity shell removes
//     navigation by design, and the landmark left with it. The one route where
//     a person is midway through an activity was the one they could not skip
//     into.
//   • /review/status carried 64 serious axe violations from six definition
//     lists whose descriptions were <p> siblings rather than <dd>.
//
// And one that only a running browser can see at all: at 320px, four controls
// on /app/today took keyboard focus while sitting behind the support dock.

test.skip(
  Boolean(process.env.E2E_BASE_URL),
  "authenticated flow runs only against the hermetic seeded server",
);

type Page = import("@playwright/test").Page;

const ACCOUNTS = {
  patient:   { email: "patient.demo@steady.local",   password: "patient1234" },
  clinician: { email: "clinician.demo@steady.local", password: "clinician1234" },
  reviewer:  { email: "reviewer.demo@steady.local",  password: "reviewer1234" },
} as const;

/** §8.6 asks for each role home AND one full primary task. The second entry in
 *  each list is the task, not a second home: grounding is what a member reaches
 *  for mid-day, the patient record is where a clinician does the work, and the
 *  release page is where a reviewer decides. */
const JOURNEYS: Array<{ who: keyof typeof ACCOUNTS; home: string; task: string }> = [
  { who: "patient",   home: "/app/today",       task: "/app/ground" },
  { who: "clinician", home: "/clinician/today", task: "/clinician/patients" },
  { who: "reviewer",  home: "/review/status",   task: "/review/release" },
];

async function signIn(page: Page, who: keyof typeof ACCOUNTS) {
  const a = ACCOUNTS[who];
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.locator('input[name="email"]').fill(a.email);
  await page.locator('input[name="password"]').fill(a.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login") || u.search.includes("error")),
    page.locator('form button[type="submit"]').click(),
  ]);
}

for (const j of JOURNEYS) {
  for (const path of [j.home, j.task]) {
    test(`a11y: ${j.who} at ${path} has no serious/critical WCAG violations`, async ({ page }, testInfo) => {
      await signIn(page, j.who);
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      await testInfo.attach(`axe-${j.who}-${path.replace(/\W+/g, "_")}.json`, {
        body: JSON.stringify(results.violations, null, 2),
        contentType: "application/json",
      });

      const blocking = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical"
      );
      const summary = blocking
        .map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.help}`)
        .join("\n");
      expect(blocking, `serious/critical violations on ${path}:\n${summary}`).toEqual([]);
    });

    test(`${path} has one main landmark and a working skip link`, async ({ page }) => {
      await signIn(page, j.who);
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      const structure = await page.evaluate(() => ({
        mains: document.querySelectorAll("main").length,
        h1s: document.querySelectorAll("h1").length,
        anchor: !!document.getElementById("main-content"),
      }));
      expect(structure.mains, "exactly one main landmark").toBe(1);
      expect(structure.h1s, "exactly one page-level heading").toBe(1);
      expect(structure.anchor, "the skip link's target exists").toBe(true);

      // The first thing Tab reaches must be the skip link — one placed after
      // the banner and the navigation rail skips neither.
      await page.keyboard.press("Tab");
      const isSkip = await page.evaluate(
        () => document.activeElement?.hasAttribute("data-skip-link") ?? false
      );
      expect(isSkip, "the skip link is not the first focusable control").toBe(true);
    });
  }
}

test("at 320px no fixed element covers a control that has taken focus", async ({ page }) => {
  // §1.6, restated by §8.6: "No fixed element may obscure a focused control at
  // 320 CSS px." Two elements are fixed to the bottom of a member screen — the
  // support dock and the SOS button — and reserving space at the END of the
  // document does not keep a mid-page control clear of them.
  //
  // The check focuses every control in turn and asks the document what is
  // painted at that control's centre. A control off-screen is skipped: for
  // those, scrolling is the answer and the browser does it.
  await signIn(page, "patient");
  await page.setViewportSize({ width: 320, height: 640 });

  for (const path of ["/app/today", "/app/ground"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");

    const covered = await page.evaluate(async () => {
      const floats = [...document.querySelectorAll("[data-support-dock], [data-sos-button]")];
      if (!floats.length) return ["no floating element found — this page cannot prove the rule"];
      const bad: string[] = [];
      const sel = "a[href], button, input:not([type=hidden]), select, textarea";
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        const r0 = el.getBoundingClientRect();
        if (!r0.width || !r0.height) continue;
        el.focus();
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.bottom > innerHeight) continue;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || el.contains(hit) || hit.contains(el)) continue;
        if (floats.some((f) => f.contains(hit))) {
          bad.push(`${el.tagName} "${(el.textContent ?? "").trim().slice(0, 30)}"`);
        }
      }
      return bad;
    });

    expect(covered, `controls focused behind a fixed element on ${path}`).toEqual([]);
  }
});

test("at 320px nothing but a declared table scrolls the page sideways", async ({ page }) => {
  // §8.6: "All interactions work at 320 CSS px and 200% zoom without
  // two-dimensional scrolling except for genuinely tabular data." The exception
  // is real, so it is declared rather than assumed: a wide table scrolls inside
  // its own container, and the PAGE still does not.
  await signIn(page, "clinician");
  await page.setViewportSize({ width: 320, height: 640 });

  for (const path of ["/clinician/today", "/clinician/patients"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `${path} scrolls sideways at 320px by ${overflow}px`).toBeLessThanOrEqual(2);
  }
});

test("touch targets are reported against the goal and the floor separately", async ({ page }, testInfo) => {
  // §1.10's ruling and §8.6's instruction, together: 44px is the PRODUCT GOAL
  // for frequent actions, WCAG 2.2 SC 2.5.8's 24 × 24 is the CONFORMANCE FLOOR,
  // and the two are reported separately rather than collapsed into one number.
  //
  // The floor is the assertion; the goal is attached as a report. A screen can
  // conform without meeting the goal, and pretending otherwise would either
  // fail conforming screens or quietly promote a 24px control.
  //
  // SC 2.5.8's inline exception is honoured, not worked around: a link inside a
  // sentence is constrained by the line height of the text around it, and the
  // spec exempts it. Without that, every "988" in a paragraph reads as a
  // failure and the real ones — a 16px-tall navigation control — get lost.
  await signIn(page, "patient");
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/app/today");
  await page.waitForLoadState("networkidle");

  const report = await page.evaluate(() => {
    const sel = "a[href], button, input:not([type=hidden]), select, textarea";
    const visuallyClipped = (el: Element) => {
      const cs = getComputedStyle(el);
      return cs.clipPath === "inset(50%)" || cs.clip === "rect(0px, 0px, 0px, 0px)";
    };
    const inlineExempt = (el: Element) => {
      if (getComputedStyle(el).display !== "inline") return false;
      const around = (el.parentElement?.textContent ?? "").trim().length;
      return around > (el.textContent ?? "").trim().length + 3;
    };
    const out = { meetsGoal: 0, meetsFloor: 0, belowFloor: 0, offenders: [] as string[] };
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      // Visually hidden, so not a pointer target at all: the skip link is a
      // clipped box until it takes focus. Measuring it in that state reports a
      // failure nobody can act on — and it was passing before only because the
      // inline exception below happened to swallow it, which is worse.
      //
      // ASKED AS "IS IT CLIPPED", NOT "IS IT SMALL". A size threshold was the
      // first attempt and it was wrong twice over: the box measures 2 × 2 rather
      // than the 1 × 1 the utility nominally sets, and any threshold generous
      // enough to catch that would also excuse a genuinely tiny control. The
      // clip is what makes it invisible, so the clip is what is asked about.
      if (visuallyClipped(el)) continue;
      if (inlineExempt(el)) continue;
      const shortest = Math.min(r.width, r.height);
      if (shortest >= 44) out.meetsGoal++;
      else if (shortest >= 24) out.meetsFloor++;
      else {
        out.belowFloor++;
        out.offenders.push(`${el.tagName} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.textContent ?? "").trim().slice(0, 24)}"`);
      }
    }
    return out;
  });

  await testInfo.attach("touch-targets.json", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
  expect(report.belowFloor, `below the 24px conformance floor:\n${report.offenders.join("\n")}`).toBe(0);
});
