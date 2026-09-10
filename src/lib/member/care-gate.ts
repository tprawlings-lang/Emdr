// The member care gate, as one definition (handoff 06 §30.6 step 4).
//
// WHAT THIS FIXES. Five different pages ran five different PREFIXES of the same
// four-step chain, and nineteen more ran none of it. `/app/today` checked
// subscription, consent, screening and profile; `/app/check-in` checked the
// first three; `/app/paths` checked the first; and `/app/progress`,
// `/app/plan`, `/app/settings`, `/app/learn` and the rest checked only that
// somebody was signed in. A member whose consent was revoked could still read
// their plan and their progress, because the gate lived on the screens somebody
// remembered rather than on the tree.
//
// Found by the access inventory: nineteen member routes owed §30.6's
// consent step and showed no evidence of it.
//
// WHY A LAYOUT AND NOT A HELPER. The other four consoles are guarded once, in
// their layout, and no page beneath repeats the call. The member tree was the
// one without a layout. A helper would have been a fifth thing to remember.
//
// THE TWO EXCEPTIONS ARE THE WHOLE SUBTLETY, and getting either wrong is an
// infinite redirect — the exact failure the review console's own layout carries
// a comment about.
//
//   A GATE DESTINATION cannot run the gate. `/app/onboarding` is where a member
//   with no consent is SENT; running the consent check there would send them to
//   themselves forever.
//
//   AN ALWAYS-OPEN ROUTE cannot even require an account. Grounding is reachable
//   without signing in on purpose — there is no condition in which support is
//   withdrawn — so the layout must not call `requireMember` on it either.

/** Routes under /app that are where a failed gate SENDS somebody. They run
 *  authentication and nothing else, or they redirect to themselves. */
export const GATE_DESTINATIONS = [
  "/app/onboarding",
  "/app/screening",
] as const;

/**
 * Account and consent surfaces, which run authentication and nothing else.
 *
 * NOT AN EXEMPTION SO MUCH AS THE OPPOSITE OF A TRAP. These are where somebody
 * goes to inspect or change the very things the gate checks: what they agreed
 * to, who can see their record, what their membership is doing, and how to
 * close the account entirely. Gating them behind those same answers locks a
 * member out of the only controls that would let them act on the gate — a
 * member who revokes consent would be unable to reach the page that shows what
 * they revoked, or the one that closes their account.
 *
 * The first version of this layout did exactly that, and it took a walk through
 * the signed-in routes to notice. §30.6's failure behaviour for a missing
 * consent is "return a consent-required projection", not "make the account
 * unreachable".
 */
export const ACCOUNT_ROUTES = [
  "/app/settings",
  "/app/consent",
  "/app/care-team",
] as const;

/** Routes under /app that are open regardless of account or gate state.
 *
 *  One entry, and it is grounding. The envelope states the same rule for every
 *  failure state: there is no condition in which support is withdrawn. */
export const ALWAYS_OPEN = [
  "/app/ground",
] as const;

export type GateStep = "subscription" | "consent" | "screening" | "profile";

/** Where each failed step sends somebody. */
export const GATE_REDIRECT: Record<GateStep, string> = {
  subscription: "/subscribe",
  consent: "/app/onboarding",
  screening: "/app/screening",
  profile: "/app/onboarding/profile",
};

/** The chain, in order. Order is load-bearing: a member with no subscription is
 *  not asked for consent, and somebody who has not consented is not asked to
 *  complete a screening. */
export const GATE_ORDER: GateStep[] = ["subscription", "consent", "screening", "profile"];

export type GateTreatment = "open" | "authenticate_only" | "full_chain";

/**
 * How the layout should treat a path.
 *
 * Prefix-matched, because `/app/onboarding/profile` is a gate destination for
 * the same reason `/app/onboarding` is, and `/app/screening/fit` is part of the
 * screening a member is being sent to complete.
 */
export function treatmentFor(pathname: string): GateTreatment {
  const under = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  if (ALWAYS_OPEN.some(under)) return "open";
  if (GATE_DESTINATIONS.some(under) || ACCOUNT_ROUTES.some(under)) return "authenticate_only";
  return "full_chain";
}

/**
 * The first step that fails, or null.
 *
 * Takes the answers rather than fetching them: the chain is a decision and the
 * decision is worth testing without a database. The layout does the fetching,
 * and does it in order so a member with no subscription is never queried for a
 * consent they were never going to be asked about.
 */
export function firstFailure(passed: Partial<Record<GateStep, boolean>>): GateStep | null {
  for (const step of GATE_ORDER) {
    if (passed[step] === false) return step;
  }
  return null;
}

/** Where a member should be sent, or null to render. */
export function redirectFor(passed: Partial<Record<GateStep, boolean>>): string | null {
  const failed = firstFailure(passed);
  return failed ? GATE_REDIRECT[failed] : null;
}
