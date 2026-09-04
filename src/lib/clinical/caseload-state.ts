// The caseload clinical-state view (expansion handoff 03 §6; Phase 4).
//
// §6 asks a different question from Today: "what is the current shape of my
// whole caseload?" And Phase 4's definition of done names the failure it must
// not have: "caseload has no composite score."
//
// THAT IS THE WHOLE DESIGN CONSTRAINT. The obvious thing to build here is one
// number per person — a recovery score, a health index, a 0-100 — because a
// table of four descriptive states is harder to sort than a table of numbers.
// §23 forbids it outright ("caseload shows patient-specific clinical states
// rather than a universal health/recovery score"), and the reason is that the
// composite would immediately become the thing clinicians read: it compares
// people who are not comparable, it hides which of its inputs moved, and
// nobody can check it.
//
// So each column is its own state, from its own subsystem, in that subsystem's
// own vocabulary, and there is no arithmetic anywhere in this file that
// combines two of them.
//
// FOUR RULES §6 STATES PER COLUMN, EACH MADE STRUCTURAL.
//
//   "Function comes from Return-to-Life... No goal means Not set, not zero."
//   `not_set` is its own state, distinct from `no_evidence` — a person with a
//   goal and no observations is not the same as a person with no goal, and
//   both must be distinguishable from a person who is not moving.
//
//   "Trajectory comes from Handoff 04 and uses descriptive states, not a
//   universal recovery score." Not built. Modelled as unavailable rather than
//   omitted, so the column reads "not computed" instead of blank — a blank cell
//   in a trajectory column reads as "flat".
//
//   "Response... must show supportive/mixed/insufficient evidence honestly."
//   Mapped from §6 of handoff 02's five pattern states, which already enforce
//   the display threshold — so a person under it reads `insufficient`, which is
//   a fact about the record and not about them.
//
//   "Load/Readiness... remains clinician decision support, not a treatment
//   order." Also not built, also modelled rather than omitted.
//
// AND ONE ABOUT ORDER. §6: "default sort is current clinical need. User filters
// do not rewrite server clinical priority semantics." The sort is the caseload
// model's band, which is the same priority the queue uses — a second ordering
// invented here would let the two screens disagree about who matters most.

import type { TenantContext } from "../repository";
import { activePolicy, type ClinicalPolicy } from "../clinical-policy";
import { buildCaseload, type PriorityBand } from "./caseload";
import { listGoals, observationsFor } from "./return-to-life";
import { computeFingerprints, displayable } from "./response-fingerprint";
import { RESPONSE_POLICY } from "./response-fingerprint-policy";
import { GOAL_PROJECTION_VERSION } from "./return-goal-projection";

export const CASELOAD_STATE_VERSION = "caseload-state.1.0.0";

/** §6's function column. Descriptive states, never a score. */
export type FunctionState =
  | "not_set"
  | "no_evidence"
  | "improving"
  | "little_change"
  | "lost_ground";

export const FUNCTION_LABEL: Record<FunctionState, string> = {
  // "Not set", never "0" and never blank. §6 says it outright.
  not_set: "Not set",
  no_evidence: "No evidence yet",
  improving: "Improving",
  little_change: "Little change",
  lost_ground: "Lost ground",
};

/** §6's response column, mapped from handoff 02's five pattern states. */
export type ResponseState = "insufficient" | "supportive" | "mixed" | "burden";

export const RESPONSE_LABEL: Record<ResponseState, string> = {
  insufficient: "Insufficient evidence",
  supportive: "Settling observed",
  mixed: "Mixed",
  burden: "Difficulty afterwards",
};

/** A column with nothing in it, and why. Same discipline as the drawer: a
 *  blank cell and an unbuilt feature must not look alike. */
export interface ColumnAbsent {
  present: false;
  note: string;
}

export interface CaseloadStateRow {
  personId: string;
  displayName: string;
  band: PriorityBand;
  /** The caseload model's own reasons, so the band can be interrogated. §6:
   *  "every label opens evidence, calculation window, limitations, and source
   *  dates." */
  reasons: string[];
  actionable: boolean;

  functionState: FunctionState;
  /** The goal the function state came from, when there is one. */
  functionGoalTitle: string | null;
  functionEvidenceAt: string | null;
  /** What the function state cannot support. */
  functionLimitations: string[];

