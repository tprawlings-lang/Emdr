// Capture the structural visual baseline (Package 7).
//
//   BASE=http://localhost:3000 npx tsx scripts/capture-visual-baseline.ts
//
// Writes src/lib/experience/visual-baseline.generated.ts, which
// tests/visual-baseline.test.ts compares a fresh capture against. See
// src/lib/experience/visual-baseline.ts for why this captures a contract rather
// than pixels.

import fs from "fs";
import path from "path";
import type { ScreenBaseline, VisualBaseline } from "../src/lib/experience/visual-baseline";

const BASE = process.env.BASE || "http://localhost:3000";
const OUT = path.join(process.cwd(), "src/lib/experience/visual-baseline.generated.ts");

export const ROLES: Record<string, [string, string]> = {
  member: ["patient.demo@steady.local", "patient1234"],
  clinician: ["clinician.demo@steady.local", "clinician1234"],
  organization: ["org.demo@steady.local", "org1234"],
  reviewer: ["reviewer.demo@steady.local", "reviewer1234"],
};

// One screen per role per shape, chosen for what they are made of rather than
// for coverage. A baseline over ninety routes is a baseline nobody re-reads
// when it drifts, and an unread baseline is refreshed rather than investigated.
export const SCREENS: Array<[keyof typeof ROLES, string]> = [
  ["member", "/app/today"],
  ["member", "/app/settings/referral"],
  ["clinician", "/clinician/today"],
  // NOT /clinician/caseload, AND THE BASELINE FOUND THAT OUT ITSELF. That
  // screen's headings and its painted palette both depend on the WALL CLOCK:
  // an alert heading reads "Alerts #" or "Alerts # overdue" according to
  // whether anything has passed its deadline since the seed, and the overdue
  // tone is a colour that only appears when something has. Both are correct
  // behaviour and neither is a regression, so baselining them would produce a
  // check that goes red on its own after a few hours — which is the failure
  // this whole approach was chosen to avoid.
  //
  // The directory carries the same chrome and orders by name, so it holds the
  // clinician shell's contract without holding the clock's.
  ["clinician", "/clinician/patients"],
  ["organization", "/organization/overview"],
  ["reviewer", "/review/security"],
  ["reviewer", "/review/performance"],
  ["reviewer", "/review/telemetry"],
];

export async function capture(): Promise<VisualBaseline> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {}
  );
  const screens: ScreenBaseline[] = [];
  try {
    for (const role of Object.keys(ROLES) as Array<keyof typeof ROLES>) {
      const [email, password] = ROLES[role];
      const context = await browser.newContext({
        baseURL: BASE,
        // A FIXED VIEWPORT, because a heading that wraps is still the same
        // heading but a panel that stacks is a different landmark order.
        viewport: { width: 1280, height: 900 },
      });
      const page = await context.newPage();
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(password);
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60_000 }),
        page.getByRole("button", { name: "Continue" }).click(),
      ]);

      for (const [who, route] of SCREENS) {
        if (who !== role) continue;
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
        await page.locator("main").waitFor({ state: "visible" });
        screens.push({ role, route, ...(await readScreen(page)) });
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  return {
    capturedAt: new Date().toISOString(),
    conditions:
      process.env.CONDITIONS
      || `1280x900, signed in per role, against ${BASE} with seeded demo data`,
    screens: screens.sort((a, b) => a.route.localeCompare(b.route)),
  };
}

/** Everything read out of one rendered page, in the browser. Exported so the
 *  end-to-end check reads a screen exactly as the capture did — two readers
 *  that drift apart would report a regression that is only a disagreement. */
