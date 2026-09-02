import crypto from "crypto";
import type { CohortDefinition } from "@/lib/metrics/cohorts";
import type { Role } from "@/lib/roles";
import { CURRENT_LEVEL, ladder, wordingViolation } from "./ladder";
import {
  BLOCKED_ACTIONS, allowedActions, type ReviewAction, type SignalRouting, type SignalState,
} from "./lifecycle";
import { RULE_VERSION, type RuleId } from "./policy";
import type { RuleOutcome } from "./rules";

// The planning-signal object (handoff 07 §5.4, p49) and p44's detail contract.
//
// p44 fixes one sentence that must appear on every candidate signal, and it is
// the most load-bearing string in this subsystem:
//
//   This is a planning hypothesis based on the stated cohort and data window.
//   It is not a diagnosis, treatment order or proof that the observed factor
//   caused the result.
//
// It is a property of the OBJECT, not a footnote a screen chooses to render.
// Anything that carries a signal — the list, the detail page, the API, the
// lineage response — carries this with it, so a signal pasted into a ticket
// arrives with its own disclaimer attached.

export const REQUIRED_PHRASE =
  "This is a planning hypothesis based on the stated cohort and data window. It is not a " +
  "diagnosis, treatment order or proof that the observed factor caused the result.";

export interface PlanningSignal {
  signal_id: string;
  signal_type: RuleId;
  state: SignalState;
  statement: string;
  /** p36's ladder level, and therefore the wording the statement is held to. */
  evidence_level: number;
  rule_version: string;
  metric_refs: string[];
  cohort_ref: string;
  cohort_hash: string;
  reference_ref: string;
  threshold: Record<string, number>;
  observed: Record<string, number | string | boolean | null>;
  limitations: string[];
  /** Supplied by the SERVER after policy evaluation (p49). The client renders
   *  it; it never computes it and never adds to it. */
  allowed_actions: ReviewAction[];
  blocked_actions: readonly string[];
  clinical_review: ReviewRecord | null;
  fairness_review: ReviewRecord | null;
  audit_ref: string;
  /** p44's required phrase, on the object. */
  required_phrase: string;
  data_version: string;
  detected_at: string;
  /** The demo clock's milestone this was read at, or null when live. Carried
   *  on the object so a signal pasted anywhere says which moment it describes. */
  reading_point: string | null;
}

export interface ReviewRecord {
  by: string;
  role: string;
  at: string;
  comment: string | null;
  limits: string | null;
}

/**
 * Which rules can change what a person is offered.
 *
 * p35's entry condition for Clinical review is "signal may affect program
 * content", and that is a property of the RULE rather than of the reader. A
 * table rather than a heuristic, because "may affect programme content" is a
 * judgement someone made once and should not be re-made per render.
 */
const AFFECTS_PROGRAM_CONTENT: Record<RuleId, boolean> = {
  // Proposes a controlled pilot on a module — the definition of programme
  // content.
  MODULE_SIGNAL: true,
  // Review coverage for fixed safety events. Adjacent enough to care that a
  // clinical reviewer sets the limits before anything is piloted.
  SAFETY_REVIEW_LOAD: true,
  // Stage, channel and owner. Operational routing of outreach, not what a
  // person is offered once they are in.
  ACCESS_GAP: false,
  // Reminder timing and access barriers — the same reasoning.
  FOLLOWUP_GAP: false,
  REGION_CAPACITY: false,
  // Goes to fairness review by its own entry condition, which is a different
  // door.
  FAIRNESS_ALERT: false,
  // Blocks release. It changes nothing about anyone's programme.
  DATA_QUALITY: false,
};

/** Attributes p13 treats as protected, and therefore cohorts whose signals
 *  need fairness review before anything is piloted on them. */
export function cohortIsProtected(c: CohortDefinition): boolean {
  const f = c.filters;
  return Boolean(f.race?.length || f.ethnicity?.length || f.language?.length || f.accessNeed?.length);
}

export function routingFor(ruleId: RuleId, c: CohortDefinition): SignalRouting {
  return {
    affectsProgramContent: AFFECTS_PROGRAM_CONTENT[ruleId],
    protectedGroupImpact: ruleId === "FAIRNESS_ALERT" || cohortIsProtected(c),
  };
}

