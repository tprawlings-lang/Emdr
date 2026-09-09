// Cross-role quality: the acceptance rules, as values a test can hold a screen to
// (handoff 09 §8.6, handoff 06 §31.4).
//
// §10's package table calls this "cross-role quality" and adds a warning:
// "Runs alongside every package and closes at the end. NOT A CLEANUP SPRINT."
// The distinction matters for how this module is written. A cleanup sprint is a
// list of screens somebody once looked at. What is here instead is the small set
// of rules that can be checked on EVERY route, including the ones added next
// month by somebody who never read the handoff — the numbers live in one place
// so a guard and a component cannot disagree about them.
//
// NO IMPORTS, deliberately. This is consumed by server components, client
// components and tests alike, and a quality rule that drags a database driver
// into the browser bundle is its own kind of defect.

/**
 * The id every page's `<main>` carries, so one skip link in the root layout can
 * target it without each shell inventing its own anchor.
 *
 * §8.6 asks for "one main landmark ... [and a] skip link" on every route. Two
 * shells having two ids is how the second one silently stops being skippable.
 */
export const MAIN_ID = "main-content";

/** The skip link's words. Fixed, because "Skip to content" is what a screen
 *  reader user is listening for; a cleverer phrase is a worse one. */
export const SKIP_LINK_LABEL = "Skip to main content";

/**
 * §1.10's ruling, and the reason it is two numbers rather than one.
 *
 * Handoff 08 and Astra disagreed: both proposed 44 px, and Astra correctly
 * noted WCAG 2.2 SC 2.5.8 sets 24 × 24 CSS px as the conformance minimum. The
 * ruling keeps 44 as the PRODUCT GOAL for frequent actions and cites 24 as the
 * CONFORMANCE FLOOR — and §8.6 adds "report them separately", which is the part
 * that gets lost. A single number would either fail conformance-passing screens
 * or let a 24 px control be reported as meeting the goal.
 */
export const TOUCH_TARGET_GOAL_PX = 44;
export const TOUCH_TARGET_FLOOR_PX = 24;

/** How a measured control reports against both numbers at once. */
export type TargetVerdict = "meets_goal" | "meets_floor" | "below_floor";

export function targetVerdict(shortestSidePx: number): TargetVerdict {
  if (shortestSidePx >= TOUCH_TARGET_GOAL_PX) return "meets_goal";
  if (shortestSidePx >= TOUCH_TARGET_FLOOR_PX) return "meets_floor";
  return "below_floor";
}

/** Reported separately, per §8.6 — a screen is conformant when nothing is below
 *  the floor, and it meets the product goal only when nothing is merely at it. */
export interface TargetReport {
  meetsGoal: number;
  meetsFloor: number;
  belowFloor: number;
}

export function conformant(report: TargetReport): boolean {
  return report.belowFloor === 0;
}

export function meetsProductGoal(report: TargetReport): boolean {
  return report.belowFloor === 0 && report.meetsFloor === 0;
}

/**
 * §8.6's two viewport conditions: "All interactions work at 320 CSS px and 200%
 * zoom without two-dimensional scrolling except for genuinely tabular data."
 *
 * 200% zoom at a 1280 px window is the same layout problem as a 640 px window,
 * which is why the second entry is 640 rather than a zoom setting: a headless
 * browser reports CSS pixels, so this is the honest way to check the condition
 * rather than a proxy for it.
 */
export const NARROW_VIEWPORTS_PX = [320, 640] as const;

/** The exception in the same sentence. A wide table may scroll sideways inside
 *  its own container; the PAGE may not. Anything claiming the exception says so
 *  with this attribute, so a guard can tell a considered exception from an
 *  overflowing layout. */
export const TABULAR_SCROLL_ATTR = "data-tabular-scroll";

/**
 * §8.6: "Sticky toolbars, bottom navigation, and drawers must not obscure a
 * component receiving keyboard focus, at any zoom level or narrow width."
 *
 * Package 3 reserved space for the SupportDock in the page's own padding, which
 * keeps CONTENT clear of it. That is not the same claim: a control can be
 * scrolled to a position under a fixed element and still take focus there. The
 * attribute names every element that floats above the page, so a keyboard walk
 * can ask, for each focused control, whether one of them covers it.
 */
export const FLOATING_ELEMENT_ATTRS = ["data-support-dock", "data-sos-button"] as const;

/**
 * §8.4's honest-absence states. Named here rather than in a component because
 * the rule is cross-role: the same eight words mean the same thing on a member
 * screen and a payer screen, and "empty" must never be rendered as a clinical
 * finding on either.
 */
export const ABSENCE_STATES = [
  "empty",
  "none_recorded",
  "insufficient_evidence",
  "partial",
  "stale",
  "withheld",
  "unavailable",
  "error",
  "forbidden",
  "expired",
] as const;

export type AbsenceState = (typeof ABSENCE_STATES)[number];

/** What each state may never imply — §8.4's last column, which is the one that
 *  turns a copy question into a checkable rule. */
export const NEVER_IMPLY: Record<AbsenceState, string> = {
  empty: "healthy or low risk",
  none_recorded: "a negative finding",
  insufficient_evidence: "stable or unchanged",
  partial: "full coverage",
  stale: "current truth",
  withheld: "no content exists",
  unavailable: "zero value",
  error: "empty truth",
  forbidden: "a missing route",
  expired: "approved access",
};
