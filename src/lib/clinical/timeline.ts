// Member timeline for the clinician surface (Phase 4; workflow spec §2).
//
// The timeline IS the event log, not a summary of it. That is why ADR 0010 had
// to come first: a clinical record assembled from mutable current-state rows
// cannot answer "what did Steady know on the 2nd?", and a clinician who cannot
// ask that cannot audit a decision that was made on the 2nd.
//
// Three properties the spec insists on, each enforced here rather than left to
// the UI:
//
//   RECONSTRUCTED HISTORY IS MARKED. Genesis events (payload_version 0,
//   source_system 'backfill') are labelled. A clinician must be able to tell
//   what Steady OBSERVED from what it INFERRED after the fact, because the
//   second is not evidence and should not be weighed as if it were.
//
//   AI OUTPUT IS SEPARATE FROM AUTHORED FACT. Model-produced entries carry a
//   distinct actor type and never merge into the member's own record.
//
//   PROTECTED CONTENT IS NOT ON THE TIMELINE BY DEFAULT. Companion transcripts
//   are governed by the active clinical policy, and an access decision is
//   recorded for every one that is shown.

import { readEvents, type LongitudinalEvent } from "../events";
import { isReconstructed } from "../spine-backfill";
import { activePolicy, companionContentAllowed, type ClinicalPolicy } from "../clinical-policy";

/** The lanes a clinician reads down. Ordered as they are displayed. */
export type TimelineLane =
  | "state"        // daily check-ins
  | "measurement"  // instruments
  | "care"         // sessions
  | "intervention" // practices, lessons
  | "decision"     // unlocks, clinician actions
  | "consent"
  | "safety"       // rules fired, crisis routing
  | "ai";          // model-produced entries, always separate

const LANE_FOR: Record<string, TimelineLane> = {
  "daily_checkin.completed": "state",
  "readiness.recalculated": "state",
  "assessment.scored": "measurement",
  "session.started": "care",
  "session.completed": "care",
  "session.hard_stopped": "care",
  "intervention.assigned": "intervention",
  "intervention.completed": "intervention",
  "intervention.response_recorded": "intervention",
  "lesson.read": "intervention",
  "module_unlock.requested": "decision",
  "module_unlock.decided": "decision",
  "clinician.reviewed": "decision",
  "person.registered": "decision",
  "consent.granted": "consent",
  "consent.withdrawn": "consent",
  "safety_rule.triggered": "safety",
  "safety_state.changed": "safety",
  "crisis.routed": "safety",
  "memory.recorded": "ai",
  "memory.patient_corrected": "ai",
  "inference.produced": "ai",
};

export interface TimelineEntry {
  eventId: string;
  lane: TimelineLane;
  type: string;
  /** When it happened in the world. */
  occurredAt: string;
  /** When Steady learned of it. Differs from occurredAt for ingested or
   *  reconstructed data, and it is the axis a point-in-time view cuts on. */
  recordedAt: string;
  actorType: string;
  actorId: string | null;
  /** A one-line human summary. Never a bare number. */
  headline: string;
  /** Coded detail, safe to display. Never protected content. */
  detail: Record<string, unknown>;
  /** True for genesis events: reconstructed after the fact, not observed. */
  reconstructed: boolean;
  /** True when the entry was produced by a model rather than a person or rule. */
  aiProduced: boolean;
  correlationId: string | null;
}

export interface TimelineOptions {
  /** Reconstruct what was known at this instant. No later fact may appear. */
  asOf?: string;
  lanes?: TimelineLane[];
  limit?: number;
  policy?: ClinicalPolicy;
}

export interface Timeline {
  personId: string;
  entries: TimelineEntry[];
  /** Counts by lane, so a clinician can see what they are not looking at. */
  laneCounts: Record<string, number>;
  reconstructedCount: number;
  /** Entries withheld by the active companion-visibility policy, and why. */
  withheld: { count: number; reason: string };
  policyVersion: string;
  asOf: string | null;
}

/** `${n}` for a number, or a word for a boolean — never a bare score without
 *  its name, because a caseload that says "34" teaches a clinician to trust a
 *  number they cannot interrogate. */