  responseState: ResponseState;
  responseDetail: string;
  responseEvidenceCount: number;

  trajectory: ColumnAbsent;
  load: ColumnAbsent;

  lastContactDays: number | null;
  openAlerts: number;
}

export interface CaseloadState {
  rows: CaseloadStateRow[];
  computedAt: string;
  policyVersion: string;
  stateVersion: string;
  /** The versions each column was computed under, so a reader can tell which
   *  rules produced which cell (§6: "calculation window, limitations"). */
  columnVersions: { function: string; response: string };
  model: string;
}

/** How many days of goal history the function state looks back over.
 *
 *  A NAMED WINDOW, because §6 requires every label to open its "calculation
 *  window". Ninety days is long enough that a goal moving slowly still reads as
 *  moving, and short enough that progress from six months ago does not keep a
 *  stalled person labelled "improving". */
export const FUNCTION_WINDOW_DAYS = 90;

/**
 * The function state for one goal's accepted observations.
 *
 * COMPARES THE OLDEST AND NEWEST ACCEPTED LEVELS IN THE WINDOW, and nothing
 * else. Not a trend line, not a slope, not a rate — three observations do not
 * support a slope, and a slope is a number that invites being averaged with
 * another one.
 *
 * A single observation is `no_evidence`, not `little_change`: one reading is a
 * position, and calling it "little change" asserts a comparison nobody made.
 */
export function functionStateFrom(
  levels: Array<{ level: number; occurredAt: string }>
): FunctionState {
  if (levels.length === 0) return "no_evidence";
  if (levels.length === 1) return "no_evidence";
  const sorted = [...levels].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const first = sorted[0].level;
  const last = sorted[sorted.length - 1].level;
  if (last > first) return "improving";
  if (last < first) return "lost_ground";
  return "little_change";
}

/**
 * The clinical state of a whole caseload.
 *
 * `personIds` narrows it — that is §3's "clicking [stable] opens filtered
 * Caseload", passed in rather than recomputed here so the Today screen's count
 * and this screen's list cannot disagree about who is stable.
 */
