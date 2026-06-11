import Anthropic from "@anthropic-ai/sdk";
import { getDb, newId } from "./db";
import { decryptField, encryptField } from "./crypto";
import { audit } from "./audit";
import { getMemoryItemsByType } from "./companion";
import { MODULES } from "./modules";
import {
  getActiveTriggers,
  getCompanionPrefs,
  getLatestReadiness,
  getProfile,
  getSafetyPlan,
  TRACK_LABELS,
} from "./profile";

// Mirrors companion-ai's aiCompanionEnabled(); kept local to avoid a
// circular import (companion-ai reads the plan for its system prompt).
function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Program plan: an AI-drafted (rules-engine fallback) working plan built from
// the member's trigger map — what Module 5 captures — plus readiness, goals,
// and stored focus areas. It is the connective tissue the member asked for:
// what gets mapped in Module 5 shapes the companion's context, the focus
// choices in processing modules, the member's dashboard, and the
// specialist's unlock review.
//
// Wellness-lane rules apply: this is a *program* plan (sequencing, focus,
// preparation), never a treatment plan. It must not diagnose, name conditions
// the member hasn't named, or promise outcomes — and the specialist reviewing
// unlocks always outranks it.

export interface PlanTarget {
  name: string;
  intensity: number | null;
  belief?: string;
  approach: string;
}

export interface PlanStep {
  moduleId: string;
  focus: string;
  why: string;
}

export interface ProgramPlan {
  summary: string;
  targets: PlanTarget[];
  nextSteps: PlanStep[];
  grounding: string[];
}

export interface ProgramPlanRow {
  id: string;
  plan: ProgramPlan;
  generated_by: "ai" | "rules";
  created_at: string;
}

export function getProgramPlan(userId: string): ProgramPlanRow | null {
  const row = getDb()
    .prepare(
      "SELECT id, plan_json, generated_by, created_at FROM program_plans WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"
    )
    .get(userId) as
    | { id: string; plan_json: string; generated_by: "ai" | "rules"; created_at: string }
    | undefined;
  if (!row) return null;
  try {
    return {
      id: row.id,
      plan: JSON.parse(decryptField(row.plan_json)) as ProgramPlan,
      generated_by: row.generated_by,
      created_at: row.created_at,
    };
  } catch {
    return null;
  }
}

