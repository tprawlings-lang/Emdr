// The clinician-assigned lane (Handoff 10 §6; rows CV10_E01 to E05). Built
// ahead of its gate on the product owner's instruction, for a team to review
// and test; outside the demo it is absent, because its rows are unsigned.
//
// NOT A SECOND MODULE PLATFORM. An assignment is a row in the existing
// `support_assignments` (clinical/assigned-support.ts), made through the same
// Assign support form; this file adds what §6 asks on top of it:
//
//   - Never listed without a live assignment, and a deep link without one is
//     "not available". An expired assignment cannot be started.
//   - An assignment is necessary, never sufficient: every start asks the
//     existing safety engine (steady tier, no crisis today, no dissociation
//     hold) and stores what it said. Nothing here re-implements a safety rule.
//   - Distress 0 to 10 before every run and after it. A rise of 3 or more, or
//     an after above 7, shows grounding and SOS and puts an alert on the
//     assigning clinician's queue.
//   - Stop is on every step and costs nothing: a stopped run is a status, not
//     a mark against anyone.
//   - What is written is encrypted and readable by the member and the
//     clinician who assigned it, and nobody else. The companion cannot reach
//     any of it (tests/companion-excludes-assigned.test.ts).
//   - Every piece of free text runs the crisis pre-filter first (CV10_A15);
//     a match saves nothing, ends the run as a policy hard stop, and routes
//     to the crisis page. Whether that is right for exposure writing is a
//     question on the partner's worksheet.

import { data } from "./data";
import { newId } from "./db";
import { audit } from "./audit";
import { encryptField, decryptField } from "./crypto";
import { appendEventSafe, type EventType } from "./events";
import { createAlert } from "./clinical/alert-create";
import { contentVisibility, draftsVisible, type ContentVisibility } from "./content-signoff";
import { screenMemberText, FREE_TEXT_MAX } from "./program-activities";
import { AccessTier } from "./safety/types";
import { SAFETY_CONFIG_VERSION } from "./safety/governance";
import {
  DISTRESS_CEILING_FLAG, DISTRESS_RISE_FLAG, getLaneModule, LANE_MIN_TIER, LANE_MODULES,
  type LaneModule, type LaneStep,
} from "./content/h10-assigned-lane";

export { LANE_MODULES, getLaneModule } from "./content/h10-assigned-lane";

// ── The rules, pure ──────────────────────────────────────────────────────────

/** Handoff 03 §10. The model cannot invoke or override it. */
export interface ModuleGateDecision {
  allowed: boolean;
  decisionId: string;
  policyVersion: string;
  reasonCodes: string[];
  permittedAlternativeModuleIds: string[];
}

export type LaneReason =
  | "not_signed" | "no_active_assignment" | "expired" | "content_not_supplied"
  | "tier_below_steady" | "crisis_today" | "high_dissociation" | "engine_unreadable";

/** Where to go instead: the grounding skills that open at any level. */
export const LANE_ALTERNATIVES = ["skill-orient-room", "skill-contact-points"] as const;

export interface LaneGateInputs {
  signed: boolean;
  assignment: { live: boolean; expired: boolean } | null;
  hasContent: boolean;
  /** Null when the engine could not be read: that is not a yes. */
  engine: { tier: AccessTier; categories: readonly string[]; ruleIds?: readonly string[] } | null;
}

/** A dissociation hold, from the instrument rules or today's check-in. */
const isDissociationHold = (e: NonNullable<LaneGateInputs["engine"]>) =>
  e.categories.includes("dissociation") || (e.ruleIds ?? []).some((id) => /^DAILY_DISSOCIATION_|^SESSION_DISSOCIATION/.test(id));

/** Pure. Every reason that applies, in a fixed order, so the first is the
 *  one to show and the rest are on the record. */
export function laneReasons(i: LaneGateInputs): LaneReason[] {
  // Without a live assignment nothing else is asked or said: the lane does
  // not exist for this person, and its gate's other answers are not theirs.
  if (!i.assignment || (!i.assignment.live && !i.assignment.expired)) return ["no_active_assignment"];
  if (i.assignment.expired) return ["expired"];
  const out: LaneReason[] = [];
  if (!i.signed) out.push("not_signed");
  if (!i.hasContent) out.push("content_not_supplied");
  if (i.engine === null) out.push("engine_unreadable");
  else {
    if (i.engine.categories.includes("crisis")) out.push("crisis_today");
    if (isDissociationHold(i.engine)) out.push("high_dissociation");
    if (i.engine.tier < LANE_MIN_TIER) out.push("tier_below_steady");
  }
  return out;
}