function headlineFor(e: LongitudinalEvent): string {
  const p = e.payload;
  switch (e.event_type) {
    case "daily_checkin.completed":
      return `Check-in — activation ${p.activation}, shutdown ${p.shutdown}, dissociation ${p.dissociation}, sleep ${p.sleepQuality}; routed to ${p.recommendedAction}` +
        (p.harmUrge ? " · HARM URGE" : "") + (p.feelsSafe === false ? " · does not feel safe" : "");
    case "assessment.scored":
      return `${p.instrument} (${p.instrumentVersion}) scored ${p.totalScore}` +
        (Array.isArray(p.riskFlags) && p.riskFlags.length ? ` · flags: ${p.riskFlags.join(", ")}` : "");
    case "session.started":
      return `Session started — ${p.moduleId}${p.focus ? ` · focus: ${p.focus}` : ""}`;
    case "session.completed":
      return `Session completed — ${p.moduleId} · SUDS ${p.preSuds} → ${p.postSuds} (peak ${p.peakSuds})`;
    case "session.hard_stopped":
      return `Session HARD STOP — ${p.moduleId} · ${p.hardStopReason ?? "reason not recorded"} · SUDS ${p.preSuds} → ${p.postSuds} (peak ${p.peakSuds})`;
    case "intervention.completed":
      return `Practice — ${p.interventionId} (${p.interventionType}), ${p.durationSec}s`;
    case "lesson.read":
      return `Lesson read — ${p.lessonId}`;
    case "module_unlock.requested":
      return `Unlock requested — ${p.moduleId}`;
    case "module_unlock.decided":
      return `Unlock ${p.decision} — ${p.moduleId}${p.override ? " (clinician override)" : ""}` +
        (p.decisionReason ? ` · ${p.decisionReason}` : "");
    case "consent.granted":
      return `Consent granted — ${p.scope} (${p.policyVersion})`;
    case "consent.withdrawn":
      return `Consent WITHDRAWN — ${p.scope} (${p.policyVersion})`;
    case "memory.recorded":
      return `Companion remembered — ${p.memoryType}: ${p.key}`;
    case "memory.patient_corrected":
      return `Member corrected a memory — ${p.memoryType}: ${p.key}`;
    case "person.registered":
      return `Registered as ${p.role}`;
    case "crisis.routed":
      return "Crisis routing triggered";
    case "safety_rule.triggered":
      return `Safety rule fired — ${p.ruleId ?? "unnamed"}`;
    default:
      return e.event_type;
  }
}

/** Payload keys that must never reach a clinician surface. The event log does
 *  not carry protected content (ADR 0010 §1), so this is defence in depth
 *  against a future payload that does. */
const NEVER_DISPLAY = new Set(["value", "text", "transcript", "answers", "note_text", "message"]);

function safeDetail(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (NEVER_DISPLAY.has(k)) continue;
    if (k === "projectionId") continue; // internal plumbing, not clinical detail
    out[k] = v;
  }
  return out;
}

/** Assemble a member's timeline from the event log. */
export async function memberTimeline(
  personId: string,
  opts: TimelineOptions = {}
): Promise<Timeline> {
  const policy = opts.policy ?? activePolicy();
  const events = await readEvents({ personId, asOf: opts.asOf });

  const entries: TimelineEntry[] = [];
  let withheld = 0;

  for (const e of events) {
    const lane = LANE_FOR[e.event_type] ?? "decision";

    // Companion memory is patient-memory-zone content. Whether a clinician may
    // see it is a policy decision, not a UI one, and the routine case is the
    // one that must be governed — an escalation grant must never become a
    // reading habit (workflow spec §2).
    if (e.event_type === "memory.recorded" || e.event_type === "memory.patient_corrected") {
      if (!companionContentAllowed("routine", policy)) { withheld++; continue; }
    }

    if (opts.lanes && !opts.lanes.includes(lane)) continue;

    entries.push({
      eventId: e.id,
      lane,
      type: e.event_type,
      occurredAt: e.occurred_at,
      recordedAt: e.recorded_at,
      actorType: e.actor_type,
      actorId: e.actor_id,
      headline: headlineFor(e),
      detail: safeDetail(e.payload),
      reconstructed: isReconstructed(e),
      aiProduced: e.actor_type === "model",
      correlationId: e.correlation_id,
    });
  }

  const laneCounts: Record<string, number> = {};
  for (const en of entries) laneCounts[en.lane] = (laneCounts[en.lane] ?? 0) + 1;

  return {
    personId,
    entries: entries.slice(0, opts.limit ?? entries.length),
    laneCounts,
    reconstructedCount: entries.filter((e) => e.reconstructed).length,
    withheld: {
      count: withheld,
      reason: withheld === 0
        ? ""
        : `${withheld} companion memory entr${withheld === 1 ? "y" : "ies"} withheld by policy ` +
          `"${policy.companionVisibility}" (${policy.version}).`,
    },
    policyVersion: policy.version,
    asOf: opts.asOf ?? null,
  };
}

/** Events that are original evidence — the subset a summary, an outcome, or a
 *  model evaluation may rest on. Reconstructed history is explicitly excluded
 *  (ADR 0010: never presented as original evidence). */
export function originalEvidence(t: Timeline): TimelineEntry[] {
  return t.entries.filter((e) => !e.reconstructed);
}
