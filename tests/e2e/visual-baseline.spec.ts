import { test, expect } from "@playwright/test";
import { readScreen, SCREENS, ROLES } from "../../scripts/capture-visual-baseline";
import { VISUAL_BASELINE } from "../../src/lib/experience/visual-baseline.generated";
import { driftBetween, type ScreenBaseline } from "../../src/lib/experience/visual-baseline";

// The visual regression check (Package 7).
//
// NOT A SCREENSHOT COMPARISON, and src/lib/experience/visual-baseline.ts says
// why at length: this repository's CI installs its own Chromium on
// ubuntu-latest while the container these were captured in pins a different
// build, and one Chromium version plus a font renderer is enough to fail every
// pixel comparison. A baseline that only matches on one machine is a red suite
// everybody learns to ignore.
//
// So the baseline is the visual CONTRACT — the heading outline, the landmarks,
// the colours actually painted, and the spacing values in use. Those survive a
// font renderer and do not survive a section quietly disappearing, a heading
// being demoted, or a raw hex creeping past the token system.
//
// WHEN THIS FAILS, READ THE DIFF BEFORE REFRESHING IT. A drift entry names the
// screen, what changed, and both sides. If the change was intended, recapture:
//   BASE=http://127.0.0.1:3000 npx tsx scripts/capture-visual-baseline.ts

test("no screen has drifted from its committed visual baseline", async ({ browser, baseURL }) => {
  const base = baseURL ?? "http://127.0.0.1:3000";
  const screens: ScreenBaseline[] = [];

  for (const role of Object.keys(ROLES)) {
    const [email, password] = ROLES[role];
    // THE SAME VIEWPORT THE BASELINE WAS TAKEN AT. A heading that wraps is
    // still the same heading, but a panel that stacks is a different landmark
    // order — so the width is part of the contract rather than a detail.
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60_000 }),
      page.getByRole("button", { name: "Continue" }).click(),
    ]);
    for (const [who, route] of SCREENS) {
      if (who !== role) continue;
      await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded" });
      await page.locator("main").waitFor({ state: "visible" });
      screens.push({ role, route, ...(await readScreen(page)) });
    }
    await context.close();
  }

  const drift = driftBetween(VISUAL_BASELINE, {
    capturedAt: new Date().toISOString(),
    conditions: "captured by the end-to-end check",
    screens: screens.sort((a, b) => a.route.localeCompare(b.route)),
  });

  const readable = drift.map(
    (d) => `${d.route} — ${d.what}\n    + ${d.added.join("\n    + ")}\n    - ${d.removed.join("\n    - ")}`
  );
  expect(
    readable,
    "screens drifted from the baseline; read the diff, then recapture if it was intended"
  ).toEqual([]);
});