export async function readScreen(page: import("playwright").Page) {
  // FREEZE MOTION BEFORE READING, or the palette drifts against itself.
  //
  // The patient directory's rows carry `transition-colors`, and a computed
  // style read while one is in flight returns the same colour at a
  // part-way alpha — `oklab(… / 0.208)` against a baseline's
  // `oklab(… / 0.137)`. That is a transition working correctly and a reader
  // catching it mid-step, which is exactly the kind of nondeterminism that
  // makes a baseline go red on its own. The pointer is parked in a corner for
  // the same reason: a row under the mouse is a row in its hover state.
  await page.addStyleTag({
    content: "*,*::before,*::after{transition:none!important;animation:none!important}",
  });
  await page.mouse.move(0, 0);
  return page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;

    const headings = [...main.querySelectorAll("h1, h2, h3")]
      .map((el) => ({
        level: Number(el.tagName.slice(1)),
        // Collapsed and capped: a heading carrying a live count would otherwise
        // drift on every reseed, which teaches everybody to refresh rather than
        // read the diff.
        text: (el.textContent ?? "").replace(/\s+/g, " ").replace(/\d+/g, "#").trim().slice(0, 80),
      }))
      .filter((h) => h.text.length > 0);

    const landmarks = [...document.querySelectorAll(
      "main, nav, header, footer, aside, section[aria-labelledby], section[aria-label], [role='region']"
    )].map((el) => {
      const label =
        el.getAttribute("aria-label")
        ?? (el.getAttribute("aria-labelledby")
          ? (document.getElementById(el.getAttribute("aria-labelledby")!)?.textContent ?? "")
          : "");
      return `${el.tagName.toLowerCase()}:${label.replace(/\s+/g, " ").replace(/\d+/g, "#").trim().slice(0, 60)}`;
    });

    const backgrounds = new Set<string>();
    const texts = new Set<string>();
    const rhythm = new Set<string>();
    for (const el of [...main.querySelectorAll("*")].slice(0, 900)) {
      const s = getComputedStyle(el);
      // ROUNDED, BECAUSE FULL PRECISION MEASURES THE RENDERER.
      //
      // The header on visual-baseline.ts explains that this is a contract
      // check rather than a pixel comparison, precisely because CI installs
      // its own Chromium and this container pins another. Colour leaked that
      // difference back in anyway: two builds convert the same token to
      // oklab and disagree in the sixth decimal —
      //
      //   0.960333 0.00280914 0.0133284   (CI)
      //   0.960262 0.00281644 0.0133320   (here)
      //
      // — which is the same colour, and produced 48 drift entries across ten
      // screens on a diff that changed none of them. A baseline that only
      // matches on one machine is the red suite everybody learns to ignore,
      // which is the thing this file set out not to be.
      //
      // Three decimals is ~14× coarser than the observed noise (7e-5) and far
      // finer than any real change: swapping one declared token for another
      // moves the second decimal at least. The guard in
      // tests/visual-baseline.test.ts holds that boundary.
      //
      // INLINED, NOT A HELPER. A `const round = …` here is a named function
      // expression, and the note below is exactly about that: esbuild keeps
      // the name by emitting a `__name` call that does not exist in the page.
      // Written as a helper first, and it would have failed on the first
      // evaluate — the same way this file already records it failing once.
      if (s.backgroundColor && s.backgroundColor !== "rgba(0, 0, 0, 0)") {
        backgrounds.add(s.backgroundColor.replace(/-?\d+\.\d{4,}/g,
          (n) => String(Math.round(parseFloat(n) * 1000) / 1000)));
      }
      if (s.color) {
        texts.add(s.color.replace(/-?\d+\.\d{4,}/g,
          (n) => String(Math.round(parseFloat(n) * 1000) / 1000)));
      }
      for (const v of [s.paddingTop, s.paddingLeft, s.marginTop, s.gap]) {
        if (v && v !== "0px" && v !== "normal") rhythm.add(v);
      }
    }
    // NO NAMED FUNCTION INSIDE THIS BODY. The bundler that compiles this file
    // keeps function names by emitting a `__name` helper, and that helper does
    // not exist in the page — so a named comparator here fails with
    // "__name is not defined" at the first evaluate.
    return {
      headings,
      landmarks,
      palette: { background: [...backgrounds].sort(), text: [...texts].sort() },
      rhythm: [...rhythm].sort((a, b) => parseFloat(a) - parseFloat(b)),
    };
  });
}

async function main() {
  const baseline = await capture();
  fs.writeFileSync(OUT, `// GENERATED — do not edit by hand.
//
// Recapture against a running server with:
//   BASE=http://localhost:3000 npx tsx scripts/capture-visual-baseline.ts
//
// The structural visual baseline for Package 7. See ./visual-baseline.ts for
// what it holds, and for why it is not a set of screenshots.

import type { VisualBaseline } from "./visual-baseline";

export const VISUAL_BASELINE: VisualBaseline = ${JSON.stringify(baseline, null, 2)};
`);
  console.log(
    `wrote ${path.relative(process.cwd(), OUT)}: ${baseline.screens.length} screens, ` +
    `${baseline.screens.reduce((n, s) => n + s.headings.length, 0)} headings`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
}
