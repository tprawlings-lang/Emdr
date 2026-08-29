// The gate_view projection (Web GUI handoff §30.7, page example "Deterministic
// Safety Gate", schema gate_view.v7).
//
// §30.7's states are the contract: continue, pause, block, responded, re-entry.
// Two things it says twice, in different words, because they are the point of
// the whole screen:
//
//   "AI may explain a result. AI cannot make, clear, reverse or override the
//    gate."
//   Acceptance: "No AI authority; support remains reachable on failure."
//
// The page example's copy carries that on the surface — "A direct answer met
// fixed rule S-04. No AI model made or cleared this decision." That sentence is
// not reassurance. A member who believes a model stopped them will argue with
// it, work around it, or distrust the next thing the product says; a member who
// knows a fixed rule stopped them is being told the truth about what happened.
//
// Re-entry is a NEW evaluation, never a button that clears history (§27.5).
// The member can say "I am safe now — check again"; what that does is re-run
// the fixed rules, not dismiss the previous result.

import { activePolicy } from "../clinical-policy";
import { ready, type Envelope, type ProjectionMeta } from "../presentation/envelope";

export const GATE_VIEW_SCHEMA = "gate_view.v7";

/** §30.7's member-facing gate states. `continue` never renders this screen —
 *  it is here so the union matches the architecture rather than the subset the
 *  screen happens to show. */
export type GatePhase = "continue" | "pause" | "block" | "responded" | "re_entry";

export interface GateSupportOption {
  id: string;
  label: string;
  href: string;
  /** The one option that must never depend on a working write path. */
  alwaysAvailable: boolean;
}

export interface GateView {
  phase: GatePhase;
  /** The banner line. Short, and never an apology. */
  headline: string;
  /** What happens next, in the member's terms. */
  explanation: string;
  /** §30.7: the rule identity and version, stated rather than implied. A
   *  member told "a rule stopped this" with no rule is being asked to take it
   *  on faith. */
  rule: { id: string; version: string };
  /** The sentence that says what did NOT make this decision. */
  authorityNote: string;
  options: GateSupportOption[];
  /** Whether "check again" is offered. Absent during a block: re-entry is a
   *  new evaluation and a block has not met its conditions for one. */
  recheckAvailable: boolean;
}

const AUTHORITY_NOTE =
  "A direct answer met a fixed safety rule. No AI model made or cleared this decision.";

/** Support options, in the order a member in distress should meet them.
 *
 *  988 is first and is `alwaysAvailable`: it is a phone number, so it works
 *  when every service behind this screen is down. §20.2 — "support remains
 *  reachable during offline, write failure, and service failure states" — is
 *  only true if the first option needs nothing from us. */
const OPTIONS: GateSupportOption[] = [
  { id: "988", label: "Call or text 988", href: "tel:988", alwaysAvailable: true },
  { id: "crisis", label: "See all crisis resources", href: "/crisis", alwaysAvailable: true },
  { id: "ground", label: "Grounding, one step at a time", href: "/app/ground", alwaysAvailable: true },
];

const COPY: Record<Exclude<GatePhase, "continue">, { headline: string; explanation: string }> = {
  pause: {
    headline: "Safety check — session paused",
    explanation:
      "The session is paused, not ended. Grounding stays open, and you can come back to " +
      "this when you are ready.",
  },
  block: {
    headline: "Safety check — session stopped",
    explanation:
      "Continuing was not the safe choice today. Support is below, and it is the right " +
      "next step rather than a lesser one.",
  },
  responded: {
    headline: "Safety check — response recorded",
    explanation:
      "Someone has recorded a response to this. The session stays closed for now, and " +
      "support stays open.",
  },
  re_entry: {
    headline: "Checking again",
    explanation:
      "The same fixed rules are being evaluated again, with the answers you have just given. " +
      "The earlier result stays on your record either way.",
  },
};

export function buildGateView(args: {
  phase: Exclude<GatePhase, "continue">;
  ruleId: string;
  tenantId: string;
  now?: Date;
}): Envelope<GateView> {
  const policy = activePolicy();
  const now = args.now ?? new Date();
  const meta: ProjectionMeta = {
    schemaVersion: GATE_VIEW_SCHEMA,
    projectionVersion: `${GATE_VIEW_SCHEMA}+${policy.version}`,
    generatedAt: now.toISOString().replace("T", " ").slice(0, 19),
    tenantId: args.tenantId,
    sourceWatermark: null,
    policyVersion: policy.version,
  };

  const copy = COPY[args.phase];
  return ready(meta, {
    phase: args.phase,
    headline: copy.headline,
    explanation: copy.explanation,
    rule: { id: args.ruleId, version: policy.version },
    authorityNote: AUTHORITY_NOTE,
    options: OPTIONS,
    // §27.5: a block does not get a "clear it" control. Re-entry belongs to a
    // pause, where the conditions for re-evaluating are defined.
    recheckAvailable: args.phase === "pause",
  });
}

export class GateViewError extends Error {}

/** The screen's own boundary.
 *
 *  Two failures this refuses, both of which would look fine in review:
 *  a gate that offers no support at all, and a gate whose support all depends
 *  on this system still working. */
export function assertGateSafe(g: GateView): GateView {
  if (g.options.length === 0) {
    throw new GateViewError("a safety gate with no support options is the failure it exists to prevent");
  }
  if (!g.options.some((o) => o.alwaysAvailable)) {
    throw new GateViewError(
      "every support option on this gate depends on a working service. §20.2 requires support " +
      "to remain reachable during offline, write failure and service failure — at least one " +
      "option must need nothing from us."
    );
  }
  if (!/no ai model/i.test(g.authorityNote)) {
    throw new GateViewError(
      "the gate does not state that no model made the decision. §30.7: AI may explain a result, " +
      "it cannot make, clear, reverse or override the gate — and the member is entitled to know that."
    );
  }
  return g;
}
