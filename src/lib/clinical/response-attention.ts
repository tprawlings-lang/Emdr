// The non-safety attention signal provider (expansion handoff 02 §11).
//
// §11 asks this handoff to "expose a provider that can emit a non-safety signal
// when repeated recovery burden or repeated adverse response crosses a
// versioned threshold", and leaves the durable contract to handoff 03. So this
// is an interface and a pure computation, with nothing that writes: handoff 03
// owns where a signal goes, and building that here would mean building it twice.
//
// THREE RULES §11 STATES AND THIS FILE MAKES STRUCTURAL.
//
//   IT IS NOT SAFETY. The cross-feature invariant is that "safety authority
//   stays deterministic" and that these features "cannot clear, weaken, bypass
//   or replace the safety engine". Nothing here reads a safety state, and
//   nothing here can produce one — the only thing it emits is an attention
//   signal about a pattern in a response record, at a severity this feature
//   defines for itself.
//
//   ONE DIFFICULT SESSION IS NOT A SIGNAL. §11: "do not turn a single difficult
//   session into a Command Center work item unless existing safety logic
//   already does so." The threshold is the policy's `recoveryBurdenThreshold`,
//   the same number the projection uses to name the pattern — so the signal and
//   the label cannot disagree about what counts as repeated.
//
//   IT DOES NOT DUPLICATE A SAFETY ALERT. §11: "do not duplicate existing
//   hard-stop or urgent safety alerts as response-fingerprint signals." The
//   provider takes the ids of exposures that already produced a safety alert
//   and refuses to raise a signal that rests on those alone. A clinician who
//   has already been told about the hard stop does not need a second telling in
//   different words; what is new here is the REPETITION, and a repetition made
//   only of already-alerted events is not new.

import type { TenantContext } from "../repository";
import { computeFingerprints, type FingerprintSummary } from "./response-fingerprint";
import { RESPONSE_POLICY, type ResponsePolicy } from "./response-fingerprint-policy";

/** What handoff 03 will consume. Deliberately small: an id, what it is about,
 *  why, and the evidence — the same shape a Command Center row needs and no
 *  more, so this can be satisfied without this file learning what a Command
 *  Center is. */
export interface AttentionSignal {
  /** Stable for the same person, intervention and policy, so a consumer can
   *  deduplicate without a store of its own. */
  key: string;
  personId: string;
  definitionId: string;
  displayName: string;
  kind: "repeated_recovery_burden" | "repeated_adverse_response";
  /** The sentence a clinician reads. Describes the record, never the
   *  intervention — the same rule the screens follow. */
  reason: string;
  supportCount: number;
  occurrences: number;
  policyVersion: string;
  /** Instance ids. A signal that cannot open its evidence is a nudge, and a
   *  nudge is what §11's "attention signal" must not degrade into. */
  evidenceIds: string[];
}

export interface AttentionInputs {
  /** Exposures that already produced a safety alert or hard-stop escalation.
   *  Passed IN rather than read here: this module must not be in a position to
   *  query safety state, and a consumer that knows which alerts fired is the
   *  one that can answer honestly. */
  alreadyAlertedInstanceIds?: string[];
  policy?: ResponsePolicy;
  asOf?: string;
}

/**
 * The signals this person's response record currently supports.
 *
 * PURE OVER THE SUMMARIES, so handoff 03 can call it with its own cutoff and
 * get the same answer this screen would show. Emits nothing and stores nothing.
 */
export function signalsFrom(
  summaries: FingerprintSummary[],
  personId: string,
  inputs: AttentionInputs = {}
): AttentionSignal[] {
  const policy = inputs.policy ?? RESPONSE_POLICY;
  const alerted = new Set(inputs.alreadyAlertedInstanceIds ?? []);
  const out: AttentionSignal[] = [];

  for (const s of summaries) {
    if (s.recoveryBurdenCount < policy.recoveryBurdenThreshold) continue;

    // §11's no-duplication rule. If every exposure behind this signal has
    // already produced a safety alert, the clinician has been told; the signal
    // would restate it in this feature's vocabulary and add nothing.
    const unalerted = s.evidence.instanceIds.filter((id) => !alerted.has(id));
    if (unalerted.length === 0) continue;

    out.push({
      key: `${personId}:${s.definition.id}:${policy.version}:recovery_burden`,
      personId,
      definitionId: s.definition.id,
      displayName: s.definition.displayName,
      kind: "repeated_recovery_burden",
      // Reads as a record, not a recommendation. It does not say to stop doing
      // the thing — §6 has no vocabulary for that and neither does this.
      reason:
        `Difficulty in the hours or days after ${s.definition.displayName} has been recorded on ` +
        `${s.recoveryBurdenCount} of ${s.supportCount} exposures. Worth reading alongside the ` +
        `immediate readings rather than instead of them.`,
      supportCount: s.supportCount,
      occurrences: s.recoveryBurdenCount,
      policyVersion: policy.version,
      evidenceIds: s.evidence.instanceIds,
    });
  }

  // Stable ordering: most occurrences first, then by name. A consumer that
  // renders the first N gets the same N on every read.
  out.sort((a, b) => b.occurrences - a.occurrences || a.displayName.localeCompare(b.displayName));
  return out;
}

/** The same thing, loading the summaries. The entry point handoff 03 will
 *  call; `signalsFrom` is the half that is testable without a database. */
export async function attentionSignalsFor(
  ctx: TenantContext, personId: string, inputs: AttentionInputs = {}
): Promise<AttentionSignal[]> {
  const summaries = await computeFingerprints(ctx, personId, {
    asOf: inputs.asOf, policy: inputs.policy,
  });
  return signalsFrom(summaries, personId, inputs);
}
