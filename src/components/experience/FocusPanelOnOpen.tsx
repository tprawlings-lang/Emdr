"use client";

import { useEffect } from "react";

// Put the reader on the panel when it opens.
//
// BELOW THE LIST ON A WIDE SCREEN COSTS 895px, measured on a 1440x900 laptop
// after the panel moved there on 23 September — so a clinician pressed "why
// this is here" and the screen appeared not to change, which is the same defect
// a measurement caught on a phone when it was stacked there. A control that
// appears to do nothing is worse than one that is merely far away.
//
// NOT A URL FRAGMENT, AND THAT WAS THE FIRST ATTEMPT. `#queue-evidence` on the
// opening link moves the browser to the panel for free and works with
// JavaScript off — and it broke re-opening a row. `RestoreFocus` clears the
// fragment once it has done its job, so the address becomes `?row=X`; going to
// `?row=X#queue-evidence` again is then a FRAGMENT-ONLY CHANGE, which browsers
// handle without reloading. The panel kept whatever it was last showing — a
// clinician who recorded a contact and opened the same row again saw the old
// confirmation instead of the form. The browser suite caught it and it
// reproduced twice; it was not a flake.
//
// FOCUS RATHER THAN SCROLL, because it does both. Moving focus scrolls the
// element into view, and it also puts a screen-reader user inside the region
// that just opened rather than leaving them at the top of a list they have
// already read. The panel takes `tabIndex={-1}` so it can be focused
// programmatically without joining the tab order.
//
// WITHOUT JAVASCRIPT the panel is still there and still correct; on a wide
// screen it is below the list and the reader scrolls. That is a degradation
// rather than a break, and the phone case — the one the original measurement
// was about — is unaffected, because there the panel is above the list.
export function FocusPanelOnOpen({ token }: { token: string | null }) {
  useEffect(() => {
    // Nothing open, or a close in progress: RestoreFocus owns that case, and
    // two components moving focus on one navigation is a fight neither wins.
    if (!token || window.location.hash) return;
    const el = document.getElementById("queue-evidence");
    if (el instanceof HTMLElement) el.focus({ preventScroll: false });
    // `token` is the open row's id, so this fires when the panel opens and
    // when it moves to a different row — not on every render.
  }, [token]);

  return null;
}
