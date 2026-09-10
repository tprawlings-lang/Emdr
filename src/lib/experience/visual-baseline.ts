// Visual regression, as a structural baseline (Package 7's missing piece).
//
// WHY NOT PIXELS, which is the first thing anybody will ask. Playwright's
// `toHaveScreenshot` compares images, and an image baseline is only meaningful
// against the machine that made it: this repository's CI installs its own
// Chromium on ubuntu-latest, and the container these were captured in pins a
// different build at /opt/pw-browsers/chromium. Font metrics, subpixel
// antialiasing and one Chromium version between them are enough to fail every
// comparison. Committing baselines that only match on one machine is worse than
// having none — it is a red suite that everybody learns to ignore, which is the
// exact failure this codebase keeps naming.
//
// SO THIS CAPTURES THE VISUAL CONTRACT RATHER THAN THE PIXELS. Four things per
// screen, all of which survive a font renderer and none of which survive a real
// regression:
//
//   THE HEADING OUTLINE. Level and text, in document order. A section that
//   disappears, gets demoted, or gets renamed shows up here, and those are the
//   changes that actually break a screen's meaning.
//
//   THE LANDMARKS. Which regions exist and what they are labelled. One main,
//   the navigation that belongs to the role, the panels a screen is made of.
//
//   THE PAINTED PALETTE. The distinct background and text colours actually
//   computed on the page, bucketed. A raw hex creeping past the token system
//   changes this; a font renderer does not.
//
//   THE RHYTHM. The distinct spacing values in use. A screen that quietly
//   stops using the scale shows a value nobody declared.
//
// WHAT CAN BE BASELINED AT ALL. Only a screen whose structure does not depend
// on the wall clock. The caseload was in the first set and came out on the
// first real run: its alert heading reads "Alerts #" or "Alerts # overdue"
// according to whether anything has passed its deadline since the seed, and the
// overdue tone is a colour that appears only when something has. Both are the
// screen working. A baseline over them would go red on its own after a few
// hours, which is the same failure as a pixel baseline arrived at from the
// other direction.
//
// WHAT IT DOES NOT CATCH, said plainly because a baseline that overclaims is
// how a regression gets through: a change of spacing WITHIN the scale, a colour
// swapped for another declared colour, anything about position or overlap, and
// every purely pixel-level difference. The cross-role suite covers overlap,
// touch targets and narrow viewports behaviourally; this covers structure.

export interface Heading {
  level: number;
  text: string;
}

export interface ScreenBaseline {
  route: string;
  role: string;
  headings: Heading[];
  landmarks: string[];
  /** Distinct computed colours, sorted. Bucketed as `background` / `text`. */
  palette: { background: string[]; text: string[] };
  /** Distinct spacing values in use, sorted numerically. */
  rhythm: string[];
}

export interface VisualBaseline {
  capturedAt: string;
  conditions: string;
  screens: ScreenBaseline[];
}

export interface Drift {
  route: string;
  what: string;
  added: string[];
  removed: string[];
}

const diff = (before: string[], after: string[]) => ({
  added: after.filter((x) => !before.includes(x)),
  removed: before.filter((x) => !after.includes(x)),
});

/**
 * What changed between a committed baseline and a fresh capture.
 *
 * Returns every difference rather than the first: a reviewer looking at a
 * regression wants the shape of it, and a comparison that stops at the first
 * mismatch turns one review into five.
 */
export function driftBetween(before: VisualBaseline, after: VisualBaseline): Drift[] {
  const out: Drift[] = [];
  const afterByRoute = new Map(after.screens.map((s) => [s.route, s]));

  for (const was of before.screens) {
    const now = afterByRoute.get(was.route);
    if (!now) {
      out.push({ route: was.route, what: "screen", added: [], removed: ["the whole screen"] });
      continue;
    }
    const headings = diff(
      was.headings.map((h) => `h${h.level}: ${h.text}`),
      now.headings.map((h) => `h${h.level}: ${h.text}`)
    );
    if (headings.added.length || headings.removed.length) {
      out.push({ route: was.route, what: "headings", ...headings });
    }
    const landmarks = diff(was.landmarks, now.landmarks);
    if (landmarks.added.length || landmarks.removed.length) {
      out.push({ route: was.route, what: "landmarks", ...landmarks });
    }
    for (const key of ["background", "text"] as const) {
      const p = diff(was.palette[key], now.palette[key]);
      if (p.added.length || p.removed.length) {
        out.push({ route: was.route, what: `${key} colours`, ...p });
      }
    }
    const rhythm = diff(was.rhythm, now.rhythm);
    if (rhythm.added.length || rhythm.removed.length) {
      out.push({ route: was.route, what: "spacing", ...rhythm });
    }
  }

  for (const now of after.screens) {
    if (!before.screens.some((s) => s.route === now.route)) {
      out.push({ route: now.route, what: "screen", added: ["a screen with no baseline"], removed: [] });
    }
  }
  return out;
}

/** Said once, so the screen and the commit message quote the same words. */
export const NOT_CAUGHT = [
  "A spacing change that stays inside the scale.",
  "A colour swapped for another colour the token system already declares.",
  "Anything about position, overlap or size — the cross-role suite checks those behaviourally, at the viewports where they break.",
  "Every purely pixel-level difference, which is the trade this baseline makes to be comparable across machines at all.",
];