export async function buildCaseloadState(args: {
  clinicianId: string;
  tenantId: string;
  policy?: ClinicalPolicy;
  now?: Date;
  /** Restrict to these people. Undefined means the whole caseload. */
  personIds?: string[];
}): Promise<CaseloadState> {
  const policy = args.policy ?? activePolicy();
  const now = args.now ?? new Date();
  const cutoff = now.toISOString();
  const windowStart = new Date(now.getTime() - FUNCTION_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const caseload = await buildCaseload({
    clinicianId: args.clinicianId, tenantId: args.tenantId, policy,
  });
  const only = args.personIds ? new Set(args.personIds) : null;
  const people = only ? caseload.rows.filter((r) => only.has(r.personId)) : caseload.rows;

  const ctx: TenantContext = { tenantId: args.tenantId, personId: args.clinicianId };
  const rows: CaseloadStateRow[] = [];

  for (const person of people) {
    // ── Function (§6) ─────────────────────────────────────────────────────
    let functionState: FunctionState = "not_set";
    let functionGoalTitle: string | null = null;
    let functionEvidenceAt: string | null = null;
    const functionLimitations: string[] = [];

    const goals = await listGoals(ctx, person.personId, ["active"]);
    if (goals.length > 0) {
      // The goal with the most recent accepted evidence speaks for the column.
      // Not "the best" and not an average across goals — a caseload cell has
      // room for one state, and averaging two goals is the composite score
      // this file exists to refuse, one scale down.
      let best: { title: string; levels: Array<{ level: number; occurredAt: string }> } | null = null;
      for (const goal of goals) {
        const observations = await observationsFor(ctx, goal.id);
        const accepted = observations
          .filter(
            (o) =>
              o.status === "accepted" &&
              o.observedLevel !== null &&
              o.occurredAt <= cutoff &&
              o.occurredAt.slice(0, 10) >= windowStart
          )
          .map((o) => ({ level: o.observedLevel as number, occurredAt: o.occurredAt }));
        const latest = accepted.map((a) => a.occurredAt).sort().pop() ?? null;
        if (!best || (latest && (!functionEvidenceAt || latest > functionEvidenceAt))) {
          best = { title: goal.title, levels: accepted };
          functionEvidenceAt = latest;
        }
      }
      functionGoalTitle = best?.title ?? goals[0].title;
      functionState = functionStateFrom(best?.levels ?? []);
      functionLimitations.push(
        `From accepted evidence in the last ${FUNCTION_WINDOW_DAYS} days on one goal. ` +
        (goals.length > 1
          ? `${goals.length - 1} other active goal${goals.length === 2 ? "" : "s"} are not in this cell.`
          : "Other goals, if any, are not combined into this."),
      );
      if (functionState === "no_evidence") {
        // A goal with one reading or none. §6's "no goal means Not set" has a
        // sibling: one reading is a position, not a direction.
        functionLimitations.push(
          "Fewer than two accepted observations in the window, so there is nothing to compare."
        );
      }
    } else {
      functionLimitations.push("No life goal has been set with this person.");
    }

    // ── Response (§6, from handoff 02) ────────────────────────────────────
    //
    // §6 of handoff 02 already enforces the display threshold, so a person
    // under it lands on `insufficient` — which is a fact about the record, not
    // about them, and the detail says so.
    const fingerprints = await computeFingerprints(ctx, person.personId, { asOf: cutoff });
    const shown = displayable(fingerprints);
    let responseState: ResponseState = "insufficient";
    let responseDetail =
      fingerprints.length === 0
        ? "Nothing recorded about what they have been exposed to."
        : `${fingerprints.length} intervention${fingerprints.length === 1 ? "" : "s"} recorded, none with the ` +
          `${RESPONSE_POLICY.displayThreshold} exposures a pattern needs.`;

    if (shown.length > 0) {
      // The most serious state across the person's interventions, and the
      // ordering is the clinical judgement: difficulty afterwards outranks a
      // settled room, exactly as it does in the pattern-state function it
      // borrows from.
      const states = new Set(shown.map((f) => f.patternState));
      if (states.has("recovery_burden_observed")) {
        responseState = "burden";
        const worst = shown.find((f) => f.patternState === "recovery_burden_observed")!;
        responseDetail = `Difficulty afterwards on ${worst.recoveryBurdenCount} of ${worst.supportCount} ${worst.definition.displayName} exposures.`;
      } else if (states.has("mixed")) {
        responseState = "mixed";
        const m = shown.find((f) => f.patternState === "mixed")!;
        responseDetail = `Windows disagreed on ${m.mixedCount} of ${m.supportCount} ${m.definition.displayName} exposures.`;
      } else {
        responseState = "supportive";
        const s = shown[0];
        responseDetail = `${s.definition.displayName}: settling observed on ${s.supportCount} recorded exposures.`;
      }
    }

    rows.push({
      personId: person.personId,
      displayName: person.displayName,
      band: person.band,
      reasons: person.reasons,
      actionable: person.actionable,
      functionState,
      functionGoalTitle,
      functionEvidenceAt,
      functionLimitations,
      responseState,
      responseDetail,
      responseEvidenceCount: shown.reduce((n, f) => n + f.supportCount, 0),
      trajectory: {
        present: false,
        note: "Not computed — recovery trajectory is not built yet. This is an absent feature, not a flat trajectory.",
      },
      load: {
        present: false,
        note: "Not computed — therapeutic load and readiness are not built yet.",
      },
      lastContactDays: person.daysSinceContact,
      openAlerts: person.openAlerts,
    });
  }

  // §6: "default sort is current clinical need." The caseload model's band, in
  // the model's own order, so this screen and the queue cannot disagree about
  // who matters most. The name is a total tiebreak, so the table is stable.
  const BAND_ORDER: PriorityBand[] = ["immediate", "high", "standard", "watch", "none"];
  rows.sort(
    (a, b) =>
      BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band) ||
      a.displayName.localeCompare(b.displayName)
  );

  return {
    rows,
    computedAt: now.toISOString().replace("T", " ").slice(0, 19),
    policyVersion: policy.version,
    stateVersion: CASELOAD_STATE_VERSION,
    columnVersions: { function: GOAL_PROJECTION_VERSION, response: RESPONSE_POLICY.version },
    model: caseload.model,
  };
}
