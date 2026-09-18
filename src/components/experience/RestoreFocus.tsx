"use client";

import { useEffect } from "react";

// Put the keyboard back where it was (handoff 09 §8.6; UX 011).
//
//   "When the panel closes, return keyboard focus to the control that opened
//   it."
//
// The evidence panel is link-driven and server-rendered, which is what makes it
// work without JavaScript and openable in a new tab — and it is also why focus
// was landing on <body> after every close. A navigation resets focus, so a
// keyboard user who opened a row's evidence, read it, and closed it was
// returned to the top of the document and had to tab back through the whole
// queue to reach the row they were looking at.
//
// THE CLOSE LINK CARRIES THE TARGET IN ITS FRAGMENT, so the mechanism survives
// with JavaScript disabled: `#row-<id>` is a real fragment pointing at a real
// focusable link, and a browser following it lands the reader at the right
// place on its own. This component makes it deterministic under client-side
// navigation too, where the router does not, and then clears the fragment so a
// later reload does not re-focus something the reader has moved on from.
//
// Deliberately not a focus TRAP and deliberately not scroll-into-view-always:
// the panel is non-modal precisely so the list stays readable beside it.

export function RestoreFocus({ token }: { token: string }) {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;

    // getElementById, NOT querySelector, and this is the whole reason the first
    // working version still focused nothing. A queue row's id is its work-item
    // id — `alert:90E2…::checkin_safety_positive` — so `#row-alert:90E2…` is
    // not a valid CSS selector, querySelector threw, and the catch swallowed it
    // into silence. An id is a string, not a selector; look it up as one.
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!(el instanceof HTMLElement)) return;
    el.focus({ preventScroll: false });
    // Leave the address bar as the reader would expect to find it: the
    // fragment did its job on arrival and means nothing afterwards.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    // `token` changes when the panel opens or closes, which is what makes this
    // fire on a client-side navigation — the component is not remounted, so an
    // empty dependency list would run once for the life of the page.
  }, [token]);

  return null;
}