function parseJsonArray(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// Deterministic fallback: low-to-medium intensity triggers first, the
// specialist-gated sequence in module order, grounding from the safety plan.
function rulesPlan(userId: string): ProgramPlan {
  const triggers = getActiveTriggers(userId).sort(
    (a, b) => (a.intensity_score ?? 11) - (b.intensity_score ?? 11)
  );
  const tools = parseJsonArray(getSafetyPlan(userId)?.grounding_tools_json);
  const workable = triggers.filter((t) => (t.intensity_score ?? 11) < 7);
  const deferred = triggers.filter((t) => (t.intensity_score ?? 0) >= 7);

  const targets: PlanTarget[] = [
    ...workable.map((t) => ({
      name: t.trigger_name,
      intensity: t.intensity_score,
      approach: "Self-guided work, lowest intensity first",
    })),
    ...deferred.map((t) => ({
      name: t.trigger_name,
      intensity: t.intensity_score,
      approach: "Bring to your specialist before any self-guided work",
    })),
  ];

  const nextSteps: PlanStep[] = [];
  if (workable[0]) {
    nextSteps.push({
      moduleId: "recent-trigger",
      focus: workable[0].trigger_name,
      why: "Lowest-intensity trigger on your map — the right place to learn the processing rhythm.",
    });
  }
  nextSteps.push({
    moduleId: "resourcing",
    focus: tools[0] ?? "A memory of coping well",
    why: "Strengthening a resource before and between processing sessions keeps the work steady.",
  });
  if (workable[1]) {
    nextSteps.push({
      moduleId: "safe-target",
      focus: workable[1].trigger_name,
      why: "A next step once the first target settles — your specialist approves the timing.",
    });
  }

  return {
    summary:
      triggers.length > 0
        ? `Your map has ${triggers.length} trigger${triggers.length === 1 ? "" : "s"}. The plan starts with the gentlest ones and saves the heaviest for work with your specialist's review.`
        : "Your trigger map is empty so far. Mapping a few triggers in Module 5 gives your program a direction.",
    targets,
    nextSteps,
    grounding: tools.slice(0, 4),
  };
}

const PLAN_MODEL = process.env.EMDR_COMPANION_MODEL ?? "claude-opus-4-8";

async function aiPlan(userId: string): Promise<ProgramPlan> {
  const triggers = getActiveTriggers(userId);
  const readiness = getLatestReadiness(userId);
  const profile = getProfile(userId);
  const prefs = getCompanionPrefs(userId);
  const focusAreas = getMemoryItemsByType(userId, "focus_area");
  const tools = parseJsonArray(getSafetyPlan(userId)?.grounding_tools_json);

  const context = {
    triggers: triggers.map((t) => ({
      name: t.trigger_name,
      category: t.trigger_category,
      intensity: t.intensity_score,
      responses: parseJsonArray(t.common_responses_json),
      notes: t.notes,
    })),
    readinessTrack: readiness ? TRACK_LABELS[readiness.recommended_track] : null,
    readinessScore: readiness?.calculated_readiness_score ?? null,
    goals: parseJsonArray(profile?.goals_json),
    focusAreas: focusAreas.map((f) => ({ label: f.memory_key, detail: f.memory_value })),
    groundingTools: tools,
    preferredPace: prefs?.tone ?? null,
    modules: MODULES.map((m) => ({ id: m.id, name: m.name, tier: m.tier, objective: m.objective })),
  };

  const client = new Anthropic();
  const response = await client.messages.create({
    model: PLAN_MODEL,
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    system: `You draft the working "program plan" for Steady, a self-guided wellness program built on the EMDR method. You are given a member's trigger map (their own words, headline level), readiness, goals, focus areas, and the module catalog.

Produce a plan that sequences their work: which triggers to approach first (always lowest intensity first; anything rated 7+ is specialist-territory and must be marked for specialist review, never self-guided), which module each next step belongs to, and what grounding to keep ready.

HARD RULES
- You are planning a wellness program, not treatment. Never diagnose, never name a condition the member has not named, never promise outcomes.
- The specialist who reviews unlocks always outranks this plan — say so in the summary.
- Use the member's own words for trigger names and beliefs.
- nextSteps moduleId must be one of the provided module ids; 2-4 steps; focus must be concrete.
- Warm, plain language. No clinical jargon.

Respond with ONLY a JSON object, no markdown fences, matching:
{"summary": string (2-3 sentences), "targets": [{"name": string, "intensity": number|null, "belief": string?, "approach": string}], "nextSteps": [{"moduleId": string, "focus": string, "why": string}], "grounding": string[]}`,
    messages: [{ role: "user", content: JSON.stringify(context) }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = JSON.parse(text) as ProgramPlan;
  if (!parsed.summary || !Array.isArray(parsed.nextSteps) || !Array.isArray(parsed.targets)) {
    throw new Error("Plan JSON missing required fields");
  }
  const validModules = new Set(MODULES.map((m) => m.id));
  parsed.nextSteps = parsed.nextSteps.filter((s) => validModules.has(s.moduleId)).slice(0, 4);
  parsed.grounding = Array.isArray(parsed.grounding) ? parsed.grounding.slice(0, 6) : [];
  return parsed;
}

/**
 * Regenerate the member's program plan from current data. AI when available,
 * deterministic rules otherwise; the rules plan is also the failure fallback
 * so a model outage never leaves a member planless.
 */
export async function generateProgramPlan(
  userId: string,
  source: string = "trigger_map"
): Promise<ProgramPlanRow> {
  let plan: ProgramPlan;
  let generatedBy: "ai" | "rules" = "rules";
  if (aiEnabled()) {
    try {
      plan = await aiPlan(userId);
      generatedBy = "ai";
    } catch (err) {
      console.error("Program plan AI generation failed; using rules fallback:", err);
      plan = rulesPlan(userId);
    }
  } else {
    plan = rulesPlan(userId);
  }

  const id = newId();
  getDb()
    .prepare(
      "INSERT INTO program_plans (id, user_id, plan_json, generated_by, source) VALUES (?, ?, ?, ?, ?)"
    )
    .run(id, userId, encryptField(JSON.stringify(plan)), generatedBy, source);
  audit({
    actorId: userId,
    actorRole: "member",
    family: "clinical",
    type: "program_plan_generated",
    target: id,
    detail: { generatedBy, source, targets: plan.targets.length, steps: plan.nextSteps.length },
  });
  return { id, plan, generated_by: generatedBy, created_at: new Date().toISOString() };
}
