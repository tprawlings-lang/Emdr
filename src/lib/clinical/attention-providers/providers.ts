// The providers that ship with this handoff (expansion handoff 03 §10).
//
// Each wraps a subsystem that already computes something honestly and turns it
// into review-worthiness. None of them computes clinical meaning of its own —
// that would be a second implementation of a threshold the subsystem already
// owns, and the two would eventually disagree about the same person.
//
// SO EVERY PROVIDER HERE IS THIN ON PURPOSE. It maps, it cites, it names a
// band, and it stops. The interesting judgements — how long is a stall, how
// many exposures is a pattern, what counts as a gap — live where they were
// made, under their own versioned policy, and travel here as facts.
//
// AND NONE OF THEM PREDICTS. §10's engagement provider is specified as
// "observed gap only. Never predicted disengagement." That restriction reads
// like it is about one provider and it is really about all of them: a queue
// built from what happened is a queue a clinician can check; a queue built from
// what a model expects is one they can only trust or ignore.

import { registerProvider, type AttentionSignalProvider } from "./registry";
import type { AttentionSignalCandidate } from "../attention-signals";
import { attentionSignalsFor } from "../response-attention";
import { RESPONSE_POLICY } from "../response-fingerprint-policy";
import { goalProjection, goalSignals, GOAL_PROJECTION_VERSION, STALL_DAYS } from "../return-goal-projection";
import { openFollowUps } from "../followups";
import { data } from "../../data";

// ---------------------------------------------------------------------------
// Response fingerprint (handoff 02 §11)
// ---------------------------------------------------------------------------

/**
 * Repeated recovery burden, from the Treatment Response Fingerprint.
 *
 * Handoff 02 §11 built the provider interface and left the durable contract to
 * this handoff; this is where the two meet. The threshold, the wording and the
 * de-duplication against already-alerted exposures are all the fingerprint's —
 * `attentionSignalsFor` is the whole computation and this function only decides
 * which band it lands in.
 *
 * `review_today`, NOT `review_now`. A pattern of difficulty after sessions is a
 * thing to read before the next appointment, not a thing to interrupt a day
 * for; §11 of handoff 02 is explicit that a single difficult session must not
 * become a work item, and treating the repeated case as urgent would rebuild
 * the alert wall one band lower.
 */
export const RESPONSE_FINGERPRINT_PROVIDER: AttentionSignalProvider = registerProvider({
  id: "response-fingerprint-provider",
  version: "1.0.0",
  purpose: "Repeated difficulty in the hours or days after a recorded intervention.",
  async evaluate({ ctx, personId, evidenceCutoff }) {
    const signals = await attentionSignalsFor(ctx, personId, { asOf: evidenceCutoff });
    return signals.map((s): AttentionSignalCandidate => ({
      type: s.kind,
      // The fingerprint's own key already carries person, intervention and
      // policy version, which is exactly what one lineage per concern needs.
      dedupeKey: `response:${s.definitionId}`,
      band: "review_today",
      statement: s.reason,
      changeText: null,
      evidenceIds: s.evidenceIds,
      evidenceType: "intervention_instance",
      evidenceAt: evidenceCutoff,
      limitations: [
        `Observed across ${s.supportCount} recorded exposure${s.supportCount === 1 ? "" : "s"}. ` +
        "An association in the record, not a claim about cause.",
      ],
      policyVersion: s.policyVersion,
    }));
  },
});

// ---------------------------------------------------------------------------
// Return-to-Life (handoff 01 §9)
// ---------------------------------------------------------------------------

/** Which band a goal signal claims. A stalled goal and a reversal are things to
 *  read today; suggestions waiting on a clinician are a follow-up, because
 *  nothing has changed about the person — something is waiting on the reader. */
const GOAL_BAND = {
  stall: "review_today",
  reversal: "review_today",
  awaiting_review: "follow_up",
} as const;

export const RETURN_TO_LIFE_PROVIDER: AttentionSignalProvider = registerProvider({
  id: "return-to-life-provider",
  version: "1.0.0",
  purpose: "Life goals that have stalled, reversed, or have evidence waiting on review.",
  async evaluate({ ctx, personId, evidenceCutoff }) {
    const set = await goalProjection(ctx, personId, {
      now: new Date(evidenceCutoff), asOf: evidenceCutoff,
    });
    const signals = goalSignals(set, new Date(evidenceCutoff), STALL_DAYS);
    return signals.map((s): AttentionSignalCandidate => ({
      type: `return_goal.${s.kind}`,
      dedupeKey: `goal:${s.goalId}:${s.kind}`,
      band: GOAL_BAND[s.kind],
      statement: s.reason,
      changeText: null,
      evidenceIds: s.citations,
      evidenceType: "return_goal_observation",
      evidenceAt: s.occurredAt,
      limitations:
        s.citations.length === 0
          ? ["Nothing has been recorded against this goal to open — the signal is the absence."]
          : [],
      policyVersion: GOAL_PROJECTION_VERSION,
    }));
  },
});