/** Pure. E01's flag: after exceeds before by 3 or more, or exceeds 7. */
export function distressFlag(before: number, after: number | null | undefined): boolean {
  if (after === null || after === undefined) return false;
  return after - before >= DISTRESS_RISE_FLAG || after > DISTRESS_CEILING_FLAG;
}

const rating = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10 ? v : null;

// ── Reading the member's standing ────────────────────────────────────────────

async function signoffs() {
  try {
    const { getRuleSignoffs } = await import("./safety/signoff");
    return await getRuleSignoffs();
  } catch {
    return new Map();
  }
}

/** Whether the lane module is visible at all: live when its rows are agreed,
 *  a draft in the demo, otherwise absent. */
export async function laneVisibility(mod: LaneModule): Promise<ContentVisibility> {
  return contentVisibility(mod, await signoffs());
}

/** The steps a member works through: the partner's, or in the demo the
 *  labelled placeholders. Null when neither exists. */
export function laneSteps(mod: LaneModule, demo: boolean = draftsVisible()): readonly LaneStep[] | null {
  if (mod.content && mod.content.length > 0) return mod.content;
  return demo ? mod.demoPlaceholder : null;
}

async function tenantOf(userId: string): Promise<string | null> {
  const c = await data();
  const row = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [userId])) as { tenant_id: string } | undefined;
  return row?.tenant_id ?? null;
}

export interface LaneAssignment {
  id: string;
  moduleId: string;
  assignedBy: string;
  assignedByName: string;
  explanation: string;
  status: string;
  expiresAt: string | null;
  reviewAt: string | null;
  live: boolean;
  expired: boolean;
}

const stamp = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);

/** One lane assignment, if it is this member's. Anything else — another
 *  member's, a wellness module, an id that never existed — is null, the same
 *  answer for all of them so a guessed id reveals nothing. */
export async function laneAssignment(userId: string, assignmentId: string, now = new Date()): Promise<LaneAssignment | null> {
  const c = await data();
  const row = (await c.get(
    `SELECT a.id, a.support_id, a.assigned_by, a.patient_explanation, a.status, a.expires_at, a.review_at,
            u.name AS assigned_by_name
       FROM support_assignments a LEFT JOIN users u ON u.id = a.assigned_by
      WHERE a.id = ? AND a.person_id = ?`,
    [assignmentId, userId]
  )) as Record<string, string | null> | undefined;
  if (!row || !getLaneModule(String(row.support_id))) return null;
  const expired = row.status === "active" && Boolean(row.expires_at && stamp(now) > row.expires_at);
  return {
    id: String(row.id), moduleId: String(row.support_id), assignedBy: String(row.assigned_by),
    assignedByName: row.assigned_by_name ?? "your clinician", explanation: String(row.patient_explanation),
    status: String(row.status), expiresAt: row.expires_at, reviewAt: row.review_at,
    live: row.status === "active" && !expired, expired,
  };
}

/** The member's live lane assignments — the only way the lane is listed. */
export async function liveLaneAssignments(userId: string, now = new Date()): Promise<LaneAssignment[]> {
  const c = await data();
  const ids = (await c.all(
    `SELECT id FROM support_assignments WHERE person_id = ? AND status = 'active'
      AND support_id IN (${LANE_MODULES.map(() => "?").join(",")}) ORDER BY created_at DESC`,
    [userId, ...LANE_MODULES.map((m) => m.moduleId)]
  )) as { id: string }[];
  const out: LaneAssignment[] = [];
  for (const { id } of ids) {
    const a = await laneAssignment(userId, id, now);
    const mod = a && getLaneModule(a.moduleId);
    if (a && a.live && mod && (await laneVisibility(mod)) !== "absent") out.push(a);
  }
  return out;
}