/**
 * A signal's id, derived rather than generated.
 *
 * Rule, cohort, dataset version and tenant — and NOT the clock. Two things
 * follow. Re-running detection on the same evidence produces the same id, so
 * the insert is idempotent and a reviewer's history stays attached. And a
 * signal is one per rule per cohort per dataset, so an environment that is
 * re-examined every hour does not accumulate a hundred copies of the same
 * finding for someone to triage.
 *
 * p49 prints "sig-demo-0041", which is illustrative — the handoff states no
 * derivation, exactly as it states none for the profile seed on p15. The
 * requirement underneath is that ids are stable within a dataset version, and
 * a written-down formula satisfies it.
 */
export function signalId(
  ruleId: RuleId, cohortId: string, dataVersion: string, tenantId: string,
  readingPoint: string | null = null,
): string {
  const h = crypto.createHash("sha256")
    // The reading point is part of the identity, not a label on it. A signal
    // raised while the demo clock sat at the half year describes a different
    // moment from one raised today, and giving them the same id makes the
    // conflict-do-nothing insert silently keep whichever ran first — with its
    // evidence frozen and nothing on the screen saying it is six months old.
    .update([ruleId, cohortId, dataVersion, tenantId, readingPoint ?? "live"].join(":"))
    .digest("hex").slice(0, 12);
  return `sig-${h}`;
}

export interface BuildArgs {
  outcome: RuleOutcome;
  cohort: CohortDefinition;
  cohortHash: string;
  referenceId: string;
  tenantId: string;
  dataVersion: string;
  detectedAt: string;
  state?: SignalState;
  clinicalReview?: ReviewRecord | null;
  fairnessReview?: ReviewRecord | null;
  /** The demo clock's milestone when the signal was raised, or null for live. */
  readingPoint?: string | null;
  /** Whose action set to compute. p49: the server supplies it, after policy
   *  evaluation, for the caller who is actually asking. */
  role: Role;
  /**
   * Routing, when the caller already knows it and the cohort cannot supply it.
   *
   * This exists for one case, and it is a fail-safe rather than a
   * convenience: a stored signal whose cohort has since left the registry.
   * Derived from the stub cohort, `protectedGroupImpact` would come back
   * FALSE — and a signal would skip fairness review because somebody deleted
   * its definition. The caller passes the safe routing instead.
   */
  routing?: SignalRouting;
}

/**
 * Assemble the object p49 describes.
 *
 * Refuses a statement that overclaims. `wordingViolation` is checked here
 * rather than at render, because by render time the sentence has already been
 * stored, exported and possibly pasted somewhere — and a level-1 signal worded
 * as an effect is precisely the failure p36's ladder exists to prevent. The
 * statements are generated from templates, so a violation is a template bug
 * and throwing is the right response to it.
 */
export function buildSignal(a: BuildArgs): PlanningSignal {
  const level = CURRENT_LEVEL;
  const bad = wordingViolation(a.outcome.statement, level);
  if (bad) {
    throw new Error(
      `${a.outcome.ruleId} produced a statement that breaks p36's release ladder — ${bad}. ` +
      `Level ${level} is "${ladder(level).name}" and permits only "${ladder(level).permittedWording}".`,
    );
  }
  const id = signalId(a.outcome.ruleId, a.cohort.id, a.dataVersion, a.tenantId, a.readingPoint ?? null);
  const state = a.state ?? "draft";
  const routing = a.routing ?? routingFor(a.outcome.ruleId, a.cohort);
  return {
    signal_id: id,
    signal_type: a.outcome.ruleId,
    state,
    statement: a.outcome.statement,
    evidence_level: level,
    rule_version: RULE_VERSION,
    metric_refs: a.outcome.metricRefs,
    cohort_ref: a.cohort.id,
    cohort_hash: a.cohortHash,
    reference_ref: a.referenceId,
    threshold: a.outcome.threshold,
    observed: a.outcome.observed,
    limitations: a.outcome.limitations,
    allowed_actions: allowedActions(state, a.role, routing),
    blocked_actions: BLOCKED_ACTIONS,
    clinical_review: a.clinicalReview ?? null,
    fairness_review: a.fairnessReview ?? null,
    audit_ref: `audit://${id}`,
    required_phrase: REQUIRED_PHRASE,
    data_version: a.dataVersion,
    detected_at: a.detectedAt,
    reading_point: a.readingPoint ?? null,
  };
}