// ---------------------------------------------------------------------------
// The clinician's own follow-ups
// ---------------------------------------------------------------------------

/**
 * Obligations the clinician wrote for themselves.
 *
 * These are the one kind of signal that is not derived from anything: a person
 * decided, in their own words, that they wanted to come back to something. §10
 * calls them "clinician-authored obligations", and they carry no limitation
 * text because there is nothing about them to qualify — a clinician's own note
 * needs no confidence interval.
 */
export const EXPLICIT_FOLLOWUP_PROVIDER: AttentionSignalProvider = registerProvider({
  id: "explicit-followup-provider",
  version: "1.0.0",
  purpose: "Follow-ups the clinician approved for themselves.",
  async evaluate({ ctx, personId, evidenceCutoff }) {
    const followUps = await openFollowUps(ctx, { personId, now: new Date(evidenceCutoff) });
    return followUps.map((f): AttentionSignalCandidate => ({
      type: "clinician_followup",
      dedupeKey: `followup:${f.itemId}`,
      band: "follow_up",
      statement: `You wanted to revisit: ${f.text}`,
      changeText: null,
      evidenceIds: [f.itemId],
      evidenceType: "clinical_memory_item",
      evidenceAt: f.approvedAt,
      limitations: [],
      policyVersion: "clinician-followup.1.0.0",
    }));
  },
});

// ---------------------------------------------------------------------------
// Engagement gap
// ---------------------------------------------------------------------------

/** How long without a check-in before it is worth a clinician's notice.
 *
 *  A number, in one place, and it is not a prediction. §10: "observed gap only.
 *  Never predicted disengagement." Fourteen days is long enough that an
 *  ordinary bad fortnight does not raise it and short enough that a person
 *  drifting out of contact is noticed before the next appointment. */
export const ENGAGEMENT_GAP_DAYS = 14;
export const ENGAGEMENT_POLICY_VERSION = "engagement-gap.1.0.0";

export const ENGAGEMENT_GAP_PROVIDER: AttentionSignalProvider = registerProvider({
  id: "engagement-gap-provider",
  version: "1.0.0",
  purpose: "An observed gap since the last check-in. Never a prediction about who will disengage.",
  // No `ctx`: `checkins` is a legacy user-scoped table, not a repository one,
  // so this reads through the unscoped client filtered by person — the same
  // path session-response.ts takes. The person is already the caseload model's
  // decision by the time a provider is asked about them.
  async evaluate({ personId, evidenceCutoff }) {
    const c = await data();
    const row = (await c.get(
      `SELECT id, checkin_date FROM checkins
        WHERE user_id = ? AND checkin_date <= ?
        ORDER BY checkin_date DESC LIMIT 1`,
      [personId, evidenceCutoff.slice(0, 10)]
    )) as { id: string; checkin_date: string } | undefined;

    // NO CHECK-IN EVER IS NOT A GAP. A person who has never checked in has a
    // record that has not started, and calling that disengagement would file
    // "we have no data" under "they are pulling away" — the cross-feature
    // invariant that missing data stays missing.
    if (!row) return [];

    const days = Math.floor(
      (Date.parse(`${evidenceCutoff.slice(0, 10)}T00:00:00Z`) -
        Date.parse(`${row.checkin_date}T00:00:00Z`)) / 86_400_000
    );
    if (!Number.isFinite(days) || days < ENGAGEMENT_GAP_DAYS) return [];

    return [{
      type: "engagement_gap",
      dedupeKey: "engagement:gap",
      band: "watch",
      // "Has not" and not "stopped". §2's display rule for waiting rows is that
      // "patient silence is not noncompliance", and the same is true of a gap:
      // this is a fact about the record, and the reasons for it are the
      // clinician's to find out.
      statement: `No check-in for ${days} days. Their last one was ${row.checkin_date}.`,
      changeText: null,
      evidenceIds: [row.id],
      evidenceType: "checkin",
      evidenceAt: `${row.checkin_date} 00:00:00`,
      limitations: [
        "An observed gap, not a prediction. Steady does not know why somebody stopped checking in.",
      ],
      policyVersion: ENGAGEMENT_POLICY_VERSION,
    }];
  },
});

/** Re-exported so the response provider's policy version is greppable from the
 *  registry side as well as from the fingerprint side. */
export { RESPONSE_POLICY };