/** Ask the gate. Stored with every run as its snapshot. */
export async function laneGate(userId: string, assignmentId: string, now = new Date()): Promise<{
  decision: ModuleGateDecision; assignment: LaneAssignment | null; module: LaneModule | null;
}> {
  const assignment = await laneAssignment(userId, assignmentId, now);
  const mod = assignment ? getLaneModule(assignment.moduleId) ?? null : null;
  let engine: LaneGateInputs["engine"] = null;
  try {
    const { decideAccess } = await import("./safety/decide");
    const d = await decideAccess(userId, now.getTime());
    engine = { tier: d.tier, categories: d.hits.map((h) => h.category), ruleIds: d.hits.map((h) => h.id) };
  } catch {
    engine = null;
  }
  const reasons = laneReasons({
    signed: mod ? (await laneVisibility(mod)) !== "absent" : false,
    assignment: assignment ? { live: assignment.live, expired: assignment.expired } : null,
    hasContent: mod ? laneSteps(mod) !== null : false,
    engine,
  });
  return {
    decision: {
      allowed: reasons.length === 0, decisionId: newId(), policyVersion: SAFETY_CONFIG_VERSION,
      reasonCodes: reasons, permittedAlternativeModuleIds: reasons.length === 0 ? [] : [...LANE_ALTERNATIVES],
    },
    assignment, module: mod,
  };
}

// ── Runs ─────────────────────────────────────────────────────────────────────

export class LaneRefused extends Error {
  constructor(public readonly code: LaneReason | "no_run" | "not_a_step" | "choose_distress" | "not_yours") { super(code); }
}

export type RunStatus = "started" | "completed" | "stopped_by_patient" | "hard_stopped_by_policy";

interface RunRow {
  id: string; person_id: string; tenant_id: string; assignment_id: string; module_id: string; module_version: string;
  status: RunStatus; distress_before: number; distress_after: number | null; started_at: string; ended_at: string | null;
}

async function ownRun(userId: string, runId: string): Promise<RunRow> {
  const c = await data();
  const run = (await c.get("SELECT * FROM intervention_runs WHERE id = ? AND person_id = ?", [runId, userId])) as RunRow | undefined;
  if (!run) throw new LaneRefused("no_run");
  return run;
}

async function laneEvent(userId: string, tenantId: string, type: EventType, payload: Record<string, unknown>): Promise<void> {
  await appendEventSafe({ personId: userId, tenantId, type, actorType: "patient", actorId: userId, payload });
}

/** Start a run: the gate first, then the distress rating before. */
export async function startLaneRun(userId: string, assignmentId: string, distressBefore: unknown): Promise<string> {
  const before = rating(distressBefore);
  if (before === null) throw new LaneRefused("choose_distress");
  const { decision, assignment, module: mod } = await laneGate(userId, assignmentId);
  if (!decision.allowed || !assignment || !mod) throw new LaneRefused((decision.reasonCodes[0] as LaneReason) ?? "no_active_assignment");
  const tenantId = (await tenantOf(userId))!;
  const c = await data();
  const id = newId();
  const at = stamp(new Date());
  await c.run(
    `INSERT INTO intervention_runs (id, tenant_id, person_id, assignment_id, module_id, module_version, started_at,
       status, gate_snapshot_json, distress_before, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'started', ?, ?, ?)`,
    [id, tenantId, userId, assignment.id, mod.moduleId, mod.version, at, JSON.stringify(decision), before, at]
  );
  await laneEvent(userId, tenantId, "intervention.run_started", {
    runId: id, assignmentId: assignment.id, moduleId: mod.moduleId, moduleVersion: mod.version,
    decisionId: decision.decisionId, distressBefore: before,
  });
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "assigned_run_started", target: id });
  return id;
}

/** What the member wrote on one step: a narrative string, or worksheet boxes. */
export type StepAnswer = string | Record<string, string>;

/** Save one step. A crisis match saves nothing, ends the run as a policy hard
 *  stop, and returns `crisis` for the caller to route to the crisis page. */
