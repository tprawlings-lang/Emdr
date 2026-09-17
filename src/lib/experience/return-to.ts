import { VIEW_FILTERS } from "./view-state";

// Where a person record sends you back to.
//
// "Preserve origin, filters, sort, pagination, and scroll on return. Support
// direct links without relying on browser history. Validate return
// destinations against approved internal routes." (17 September handoff,
// navigation behaviour.)
//
// THE PROBLEM. The record's return control was the string "Back to Command
// Center" pointing at /clinician/today, always. A clinician who filtered the
// queue to their own patients, opened somebody, and came back got the unfiltered
// queue; one who came from Patients or from the handoff list got Command Center,
// which they had not been looking at. The filtering is then done again, which is
// the cost that makes people stop filtering.
//
// WHY A COOKIE AND NOT A QUERY PARAMETER. The alternative is `?from=` threaded
// from every link into a record and forwarded by every link inside one —
// seventeen pages and a dozen components, correct exactly as long as nobody
// adds the next one. proxy.ts already made this argument for x-pathname:
// "Next.js hands searchParams to pages only, so the alternative was threading a
// prop through twenty-three page components." The origin is a property of the
// visit, so the frame remembers it.
//
// AND IT IS NOT AN OPEN REDIRECT, structurally rather than by validation. The
// stored value is never echoed as a URL. The path must be one of four literals
// below, the parameters are rebuilt from a closed set, and anything else is
// dropped — so a cookie a user has edited by hand can produce one of exactly
// four destinations with a subset of known parameters, or nothing.

export const RETURN_COOKIE = "steady_return";

/** The console routes a person record can return to, and what to call them. */
const ORIGINS: Record<string, string> = {
  "/clinician/today": "Back to Command Center",
  "/clinician/patients": "Back to Patients",
  "/clinician/caseload": "Back to the caseload",
  "/clinician/handoffs": "Back to Handoffs",
};

export const DEFAULT_RETURN = {
  href: "/clinician/today",
  label: ORIGINS["/clinician/today"],
};

/**
 * The parameters allowed to survive the trip, as a closed set.
 *
 * An allowlist rather than a blocklist, and the three kinds of thing left out
 * are each left out for a reason:
 *
 *   `row` is a person id. It selects whose evidence the queue has open, and a
 *   return control does not need it — the reader is coming back from that
 *   person. Writing it to a cookie would put an identifier in browser storage
 *   to save one click.
 *
 *   `q` is free text a clinician typed into patient search, which in this
 *   product is usually somebody's name. Losing the search on return is a real
 *   cost and it is the one being chosen: the same instinct as the handoff's
 *   "do not collect patient search terms" and its lock-screen failure case.
 *
 *   `error`, `done` and `refused` are flash state. Carrying them back would
 *   re-show "handoff accepted" on a screen where nothing had just happened,
 *   which is a result message that is no longer true.
 */
const CARRIED: readonly string[] = [...VIEW_FILTERS, "band", "filter", "page"];

/**
 * What to store for a request, or null if this is not somewhere to come back to.
 *
 * Takes the path and the raw query rather than a request, so a test can call it
 * with a string and the proxy stays the only thing that knows about requests.
 */
export function rememberable(pathname: string, search: string): string | null {
  if (!(pathname in ORIGINS)) return null;
  const from = new URLSearchParams(search);
  const kept = new URLSearchParams();
  // In CARRIED's declared order, so one view produces one value however the
  // query was written. Declared rather than sorted: this layer may not order
  // anything at its own discretion, and a list written down is also the list
  // a reader checks.
  for (const key of CARRIED) {
    const value = from.get(key);
    if (value !== null && value !== "") kept.set(key, value);
  }
  const query = kept.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * The return destination a stored value describes.
 *
 * Rebuilt rather than trusted: the path is matched against ORIGINS and the
 * query is filtered through CARRIED again, because the value arrives from a
 * cookie and a cookie is something the holder can write.
 */
export function parseReturn(raw: string | undefined | null): { href: string; label: string } | null {
  if (!raw) return null;

  const [pathname, ...rest] = raw.split("?");
  // THE ALLOWLIST IS THE WHOLE DEFENCE, and there is deliberately nothing in
  // front of it. An earlier version also refused a scheme, a protocol-relative
  // "//host" and a ".." traversal before reaching here, which read as
  // defence-in-depth and was decorative: every one of those values fails this
  // lookup too, so no test could tell the checks from their absence. Mutation
  // testing said so — removing them changed no behaviour. Code that implies a
  // protection it is not providing is worse than no code, so the four literals
  // do the work and the invariant below is asserted directly.
  const label = ORIGINS[pathname];
  if (!label) return null;

  const from = new URLSearchParams(rest.join("?"));
  const kept = new URLSearchParams();
  for (const key of CARRIED) {
    const value = from.get(key);
    if (value !== null && value !== "") kept.set(key, value);
  }
  const query = kept.toString();
  return { href: query ? `${pathname}?${query}` : pathname, label };
}

/** The return destination, falling back to Command Center. A record opened
 *  from a direct link — no cookie, no history — still has somewhere to go. */
export function returnTo(raw: string | undefined | null): { href: string; label: string } {
  return parseReturn(raw) ?? DEFAULT_RETURN;
}
