// In-session safety rules (compliance packet 4B). Deterministic — these are
// rules-engine decisions, never model judgment. Tested by tests/safety.test.ts
// (@safety suite); changes here must keep that suite green.

/** Distress rating that pauses processing for grounding + an explicit choice. */
export const SUDS_PAUSE_AT = 8;
/** Distress rating that ends the session outright (stricter than the packet's pause floor). */
export const SUDS_HARD_STOP_AT = 9;
/** Mid-session rise (vs. session start) that triggers the pause flow. */
export const SUDS_RISE_PAUSE = 3;
/** Post-session rating that puts processing modules on a 24h cooldown. */
export const SUDS_COOLDOWN_AT = 8;

/** Session wind-down begins at 35 minutes; hard cap at 45 (packet 4B.3). */
export const SESSION_WINDDOWN_MIN = 35;
export const SESSION_CAP_MIN = 45;
/** Max processing (gated-tier) sessions per 24 hours. */
export const MAX_PROCESSING_PER_24H = Number(process.env.EMDR_MAX_DAILY_PROCESSING ?? 1);

/**
 * The scripted crisis interrupt in companion.ts is versioned so we always
 * know which wording a member saw. Bump on any change to the script.
 * [CLINICAL ADVISOR REQUIRED: current script is v1, pending advisor review.]
 */
export const CRISIS_SCRIPT_VERSION = "crisis-script-v1";

export type SudsDecision = "continue" | "pause" | "hard_stop";

/**
 * Decide what happens after a mid-session distress rating.
 * `trail` is all ratings so far in the session, including `current` last.
 */
export function sudsDecision(trail: number[]): SudsDecision {
  if (trail.length === 0) return "continue";
  const current = trail[trail.length - 1];
  const start = trail[0];
  if (current >= SUDS_HARD_STOP_AT) return "hard_stop";
  if (current >= SUDS_PAUSE_AT) return "pause";
  if (trail.length > 1 && current - start >= SUDS_RISE_PAUSE) return "pause";
  return "continue";
}

/**
 * What a member may choose after stepping out to ground — the one rule for
 * every such choice point (Expansion Handoff Phase 0, "member choice offered
 * at high distress": "fix the rule once, centrally").
 *
 * THE GAP. A distress pause (a rating of 8, or a rise of 3 since the start)
 * showed grounding steps and then "I'm steadier — continue gently", which went
 * straight back into the exercise. Nothing asked how steady. So the choice to
 * continue was offered at exactly the distress that had just paused the
 * session — the member's word that they felt better stood in for the rating
 * the rule is built on. "Ground me" returned the same way.
 *
 * THE RULE. Continuing is offered only on a FRESH rating, taken after
 * grounding, that the session's own rule (`sudsDecision`) would let through
 * with the whole trail behind it — below the pause line, and not risen by the
 * pause amount since the start. Until there is one, the member can rate,
 * stop, or get help. A rating still in the pause band offers more grounding,
 * never "continue". One in the hard-stop band ends the session, as it would
 * anywhere else. Stopping and getting help are always offered: those are the
 * choices that must never be taken away.
 *
 * No new numbers: every threshold is the existing one, reached through
 * `sudsDecision`, so the in-exercise rule and the return rule cannot drift.
 */
export type ReturnChoice = "rate_now" | "continue" | "ground_more" | "stop" | "get_help";

export function choicesAfterGrounding(
  trail: number[],
  recheck: number | null
): { choices: ReturnChoice[]; endSession: boolean } {
  const always: ReturnChoice[] = ["stop", "get_help"];
  if (recheck === null) return { choices: ["rate_now", ...always], endSession: false };
  const decision = sudsDecision([...trail, recheck]);
  if (decision === "hard_stop") return { choices: always, endSession: true };
  if (decision === "pause") return { choices: ["ground_more", ...always], endSession: false };
  return { choices: ["continue", ...always], endSession: false };
}

/** Kill switch (packet 4D): disables NEW session starts globally via env. */
export function sessionsKilled(): boolean {
  return process.env.EMDR_DISABLE_NEW_SESSIONS === "1";
}