export async function saveLaneStep(
  userId: string, runId: string, stepId: string, answer: StepAnswer
): Promise<{ ok: true } | { ok: false; crisis: true }> {
  const run = await ownRun(userId, runId);
  if (run.status !== "started") throw new LaneRefused("no_run");
  const mod = getLaneModule(run.module_id);
  const step = mod && laneSteps(mod)?.find((s) => s.id === stepId);
  if (!step || step.kind === "read") throw new LaneRefused("not_a_step");
  let clean: StepAnswer;
  if (step.kind === "write") {
    clean = typeof answer === "string" ? answer.trim().slice(0, 20000) : "";
  } else {
    const given = typeof answer === "object" && answer ? answer : {};
    clean = Object.fromEntries(step.fields.map((f) => [f.id, String(given[f.id] ?? "").trim().slice(0, FREE_TEXT_MAX * 4)]));
  }
  const texts = typeof clean === "string" ? [clean] : Object.values(clean);
  const screened = await screenMemberText(userId, texts.filter(Boolean), `assigned/${run.module_id}`);
  if (!screened.ok) {
    await endRun(run, "hard_stopped_by_policy", null, "crisis_language");
    return screened;
  }
  const c = await data();
  await c.run("DELETE FROM intervention_run_responses WHERE run_id = ? AND step_id = ? AND person_id = ?", [runId, stepId, userId]);
  await c.run(
    `INSERT INTO intervention_run_responses (id, tenant_id, person_id, run_id, step_id, response_schema_version,
       structured_response_json, encrypted_free_text, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
    [newId(), run.tenant_id, userId, runId, stepId, mod!.responseSchemaVersion, encryptField(JSON.stringify(clean)), stamp(new Date())]
  );
  return { ok: true };
}

async function endRun(run: RunRow, status: Exclude<RunStatus, "started">, after: number | null, stopReason: string | null): Promise<boolean> {
  const c = await data();
  const at = stamp(new Date());
  await c.run(
    `UPDATE intervention_runs SET status = ?, ended_at = ?, distress_after = ?, stop_reason_code = ?
      WHERE id = ? AND status = 'started'`,
    [status, at, after, stopReason, run.id]
  );
  const flagged = distressFlag(run.distress_before, after);
  const type: EventType = status === "completed" ? "intervention.run_completed"
    : status === "stopped_by_patient" ? "intervention.run_stopped" : "intervention.run_hard_stopped";
  await laneEvent(run.person_id, run.tenant_id, type, {
    runId: run.id, assignmentId: run.assignment_id, moduleId: run.module_id, moduleVersion: run.module_version,
    distressBefore: run.distress_before, distressAfter: after, flagged, stopReason,
  });
  if (flagged) {
    // The assigning clinician's queue: the alert names the practice and the
    // two ratings, never a word the member wrote.
    await createAlert({
      userId: run.person_id, type: "assigned_practice_distress", severity: "high",
      detail: `After a clinician-assigned practice (${run.module_id}, assignment ${run.assignment_id}), distress went from ${run.distress_before} to ${after}. They were shown grounding and SOS.`,
    });
  }
  return flagged;
}

/** Finish or stop. Either way the rating after is asked; stopping without
 *  one is allowed and is never held against anyone. Returns whether the
 *  distress rule fired, so the screen can show grounding and SOS. */
export async function endLaneRun(
  userId: string, runId: string,
  how: { stopped: boolean; distressAfter?: unknown; useful?: unknown; note?: unknown }
): Promise<{ ok: true; flagged: boolean } | { ok: false; crisis: true }> {
  const run = await ownRun(userId, runId);
  if (run.status !== "started") throw new LaneRefused("no_run");
  const after = rating(how.distressAfter);
  if (!how.stopped && after === null) throw new LaneRefused("choose_distress");
  const note = typeof how.note === "string" ? how.note.trim().slice(0, FREE_TEXT_MAX) : "";
  if (note) {
    const screened = await screenMemberText(userId, [note], `assigned/${run.module_id}`);
    if (!screened.ok) {
      await endRun(run, "hard_stopped_by_policy", after, "crisis_language");
      return screened;
    }
  }
  const useful = ["yes", "not_sure", "no"].includes(String(how.useful)) ? String(how.useful) : null;
  const c = await data();
  if (useful || note) {
    await c.run(
      `INSERT INTO intervention_run_responses (id, tenant_id, person_id, run_id, step_id, response_schema_version,
         structured_response_json, encrypted_free_text, recorded_at)
       VALUES (?, ?, ?, ?, 'closing', 'lane-response-v1', ?, ?, ?)`,
      [newId(), run.tenant_id, userId, runId, JSON.stringify({ useful }), note ? encryptField(JSON.stringify(note)) : null, stamp(new Date())]
    );
  }
  const flagged = await endRun(run, how.stopped ? "stopped_by_patient" : "completed", after, how.stopped ? "patient_stop" : null);
  return { ok: true, flagged };
}

// ── Reading back ─────────────────────────────────────────────────────────────

export interface LaneRunView {
  id: string;
  moduleId: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  /** Only on the clinician's view: a member never sees their ratings back. */
  distressBefore?: number;
  distressAfter?: number | null;
  flagged?: boolean;
  useful?: string | null;
  note?: string;
  /** Step id → what was written. */
  written: Array<{ stepId: string; answer: StepAnswer }>;
}

async function runsFor(personId: string, assignmentId: string): Promise<Array<RunRow>> {
  const c = await data();
  return (await c.all(
    "SELECT * FROM intervention_runs WHERE person_id = ? AND assignment_id = ? ORDER BY started_at DESC, rowid DESC",
    [personId, assignmentId]
  )) as RunRow[];
}

async function responsesFor(runId: string): Promise<Array<{ step_id: string; structured_response_json: string; encrypted_free_text: string | null }>> {
  const c = await data();
  return (await c.all(
    "SELECT step_id, structured_response_json, encrypted_free_text FROM intervention_run_responses WHERE run_id = ? ORDER BY recorded_at, rowid",
    [runId]
  )) as Array<{ step_id: string; structured_response_json: string; encrypted_free_text: string | null }>;
}

async function view(run: RunRow, withRatings: boolean): Promise<LaneRunView> {
  const rows = await responsesFor(run.id);
  const closing = rows.find((r) => r.step_id === "closing");
  const out: LaneRunView = {
    id: run.id, moduleId: run.module_id, status: run.status, startedAt: run.started_at, endedAt: run.ended_at,
    note: closing?.encrypted_free_text ? (JSON.parse(decryptField(closing.encrypted_free_text)) as string) : undefined,
    written: rows.filter((r) => r.step_id !== "closing" && r.encrypted_free_text)
      .map((r) => ({ stepId: r.step_id, answer: JSON.parse(decryptField(r.encrypted_free_text!)) as StepAnswer })),
  };
  if (withRatings) {
    out.distressBefore = run.distress_before;
    out.distressAfter = run.distress_after;
    out.flagged = distressFlag(run.distress_before, run.distress_after);
    out.useful = closing ? (JSON.parse(closing.structured_response_json) as { useful: string | null }).useful : null;
  }
  return out;
}

/** The member's own runs of one assignment: their words, no ratings. */
export async function myLaneRuns(userId: string, assignmentId: string): Promise<LaneRunView[]> {
  const a = await laneAssignment(userId, assignmentId);
  if (!a) return [];
  return Promise.all((await runsFor(userId, assignmentId)).map((r) => view(r, false)));
}

/** The assigning clinician's view, and only theirs: every run with its
 *  ratings and what was written. Anyone else — another clinician on the same
 *  care team included — is refused, and each read is audited. */
export async function laneRunsForClinician(clinicianId: string, personId: string, assignmentId: string): Promise<LaneRunView[]> {
  const c = await data();
  const a = (await c.get(
    "SELECT assigned_by, support_id FROM support_assignments WHERE id = ? AND person_id = ?",
    [assignmentId, personId]
  )) as { assigned_by: string; support_id: string } | undefined;
  if (!a || !getLaneModule(a.support_id)) throw new LaneRefused("no_active_assignment");
  if (a.assigned_by !== clinicianId) throw new LaneRefused("not_yours");
  await audit({
    actorId: clinicianId, actorRole: "clinician", family: "clinical", type: "assigned_writing_viewed",
    target: personId, detail: { assignmentId },
  });
  return Promise.all((await runsFor(personId, assignmentId)).map((r) => view(r, true)));
}

/** A run's own state, for the run screens. */
export async function laneRun(userId: string, runId: string): Promise<{ run: LaneRunView; steps: readonly LaneStep[]; module: LaneModule; assignmentId: string } | null> {
  const c = await data();
  const run = (await c.get("SELECT * FROM intervention_runs WHERE id = ? AND person_id = ?", [runId, userId])) as RunRow | undefined;
  const mod = run && getLaneModule(run.module_id);
  const steps = mod && laneSteps(mod);
  if (!run || !mod || !steps) return null;
  return { run: await view(run, false), steps, module: mod, assignmentId: run.assignment_id };
}
