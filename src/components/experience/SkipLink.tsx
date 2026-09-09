import { MAIN_ID, SKIP_LINK_LABEL } from "@/lib/experience/quality";

/**
 * The first focusable thing on every page (handoff 09 §8.6).
 *
 * WHY IT DID NOT EXIST UNTIL NOW. Nothing on screen was missing, which is
 * exactly why: a skip link is invisible until it is focused, so its absence
 * cannot be seen in a screenshot, only measured. It was measured — an axe and
 * structure sweep across the signed-in role homes at 1280 and 320 px — and no
 * route in the product had one.
 *
 * WHAT IT IS FOR. Before reaching a clinician's queue or a member's day, a
 * keyboard or screen-reader user tabs through the demo banner, the review
 * strip, and the whole navigation rail — on every page load, including the ones
 * reached by pressing "back". This is the control that skips it.
 *
 * VISIBLE ON FOCUS, not hidden from it. `sr-only` alone would leave a sighted
 * keyboard user pressing Tab with nothing on screen and the page apparently
 * unchanged; `focus:not-sr-only` brings it back as a real, styled control at
 * the top of the page. It is placed in the root layout, so a route that forgets
 * it does not exist.
 *
 * LIGHT ON DARK, because of where it lands. It is absolutely positioned over
 * whatever is at the top of the page, and in this product that is the dark demo
 * banner — the first version used the same dark green and read as a piece of
 * the banner rather than as a control someone had just focused. A pale card
 * with a border and the page's own shadow reads as a control on any surface it
 * happens to cover.
 *
 * THE PADDING IS IN THE FOCUS VARIANT ON PURPOSE. `not-sr-only` resets padding
 * to zero along with everything else `sr-only` set, so `px-4 py-3` written as
 * plain classes is undone at exactly the moment the control becomes visible —
 * measured at 139 × 22 px on screen, which is under the 24 px conformance floor
 * this package exists to enforce. Written as `focus:px-4 focus:py-3` it lands
 * after the reset.
 */
export function SkipLink() {
  return (
    <a
      href={`#${MAIN_ID}`}
      data-skip-link
      className="sr-only rounded-xl border border-ground/20 bg-ivory text-sm font-medium text-ground shadow-soft focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:px-4 focus:py-3"
    >
      {SKIP_LINK_LABEL}
    </a>
  );
}
