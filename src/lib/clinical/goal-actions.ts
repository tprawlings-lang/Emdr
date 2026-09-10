"use server";

import { revalidatePath } from "next/cache";
import { requireClinician } from "../auth";
import { data } from "../data";
import { PLATFORM_TENANT_ID } from "../db";
import { audit } from "../audit";
import type { TenantContext } from "../repository";
import {
  createGoal, confirmGoal, decideObservation, GoalError,
  GOAL_DOMAINS, GOAL_LEVELS,
  type GoalDomain, type GoalLadderRung, type GoalLevel,
} from "./return-to-life";
import {
  recordGoalCheckin, recordClinicianObservation,
} from "./return-goal-evidence";
import {
  recordGoalCreated, recordLadderSet, recordGoalConfirmed,
} from "./return-to-life-events";

// Server actions for Return-to-Life goals (handoff 01).
//
// Thin, like the console's other actions: authenticate, resolve the tenant from
// the caller's own record, delegate, revalidate. The clinical rules live in
// return-to-life.ts where they are tested; a second copy in a form handler is
// how the two come to disagree.
//
// THE TENANT IS READ, NEVER ACCEPTED (§6.2 of the Thoughts spec, and §12 here:
// "cross-tenant and cross-patient attacks fail"). A tenant supplied by the
// caller is a tenant an attacker can choose.

export interface GoalActionResult {
  ok: boolean;
  goalId?: string;
  error?: string;
}

async function clinicianContext(): Promise<{ ctx: TenantContext; clinicianId: string }> {
  const clinician = await requireClinician();
  const c = await data();
  const row = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  return {
    ctx: { tenantId: row?.tenant_id ?? PLATFORM_TENANT_ID, personId: clinician.id },
    clinicianId: clinician.id,
  };
}

function parseLevel(v: FormDataEntryValue | null): GoalLevel | null {
  const n = Number(v);
  return (GOAL_LEVELS as readonly number[]).includes(n) ? (n as GoalLevel) : null;
}

/** Create a goal and its five rungs. Arrives as a DRAFT — the domain has no
 *  other outcome — so this cannot be the thing that skips confirmation. */
