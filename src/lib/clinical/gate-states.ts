// The gate's vocabulary: its states, their names, and which of them hold.
//
// SEPARATE FROM gate-review.ts BECAUSE OF WHAT THAT MODULE IMPORTS. Deciding a
// gate needs the database; naming one does not. The therapeutic-load policy is
// explicit that it exists "so the words and numbers can be read by a client
// component, a test, and the engine from one place", and pointing it at
// gate-review would have pulled ../data into four client bundles to share a
// four-element list.
//
// ONE LIST, BECAUSE TWO SCREENS DISAGREEING ABOUT IT IS UX 004. Therapeutic
// Load stopped on a held gate and told the clinician to open the safety screen,
// where access is "actually decided"; the safety screen listed alerts, knew
// nothing about gates, and said nothing was pending. Both now ask the same
// question of the same list.

/** §9.1's six member-facing states. Six rather than one, because the six are
 *  what a member can actually act differently on. */
export type GateState =
  | "open"
  | "caution"
  | "limited"
  | "review_needed"
  | "safety_stop"
  | "unknown";

/** What each state is called on screen.
 *
 *  Here rather than in the drawer that used to hold it privately: the name of a
 *  state is a fact about the domain, and a second screen needing one was
 *  otherwise a second set of words for the same six values. */
export const GATE_STATE_LABEL: Record<GateState, string> = {
  open: "Open",
  caution: "Caution",
  limited: "Limited",
  review_needed: "Review needed",
  safety_stop: "Safety stop",
  unknown: "Unknown",
};

/** The states in which a gate is holding something.
 *
 *  Everything that is not `open` or `caution`. `caution` is an open state with
 *  gentler framing, and counting it as a hold would make almost every
 *  stabilization day read as one — which teaches a clinician that "held" means
 *  very little.
 *
 *  `unknown` IS a hold, and that is a judgement worth stating: it means access
 *  could not be confirmed, and an unconfirmable safety picture is unresolved. */
export const HOLDING_GATE_STATES = ["limited", "review_needed", "safety_stop", "unknown"] as const;

export function gateHolds(state: GateState): boolean {
  return (HOLDING_GATE_STATES as readonly string[]).includes(state);
}
