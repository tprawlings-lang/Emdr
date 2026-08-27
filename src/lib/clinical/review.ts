// Clinician review actions and feedback (workflow spec §5, §6).
//
// Approve, correct, and override are three different things and are
// deliberately not collapsed into one control:
//
//   APPROVE  — "I have read this and it is accurate." Records review. Changes
//              nothing. Approving an AI summary does not make it evidence; the
//              events remain the evidence and the approval records that a human
//              read it.
//   CORRECT  — "This is wrong." Appends a correcting event that supersedes the
//              original by reference. The original stays visible and marked as
//              superseded. Nothing is ever erased (ADR 0010 §1) — the PHI-lane
//              requirement met structurally rather than by policy.
//   OVERRIDE — "The rule is right in general and wrong here." Requires a
//              reason, relaxes pacing only, and is recorded as a clinician
//              decision. It can never relax a safety stop.
//
// Each produces a distinct audit event, because "the clinician acted" is not a
// reviewable fact — which action they took is.

import { appendEvent } from "../events";
import { audit } from "../audit";
import { activePolicy, type ClinicalPolicy } from "../clinical-policy";

export type ReviewAction = "approve" | "correct" | "override";

/** What a clinician's feedback is about. Structured at the point of capture
 *  because free text cannot be aggregated and a thumbs-down cannot be acted on
 *  (workflow §6). */
export type FeedbackCategory =
  | "accurate"              // matches the evidence
  | "unsupported"           // outruns its citations — the priority defect class
  | "incomplete"            // true but missed something material
  | "miscalibrated"         // right observation, wrong severity
  | "not_clinically_useful" // accurate and beside the point
  | "harmful_if_acted_on";  // would lead to a wrong action

/** Categories with a standing response procedure rather than a backlog ticket. */
export const IMMEDIATE_REVIEW_CATEGORIES: FeedbackCategory[] = ["harmful_if_acted_on"];

export interface ReviewResult {
  action: ReviewAction;
  eventId: string | null;
  /** True when the action changed the clinical record rather than only
   *  recording that a human looked at it. */
  changedRecord: boolean;
}

export class ReviewError extends Error {}

/** Record that a clinician read and accepts something. Changes no record. */
export async function approve(args: {
  clinicianId: string;
  personId: string;
  tenantId: string;
  /** What was reviewed: a summary, a timeline window, an alert. */
  subject: string;
  /** Event ids the reviewed material rested on — so the approval is anchored
   *  to specific evidence rather than to "the screen as it looked". */
  evidenceIds: string[];
  note?: string;
}): Promise<ReviewResult> {
  const eventId = await appendEvent({
    personId: args.personId,
    tenantId: args.tenantId,
    type: "clinician.reviewed",
    payload: {
      subject: args.subject,
      action: "approve",
      evidenceIds: args.evidenceIds,
      note: args.note ?? null,
      policyVersion: activePolicy().version,
    },
    actorId: args.clinicianId,
    actorType: "clinician",
  });

  await audit({
    actorId: args.clinicianId, actorRole: "clinician", family: "specialist_action",
    type: "clinical_review_approved", target: args.personId,
    detail: { subject: args.subject, evidenceCount: args.evidenceIds.length },
  });

  return { action: "approve", eventId, changedRecord: false };
}

/** Correct a recorded fact.
 *
 *  Appends an event that supersedes the original by reference. The original is
 *  not updated and not deleted — a clinician can correct the record; nobody can
 *  make the original disappear. */
export async function correct(args: {
  clinicianId: string;
  personId: string;
  tenantId: string;
  /** The event being corrected. */
  supersedesEventId: string;
  /** Why it was wrong. Required: a correction without a rationale is
   *  indistinguishable from a disagreement, and the record has to carry the
   *  difference. */
  rationale: string;
  /** The corrected values, in the shape of the original payload. */
  correction: Record<string, unknown>;
}): Promise<ReviewResult> {
  const rationale = args.rationale.trim();
  if (rationale.length < 10) {
    throw new ReviewError(
      "A correction requires a rationale. The original stays in the record, so " +
      "the reader needs to know why it was superseded."
    );
  }

  const eventId = await appendEvent({
    personId: args.personId,
    tenantId: args.tenantId,
    type: "clinician.reviewed",
    payload: {
      subject: "record_correction",
      action: "correct",
      rationale,
      correction: args.correction,
      policyVersion: activePolicy().version,
    },
    actorId: args.clinicianId,
    actorType: "clinician",
    supersedesEventId: args.supersedesEventId,
  });

  await audit({
    actorId: args.clinicianId, actorRole: "clinician", family: "clinical",
    type: "clinical_record_corrected", target: args.personId,
    detail: { supersedes: args.supersedesEventId, rationale },
  });

  return { action: "correct", eventId, changedRecord: true };
}

