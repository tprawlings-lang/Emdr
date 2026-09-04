// Treatment Response Fingerprint events (expansion handoff 02 §7).
//
// Separate from the store for the same reason return-to-life-events.ts is: the
// store persists, this records, and an event is emitted only after the write it
// describes has landed. The ledger is append-only and there is no taking back
// an event for a write that failed.
//
// WHAT TRAVELS AND WHAT DOES NOT. These payloads carry ids, classes, window
// types, counts, policy versions and evidence ids — enough to replay which
// pattern was computed from what, under which thresholds, and who reviewed it.
// They carry no clinician wording, no patient words, and no free text from a
// note. §12 of handoff 01 established the rule and it holds here: a second copy
// of protected content in an append-only ledger is a copy retention policy can
// never reach.
//
// AND ONE THING THEY CARRY THAT LOOKS REDUNDANT. `snapshotComputed` carries the
// policy version and the evidence cutoff even though both are columns on the
// snapshot row. §13 requires every pattern summary to be "reproducible from
// evidence + policy version" — and a replay that had to join back to a
// current-state table to learn which thresholds applied would be reproducing
// today's policy, not the one the clinician actually read.

import { appendEventSafe } from "../events";
import type { InstanceSourceType } from "./interventions";

export async function recordInstanceRecorded(args: {
  instanceId: string; tenantId: string; personId: string;
  definitionId: string; sourceType: InstanceSourceType; sourceId: string;
  occurredAt: string; actorId: string | null;
  /** True when this records a clinician accepting the normalization rather
   *  than the exposure first appearing. The two are different acts and a
   *  replay that could not tell them apart could not reconstruct which
   *  identities a person actually agreed to. */
  confirmed?: boolean;
}): Promise<string | null> {
  return appendEventSafe({
    personId: args.personId,
    tenantId: args.tenantId,
    type: "intervention.instance_recorded",
    actorId: args.actorId,
    // An adapter reconstructing history is the system; a clinician confirming
    // or entering one is a clinician. Neither is ever "model": §8 forbids the
    // model minting a clinical identity, so no path here can attribute one to it.
    actorType: args.actorId ? "clinician" : "system",
    occurredAt: args.occurredAt,
    payload: {
      instanceId: args.instanceId,
      definitionId: args.definitionId,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      confirmed: args.confirmed ?? false,
    },
  });
}

export async function recordResponseObserved(args: {
  observationId: string; tenantId: string; personId: string;
  instanceId: string; outcomeType: string; windowType: string;
  evidenceClass: string; sourceType: string; sourceId: string;
  occurredAt: string; actorId: string | null;
  /** "improved" | "worsened" | "unchanged" | null. The DIRECTION travels and
   *  the magnitude does not need to: §6 forbids netting windows against each
   *  other, and a replay that carried one number per instance would be a
   *  replay that had already done the netting. */
  direction: string | null;
}): Promise<string | null> {
  return appendEventSafe({
    personId: args.personId,
    tenantId: args.tenantId,
    type: "intervention.response_observed",
    actorId: args.actorId,
    actorType:
      args.evidenceClass === "patient_report" ? "patient"
      : args.evidenceClass === "clinician_observation" ? "clinician"
      : "system",
    occurredAt: args.occurredAt,
    payload: {
      observationId: args.observationId,
      instanceId: args.instanceId,
      outcomeType: args.outcomeType,
      windowType: args.windowType,
      evidenceClass: args.evidenceClass,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      direction: args.direction,
    },
  });
}

export async function recordSnapshotComputed(args: {
  snapshotId: string; tenantId: string; personId: string;
  definitionId: string; policyVersion: string; evidenceCutoff: string;
  supportCount: number; missingFollowupCount: number; patternState: string;
  evidenceIds: string[];
}): Promise<string | null> {
  return appendEventSafe({
    personId: args.personId,
    tenantId: args.tenantId,
    type: "response_fingerprint.snapshot_computed",
    actorId: null,
    // Deterministic aggregation over evidence. Not a model act, and labelling
    // it one would misplace the accountability for the number.
    actorType: "system",
    payload: {
      snapshotId: args.snapshotId,
      definitionId: args.definitionId,
      policyVersion: args.policyVersion,
      evidenceCutoff: args.evidenceCutoff,
      supportCount: args.supportCount,
      missingFollowupCount: args.missingFollowupCount,
      patternState: args.patternState,
    },
    provenance: { ruleVersion: args.policyVersion, evidenceIds: args.evidenceIds },
  });
}

/** A clinician read a displayed pattern. Recorded because §9 shows patterns to
 *  clinicians and the shared product rule is that the clinician decides what
 *  clinical meaning to accept — which is only auditable if their having looked
 *  is a fact somewhere. */
export async function recordPatternReviewed(args: {
  tenantId: string; personId: string; snapshotId: string;
  definitionId: string; clinicianId: string; decision: string; note?: string | null;
}): Promise<string | null> {
  return appendEventSafe({
    personId: args.personId,
    tenantId: args.tenantId,
    type: "response_fingerprint.pattern_reviewed",
    actorId: args.clinicianId,
    actorType: "clinician",
    payload: {
      snapshotId: args.snapshotId,
      definitionId: args.definitionId,
      decision: args.decision,
      // A short reason is a clinician's own words about their own judgement,
      // not patient content, and the review is not reconstructable without it.
      note: args.note ?? null,
    },
  });
}

/** A normalization or source mapping was corrected. Carries the definition it
 *  moved AWAY from, so the correction supersedes prior derived state without
 *  erasing what Steady used to believe. */
export async function recordPatternCorrected(args: {
  tenantId: string; personId: string; instanceId: string;
  fromDefinitionId: string; toDefinitionId: string;
  clinicianId: string; reason: string | null;
}): Promise<string | null> {
  return appendEventSafe({
    personId: args.personId,
    tenantId: args.tenantId,
    type: "response_fingerprint.pattern_corrected",
    actorId: args.clinicianId,
    actorType: "clinician",
    payload: {
      instanceId: args.instanceId,
      fromDefinitionId: args.fromDefinitionId,
      toDefinitionId: args.toDefinitionId,
      reason: args.reason,
    },
  });
}
