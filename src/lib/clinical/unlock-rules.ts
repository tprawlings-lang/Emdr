// The two rules an unlock decision has to satisfy.
//
// HERE RATHER THAN IN THE ACTION, for two reasons that turned out to be the
// same one. `src/lib/actions.ts` carries "use server", so every export in it
// must be an async server action — a pure rule cannot live there, and the
// build says so. And a rule sitting inside `decideUnlock`, behind
// `requireClinician`, is a rule no unit test can reach: deleting either of
// these changed nothing any test could see.
//
// The work register found it. `decideUnlock` was called by two screens and
// named by no test at all — built, wired, and unpinned.

/**
 * Why this decision cannot be recorded, or null.
 *
 * BOTH RULES ARE THE MEMBER'S, not the clinician's convenience. A value that
 * is neither open nor decline is not a decision. And a decision with no reason
 * leaves the member with a changed door and no sentence to read, which is the
 * whole thing the unlock workflow exists to avoid: the member's screen shows
 * the clinician's words, so there have to be some.
 */
export function unlockDecisionRefusal(decision: string, reason: string): string | null {
  if (decision !== "unlocked" && decision !== "denied") {
    return "A decision has to be either opening the module or declining it.";
  }
  if (!reason.trim()) return "A decision needs a reason the member can read.";
  return null;
}
