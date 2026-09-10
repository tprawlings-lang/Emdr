// The recovery-trajectory attention provider (expansion handoff 04 §8).
//
// §8 is four bullets and three of them are restrictions:
//
//   "Default signals: persistent reversing state; sustained stall on an active
//    Return-to-Life goal; clinically meaningful slowing across multiple
//    corroborating domains according to policy."
//   "Do not emit work for every stable domain. The Command Center is for
//    action, not chart commentary."
//   "Signal language: 'Recovery trajectory changed in sleep and function across
//    the current review window' rather than 'patient is off track' as an
//    unexplained verdict."
//
// SO THE PROVIDER'S REAL JOB IS SUBTRACTION. The engine computes a state for
// every domain it can — seven or more per person on a full record — and if each
// non-stable one became a row, a caseload of forty would produce a queue nobody
// could read, which is precisely the alert wall the Command Center exists to
// replace. What reaches the queue is narrower than what is displayed, and this
// file is where the narrowing happens and can be argued with.
//
// THE THREE RULES, AS CODE:
//
//   REVERSING is a signal on its own. It already required persistence inside
//   the engine — more than one adverse observation, §4's "one bad day remains
//   one observation" — so a reversal here is not a bad afternoon.
//
//   STALLED is a signal ONLY on an active life goal. §8 says "sustained stall
//   on an active Return-to-Life goal", and the restriction is doing real work:
//   a stalled sleep lane on somebody sleeping fine is a chart observation, and
//   a stalled goal is somebody's life not moving.
//
//   SLOWING is a signal only when domains CORROBORATE — more than one of them,
//   which is what "across multiple corroborating domains" means. One lane
//   easing off is noise at the caseload level.
//
// AND IT CANNOT CREATE SAFETY. Bands here are `review_today` and `follow_up`.
// There is no path from this file to the alerts table, and the contract check
// in tests/command-center-contract.test.ts runs the wording through the same
// authority/directive screen as every other provider.

import { registerProvider, type AttentionSignalProvider } from "./registry";
import type { AttentionSignalCandidate } from "../attention-vocabulary";
import {
  computeTrajectory, TRAJECTORY_POLICY, STATE_LABEL,
  type TrajectorySnapshot,
} from "../recovery-trajectory";

/** How many domains must be slowing together before it is worth a row. One lane
 *  easing off is a chart observation; two or more moving the same way at once
 *  is the "multiple corroborating domains" §8 asks for. */
export const CORROBORATION_THRESHOLD = 2;

/** §8's language rule, applied to a single domain.
 *
 *  Every sentence this provider writes names the domain, the window and what
 *  was compared. None of them grades the person: "off track" and "not
 *  progressing" are verdicts about somebody rather than descriptions of a
 *  record, and a clinician cannot open a verdict. */
function statementFor(s: TrajectorySnapshot, windowDays: number): string {
  const where = `${s.label} (${s.domainType.replace(/_/g, " ")})`;
  switch (s.state) {
    case "reversing":
      return `Recovery trajectory changed in ${where} across the current ${windowDays}-day review window: recent readings moved against the earlier direction on more than one observation.`;
    case "stalled":
      return `${where} has stayed inside a narrow band across the whole ${windowDays * 3}-day review window.`;
    case "slowing":
      return `Favourable movement in ${where} has reduced materially against the window before it.`;
    default:
      return `${where}: ${STATE_LABEL[s.state]}.`;
  }
}

function candidateFor(
  s: TrajectorySnapshot, windowDays: number, extra: string[]
): AttentionSignalCandidate {
  const cited = s.classification.current.evidenceIds.slice(0, 8);
  return {
    type: `trajectory.${s.state}`,
    // One lineage per domain per concern. A domain that reverses, recovers and
    // reverses again is the same concern returning — §12 of handoff 03 wants
    // that as a reopened row rather than as a third one.
    dedupeKey: `trajectory:${s.domainType}:${s.domainKey}`,
    band: s.state === "reversing" ? "review_today" : "follow_up",
    statement: statementFor(s, windowDays),
    changeText: null,
    evidenceIds: cited,
    evidenceType: s.domainType === "function"
      ? "return_goal_observation"
      : s.domainType === "session_recovery" ? "post_session_check" : "longitudinal_event",
    // The cutoff, not a clock: every candidate must cite evidence at or before
    // the cutoff it was evaluated against, and the contract checks it.
    evidenceAt: s.evidenceCutoff,
    limitations: [
      ...s.classification.limitations,
      ...extra,
      // The invariant that outlives any wording review. A trajectory state is a
      // description of readings that arrived together, and the reasons they
      // moved are not in the readings.
      "A change in the readings, not an explanation of it. Steady does not know why this moved.",
    ],
    policyVersion: s.policyVersion,
  };
}

/**
 * §8's narrowing, as a pure function over computed states.
 *
 * SEPARATE FROM `evaluate` ON PURPOSE. What reaches the queue is the part of
 * this provider a reviewer will want to argue with, and a rule that can only be
 * exercised by seeding a database until it happens to produce a slowing domain
 * is a rule nobody checks. Given snapshots, this says which ones become work —
 * so each of §8's three clauses has a test that constructs exactly its case.
 */
export function selectDeviations(snapshots: TrajectorySnapshot[]): AttentionSignalCandidate[] {
  const eligible = snapshots.filter((s) => s.signalEligible);
  const out: AttentionSignalCandidate[] = [];

  const windowDaysFor = (s: TrajectorySnapshot) =>
    TRAJECTORY_POLICY.domains[s.domainType].windowDays;

  for (const s of eligible.filter((x) => x.state === "reversing")) {
    out.push(candidateFor(s, windowDaysFor(s), []));
  }

  // Stalls, only on a life goal. §8's own words, and the narrowing is the
  // point: a stalled measure lane is something to notice while reading the
  // chart, not something to put in a queue of things to do this week.
  for (const s of eligible.filter((x) => x.state === "stalled" && x.domainType === "function")) {
    out.push(candidateFor(s, windowDaysFor(s), []));
  }

  // Slowing, only when it corroborates. One domain easing off does not reach
  // the queue at all — and when several do, each still gets its own row with
  // its own evidence, because collapsing them into one "multiple domains" row
  // would produce a statement whose evidence is four different things.
  const slowing = eligible.filter((x) => x.state === "slowing");
  if (slowing.length >= CORROBORATION_THRESHOLD) {
    const others = (self: TrajectorySnapshot) =>
      slowing.filter((x) => x !== self).map((x) => x.label).join(", ");
    for (const s of slowing) {
      out.push(candidateFor(s, windowDaysFor(s), [
        `Raised because more than one domain slowed in the same period — also ${others(s)}. A single slowing domain does not reach this queue.`,
      ]));
    }
  }

  return out;
}

export const RECOVERY_TRAJECTORY_PROVIDER: AttentionSignalProvider = registerProvider({
  id: "recovery-trajectory-provider",
  version: "1.0.0",
  purpose:
    "Domains whose course has changed: a reversal, a sustained stall on a life goal, or slowing that more than one domain shows at once.",
  async evaluate({ ctx, personId, evidenceCutoff }) {
    const set = await computeTrajectory(ctx, personId, { asOf: evidenceCutoff });
    return selectDeviations(set.snapshots);
  },
});