export async function createGoalAction(formData: FormData): Promise<GoalActionResult> {
  const { ctx, clinicianId } = await clinicianContext();
  const personId = String(formData.get("personId") ?? "");
  const title = String(formData.get("title") ?? "").trim().slice(0, 160);
  const patientStatement = String(formData.get("patientStatement") ?? "").trim().slice(0, 1000);
  const whyItMatters = String(formData.get("whyItMatters") ?? "").trim().slice(0, 1000) || null;
  const domainRaw = String(formData.get("domain") ?? "");
  const domain = (GOAL_DOMAINS as string[]).includes(domainRaw) ? (domainRaw as GoalDomain) : null;

  if (!personId || !title || !patientStatement || !domain) {
    return { ok: false, error: "A goal needs a name, the patient's own words, and a category." };
  }

  const ladder: GoalLadderRung[] = [];
  for (const level of GOAL_LEVELS) {
    const description = String(formData.get(`level_${level}`) ?? "").trim().slice(0, 500);
    if (!description) {
      return { ok: false, error: "Every one of the five levels needs a description." };
    }
    ladder.push({ level, description });
  }

  try {
    const goal = await createGoal(ctx, {
      personId, title, patientStatement, whyItMatters, domain, ladder,
    });
    await recordGoalCreated({
      goalId: goal.id, tenantId: ctx.tenantId, personId, domain, createdBy: clinicianId,
    });
    await recordLadderSet({
      goalId: goal.id, tenantId: ctx.tenantId, personId,
      levels: ladder.map((r) => r.level), authoredBy: clinicianId,
      // Written by hand in this form. A drafted ladder comes through a
      // different path and says so, because §12 turns on that distinction.
      modelDrafted: false,
    });
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "return_goal_created", target: goal.id,
      // The act and the shape, never the patient's words (§12).
      detail: { personId, domain, levels: ladder.length },
    });
    revalidatePath(`/clinician/member/${personId}/goals`);
    return { ok: true, goalId: goal.id };
  } catch (e) {
    if (e instanceof GoalError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Confirm a draft, making it active. */
export async function confirmGoalAction(formData: FormData): Promise<GoalActionResult> {
  const { ctx, clinicianId } = await clinicianContext();
  const goalId = String(formData.get("goalId") ?? "");
  const personId = String(formData.get("personId") ?? "");
  try {
    const goal = await confirmGoal(ctx, goalId, new Date().toISOString());
    await recordGoalConfirmed({
      goalId, tenantId: ctx.tenantId, personId: goal.personId, confirmedBy: clinicianId,
    });
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "return_goal_confirmed", target: goalId, detail: { personId: goal.personId },
    });
    revalidatePath(`/clinician/member/${personId}/goals`);
    return { ok: true, goalId };
  } catch (e) {
    if (e instanceof GoalError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Record what the clinician saw. Accepted evidence, clinician_observed. */
export async function recordObservationAction(formData: FormData): Promise<GoalActionResult> {
  const { ctx, clinicianId } = await clinicianContext();
  const goalId = String(formData.get("goalId") ?? "");
  const personId = String(formData.get("personId") ?? "");
  const level = parseLevel(formData.get("level"));
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000) || null;
  if (!goalId || level === null) return { ok: false, error: "Choose which level you saw." };

  try {
    const at = new Date().toISOString();
    await recordClinicianObservation(ctx, {
      goalId, personId, level, note, at,
      // The clinician themselves is the source. Recording the acting person
      // means the drill-down reaches a who rather than a table name.
      sourceId: clinicianId, sourceType: "clinician_direct",
    });
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "return_goal_observation_recorded", target: goalId,
      detail: { personId, level, evidenceClass: "clinician_observed", hasNote: !!note },
    });
    revalidatePath(`/clinician/member/${personId}/goals`);
    return { ok: true, goalId };
  } catch (e) {
    if (e instanceof GoalError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Record what the patient reported, on their behalf, in session.
 *
 *  SEPARATE FROM THE ONE ABOVE, and not a parameter on it. §1 keeps patient
 *  report and clinician observation distinct, and a single action with a class
 *  argument is one typo away from filing a patient's words as a clinician's
 *  observation. Two actions cannot make that mistake. */
export async function recordPatientReportAction(formData: FormData): Promise<GoalActionResult> {
  const { ctx, clinicianId } = await clinicianContext();
  const goalId = String(formData.get("goalId") ?? "");
  const personId = String(formData.get("personId") ?? "");
  const level = parseLevel(formData.get("level"));
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000) || null;
  if (!goalId || level === null) return { ok: false, error: "Choose which level they described." };

  try {
    await recordGoalCheckin(ctx, {
      goalId, personId, level, note,
      at: new Date().toISOString(),
      checkinId: `in_session:${clinicianId}`,
    });
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "return_goal_observation_recorded", target: goalId,
      detail: { personId, level, evidenceClass: "patient_reported", hasNote: !!note },
    });
    revalidatePath(`/clinician/member/${personId}/goals`);
    return { ok: true, goalId };
  } catch (e) {
    if (e instanceof GoalError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Accept or reject a suggested observation (§10's human review). */
export async function decideObservationAction(formData: FormData): Promise<GoalActionResult> {
  const { ctx, clinicianId } = await clinicianContext();
  const observationId = String(formData.get("observationId") ?? "");
  const personId = String(formData.get("personId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (decision !== "accepted" && decision !== "rejected") {
    return { ok: false, error: "Choose accept or reject." };
  }
  try {
    const at = new Date().toISOString();
    const obs = await decideObservation(ctx, observationId, decision, at);
    // The level is refreshed only after an ACCEPT, and through the domain's own
    // fold. A rejection cannot move anything, so there is nothing to recompute.
    if (decision === "accepted") {
      const { refreshLevel } = await import("./return-to-life");
      const { recordLevelChanged } = await import("./return-to-life-events");
      const { previous, current, changed } = await refreshLevel(ctx, obs.goalId, at);
      if (changed) {
        await recordLevelChanged({
          goalId: obs.goalId, tenantId: ctx.tenantId, personId: obs.personId,
          previousLevel: previous, currentLevel: current,
          causedByObservationId: obs.id, actorId: clinicianId,
        });
      }
    }
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "return_goal_observation_decided", target: obs.goalId,
      detail: { personId, observationId, decision },
    });
    revalidatePath(`/clinician/member/${personId}/goals`);
    return { ok: true, goalId: obs.goalId };
  } catch (e) {
    if (e instanceof GoalError) return { ok: false, error: e.message };
    throw e;
  }
}
