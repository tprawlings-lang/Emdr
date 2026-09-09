// The therapeutic-load attention provider (expansion handoff 05 §9).
//
// §9 is four bullets and three of them are about NOT sending work:
//
//   "Create a review_today signal for a new persistent stabilize state when not
//    already represented by a safety alert."
//   "Create a follow_up/review signal for a new consider_progression state only
//    when clinician policy says a review is useful. Do not nag on every
//    recomputation."
//   "Deduplicate against existing safety hard stops and unresolved
//    post-session alerts."
//
// THREE STATES NEVER REACH THE QUEUE AT ALL, and one of them is the one that
// looks most urgent. `blocked_by_safety` produces nothing here — §1's authority
// boundary means the safety engine has already raised whatever it raises, and a
// second row saying "this person is blocked" would be this feature borrowing
// the authority it is explicitly denied. `insufficient_data` produces nothing
// because a thin record is not a finding about a person. `maintain` produces
// nothing because it is the ordinary case.
//
// SO WHAT IS LEFT IS TWO ROWS, AND BOTH ARE INVITATIONS TO READ. §1 again:
// "consider progression" means "there is enough favourable evidence for a
// clinician to review whether the next step is appropriate," not "progress the
// patient" — so the statement says review, and the contract's directive-word
// check in tests/command-center-contract.test.ts is run against it like every
// other provider's.
//
// AND THE DEDUPLICATION IS REAL, NOT COSMETIC. A person with an open safety
// alert already has a row in the clinician's queue about the thing that matters
// most; adding "worth reviewing whether to reduce load" beside it is the alert
// wall rebuilt one band lower, which is what the Command Center exists to
// replace.

import { registerProvider, type AttentionSignalProvider } from "./registry";
import type { AttentionSignalCandidate } from "../attention-vocabulary";
import {
  computeTherapeuticLoad, THERAPEUTIC_LOAD_POLICY,
  type LoadSnapshot,
} from "../therapeutic-load";
import { mayEnterTaskQueue, THERAPEUTIC_LOAD_REVIEW } from "../clinical-review-gate";

/**
 * The two states that may become work, and the band each claims.
 *
 * `stabilize` is `review_today`: the evidence says the work is costing this
 * person more than it is returning, and that is worth reading before the next
 * appointment. `consider_progression` is `follow_up`: nothing is wrong, and
 * something is worth a look when there is time. Neither is `review_now` — §2 of
 * handoff 03 requires that non-safety review_now "cannot masquerade as safety",
 * and a load reading is the last thing that should be trying to.
 */
const BAND_FOR: Partial<Record<LoadSnapshot["state"], "review_today" | "follow_up">> = {
  stabilize: "review_today",
  consider_progression: "follow_up",
};

/** §9's wording, per state. Every sentence describes evidence and asks for a
 *  review; none of them tells a clinician what to do with a patient. */
function statementFor(snapshot: LoadSnapshot): string {
  if (snapshot.state === "stabilize") {
    const named = snapshot.load
      .filter((d) => d.reading === "high")
      .map((d) => d.label.toLowerCase());
    return (
      `Recovery after recent sessions shows repeated burden — ${named.join("; ")} — with limited evidence that it is being tolerated. ` +
      "Worth reading before the next appointment."
    );
  }
  const named = snapshot.capacity
    .filter((d) => d.reading === "supportive")
    .map((d) => d.label.toLowerCase());
  return (
    `Recovery after the recent sessions has been favourable and nothing in the broader course is deteriorating — ${named.join("; ")}. ` +
    "There is enough evidence here for a review of whether the next step fits."
  );
}

export const THERAPEUTIC_LOAD_PROVIDER: AttentionSignalProvider = registerProvider({
  id: "therapeutic-load-provider",
  version: "1.0.0",
  purpose:
    "Repeated recovery burden with thin evidence of tolerating it, or repeated favourable recovery worth a review. Never a safety state and never a treatment instruction.",
  async evaluate({ ctx, personId, evidenceCutoff }) {
    // HELD UNTIL A CLINICAL REVIEW (handoff 09 §10.1). Therapeutic Load "may
    // plug into the clinician task-provider contract AFTER its own clinical
    // review" — the review that establishes a clinician may act on these
    // readings. That review has not happened, and nothing in this repository
    // records it. This provider was registered with no gate at all, so both
    // states were reaching a clinician's queue as work while the ratifying
    // review had not been done.
    //
    // The gate sits BEFORE the snapshot is computed: a held feature should not
    // be doing the work either.
    //
    // The Load SCREEN is unaffected and deliberately so. §10.1 gates the
    // task-provider contract — the thing that turns a reading into a row in
    // somebody's queue — which is the difference between a clinician choosing
    // to look and a clinician being told to.
    if (!mayEnterTaskQueue(THERAPEUTIC_LOAD_REVIEW)) return [];

    const snapshot = await computeTherapeuticLoad(ctx, personId, { asOf: evidenceCutoff });
    return selectLoadSignals(snapshot);
  },
});

/**
 * §9's narrowing, as a pure function over a computed snapshot.
 *
 * Separate from `evaluate` for the same reason the trajectory provider's is:
 * the deduplication against safety is the part a reviewer will want to argue
 * with, and a rule that can only be exercised by seeding a database until a
 * person happens to have both an open alert and a stabilize reading is a rule
 * nobody checks.
 */
export function selectLoadSignals(snapshot: LoadSnapshot): AttentionSignalCandidate[] {
  const band = BAND_FOR[snapshot.state];
  if (!band) return [];

  // §9's deduplication. A person whose safety picture is already producing work
  // does not need a second, quieter row about the same week — and a
  // `blocked_by_safety` snapshot never gets this far, because it has no band.
  if (snapshot.safetyConstraint !== null) return [];

  const evidenceIds = (snapshot.state === "stabilize" ? snapshot.load : snapshot.capacity)
    .filter((d) => d.reading === (snapshot.state === "stabilize" ? "high" : "supportive"))
    .flatMap((d) => d.evidenceIds)
    .slice(0, 8);

  return [{
    type: `therapeutic_load.${snapshot.state}`,
    // ONE LINEAGE FOR THE WHOLE FEATURE, deliberately not per state. §9: "do
    // not nag on every recomputation", and §12 of handoff 03 wants a concern
    // that changes to UPDATE its row rather than open a second one. A person
    // who moves from stabilize to consider_progression and back has had one
    // conversation with this feature, not three.
    dedupeKey: "therapeutic_load",
    band,
    statement: statementFor(snapshot),
    changeText: null,
    evidenceIds,
    evidenceType: "post_session_check",
    evidenceAt: snapshot.evidenceCutoff,
    limitations: [
      ...snapshot.limitations,
      // The sentence that must survive any wording review, and the reason this
      // provider is allowed to exist at all.
      "Decision support, not a treatment decision. Nothing has been unlocked, scheduled, or changed, and access is decided by the safety engine on its own rules.",
    ],
    policyVersion: snapshot.policyVersion,
  }];
}

export { THERAPEUTIC_LOAD_POLICY };