/** What an override may and may not relax.
 *
 *  Pacing only. The daily safety read, cooldowns, caps, and the kill switch
 *  still hold: a clinician can decide someone is ready sooner, and nobody can
 *  override a safety stop. */
export const OVERRIDABLE = ["module_unlock", "readiness_track", "prerequisites"] as const;
export const NEVER_OVERRIDABLE = [
  "daily_checkin_read", "crisis_routing", "cooldown", "daily_cap", "kill_switch", "fitness_screener",
] as const;

export type OverrideTarget = (typeof OVERRIDABLE)[number];

export async function override(args: {
  clinicianId: string;
  personId: string;
  tenantId: string;
  target: string;
  reason: string;
  policy?: ClinicalPolicy;
}): Promise<ReviewResult> {
  const reason = args.reason.trim();
  if (reason.length < 10) {
    throw new ReviewError("An override requires a clinical reason. Every override is auditable for quality review.");
  }
  if ((NEVER_OVERRIDABLE as readonly string[]).includes(args.target)) {
    throw new ReviewError(
      `"${args.target}" cannot be overridden. An override relaxes pacing only — ` +
      "the daily safety read, crisis routing, cooldowns, caps, and the kill switch always hold."
    );
  }
  if (!(OVERRIDABLE as readonly string[]).includes(args.target)) {
    throw new ReviewError(`Unknown override target "${args.target}".`);
  }

  const eventId = await appendEvent({
    personId: args.personId,
    tenantId: args.tenantId,
    type: "clinician.reviewed",
    payload: {
      subject: args.target,
      action: "override",
      reason,
      policyVersion: (args.policy ?? activePolicy()).version,
    },
    actorId: args.clinicianId,
    actorType: "clinician",
  });

  await audit({
    actorId: args.clinicianId, actorRole: "clinician", family: "specialist_action",
    type: "clinical_override", target: args.personId,
    detail: { overrideTarget: args.target, reason },
  });

  return { action: "override", eventId, changedRecord: true };
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export interface FeedbackResult {
  eventId: string | null;
  /** True when this category has a standing response procedure. */
  requiresImmediateReview: boolean;
}

/** Capture structured feedback on an AI-produced artefact.
 *
 *  Links to the generation's provenance so a defect is traceable to a
 *  generator, policy, and retrieval scope — feedback that cannot be attached to
 *  the configuration that produced it teaches nothing. */
export async function recordFeedback(args: {
  clinicianId: string;
  personId: string;
  tenantId: string;
  category: FeedbackCategory;
  subject: string;
  /** Generator/model version, prompt version, retrieval scope. */
  provenance: Record<string, unknown>;
  note?: string;
}): Promise<FeedbackResult> {
  const requiresImmediateReview = IMMEDIATE_REVIEW_CATEGORIES.includes(args.category);

  const eventId = await appendEvent({
    personId: args.personId,
    tenantId: args.tenantId,
    type: "clinician.reviewed",
    payload: {
      subject: args.subject,
      action: "feedback",
      category: args.category,
      note: args.note ?? null,
      requiresImmediateReview,
    },
    actorId: args.clinicianId,
    actorType: "clinician",
    provenance: args.provenance,
  });

  await audit({
    actorId: args.clinicianId,
    actorRole: "clinician",
    // `harmful_if_acted_on` is a safety signal, not a product-quality one, and
    // is filed where safety review will actually look.
    family: requiresImmediateReview ? "safety" : "clinical",
    type: "clinical_feedback",
    target: args.personId,
    detail: { category: args.category, subject: args.subject, requiresImmediateReview },
  });

  return { eventId, requiresImmediateReview };
}
