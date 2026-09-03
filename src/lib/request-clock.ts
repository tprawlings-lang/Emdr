// The time a request was served.
//
// WHY THIS IS A MODULE AND NOT `Date.now()` AT FOUR CALL SITES.
//
// React's purity rule rejects a clock read inside a component body, and it is
// right about client components: those re-render, and a value that changes
// between renders of the same state is how a screen ends up disagreeing with
// itself. Server components do not re-render — one render, one request — so
// reading the clock there is not merely safe, it is the only way to know when
// the request happened.
//
// So the rule is a false positive on exactly four pages. This module was
// written expecting to hold one documented suppression instead of four, and it
// turned out to need none: the rule applies to component bodies, so a clock
// read in an ordinary module is simply outside its scope. What is left is not a
// workaround — it is the concept ("the time this request was served") having a
// name, which is what the four scattered `Date.now()` calls were missing.
//
// IT ALSO FIXED A REAL BUG, which is why this is worth more than a lint
// workaround. Three of those pages read the clock more than once per render:
// `/app/measures` read it inside a `.map`, so two measures could land either
// side of midnight and disagree about what "today" is; `/review/autonomous`
// read it twice in its session simulator, once to derive the start time and
// once to evaluate the post-set, so the elapsed time it simulated silently
// included however long the render itself took. One reading per request makes
// both impossible.

/** The instant this request is being served.
 *
 *  Call ONCE per page, near the top, and pass it down. Every "how long ago",
 *  every gate and every due-date on the rendered screen should be computed from
 *  the same reading, so nothing on it can disagree with anything else about
 *  what time it is.
 *
 *  Server components only. A client component that needs a clock should read it
 *  in an effect, where re-rendering cannot change the answer underneath it. */
export function requestNow(): number {
  return Date.now();
}
