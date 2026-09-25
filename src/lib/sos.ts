// SOS panic panel (roadmap F7). A member can, from anywhere, reach immediate
// relief in one tap: a paced grounding breath, their own calm place, a
// one-tap call to the safe person they named, and the crisis line. This is
// member-initiated relief — distinct from /crisis, which is the escalation
// the safety gate forces. Opening it is recorded as a coded safety event so
// the specialist (and the engine) can see that the member reached for help,
// without storing any of what they were feeling.

import { audit } from "./audit";
import { data } from "./data";
import { noteSignal } from "./telemetry/store";
import { getSafetyPlan } from "./profile";
import { getSavedCalmPlace } from "./session-focus";
import { CRISIS_REGIONS } from "./crisis-resources";

export interface SosPanel {
  /** The member's saved calm place description, if any. */
  calmPlace: string | null;
  /** A short phrase the member asked us to remind them of. */
  reminderPhrase: string | null;
  /** Grounding tools the member said have helped before. */
  groundingTools: string[];
  /** The safe person the member named, and how to reach them. */
  supportContactName: string | null;
  supportContactMethod: string | null;
  /** Default (US) crisis line for the one-tap button. */
  crisisLabel: string;
  crisisHref: string;
}

/** Everything the panic panel needs, assembled from the member's own plan. */
export async function getSosPanel(userId: string): Promise<SosPanel> {
  const [plan, calmPlace] = await Promise.all([
    getSafetyPlan(userId),
    getSavedCalmPlace(userId),
  ]);
  let groundingTools: string[] = [];
  if (plan?.grounding_tools_json) {
    try {
      const parsed = JSON.parse(plan.grounding_tools_json);
      if (Array.isArray(parsed)) groundingTools = parsed.filter((t) => typeof t === "string");
    } catch {
      groundingTools = [];
    }
  }
  const us = CRISIS_REGIONS[0].resources[0];
  return {
    calmPlace,
    reminderPhrase: plan?.reminder_phrase ?? null,
    groundingTools,
    supportContactName: plan?.support_contact_name ?? null,
    supportContactMethod: plan?.support_contact_method ?? null,
    crisisLabel: us.label,
    crisisHref: us.href,
  };
}

/** Record that the member opened the panic panel. Types and ids only — never
 *  what prompted it (compliance 4B.4). */
export async function recordSosOpened(userId: string): Promise<{ ok: true }> {
  await audit({
    actorId: userId,
    actorRole: "member",
    family: "safety",
    type: "sos_opened",
  });
  // §31.7's gate_support_selected: "support option code only". Verifying that
  // support paths are actually reached is the one measurement question about
  // safety that this catalog can answer, and it answers it with a single code.
  noteSignal("gate_support_selected", { supportOption: "sos_panel" }, { actorRole: "member" });
  return { ok: true };
}

/** Most tools a plan holds, as onboarding's own form allows. */
export const SOS_TOOLS_MAX = 15;

/** Add grounding tools to the member's own SOS plan, keeping what is there.
 *  The member's action, from a program's "Which of these do you want in your
 *  SOS plan?" (Handoff 10 2C, CV10_D05) — never the companion's. Names only;
 *  duplicates are skipped; the plan's other fields are untouched, and a
 *  member with no plan yet gets one holding just these. Returns what was new. */
export async function addSosGroundingTools(userId: string, tools: readonly string[]): Promise<string[]> {
  const c = await data();
  const plan = (await c.get("SELECT grounding_tools_json FROM safety_plans WHERE user_id = ?", [userId])) as
    | { grounding_tools_json: string } | undefined;
  let current: string[] = [];
  try {
    const parsed = plan ? JSON.parse(plan.grounding_tools_json) : [];
    if (Array.isArray(parsed)) current = parsed.filter((t): t is string => typeof t === "string");
  } catch { current = []; }
  const added = [...new Set(tools)].filter((t) => t && !current.includes(t)).slice(0, Math.max(0, SOS_TOOLS_MAX - current.length));
  if (added.length === 0) return [];
  const next = JSON.stringify([...current, ...added]);
  if (plan) {
    await c.run("UPDATE safety_plans SET grounding_tools_json = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?", [next, userId]);
  } else {
    await c.run("INSERT INTO safety_plans (user_id, grounding_tools_json) VALUES (?, ?)", [userId, next]);
  }
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "safety_plan_tools_added", detail: { count: added.length } });
  return added;
}
