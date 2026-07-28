// Mobile onboarding pipeline service — signup → subscribe → consent → fitness
// screener → baseline measures → profile. Mirrors the web Server Actions
// (lib/actions.ts) 1:1 and reuses the same scoring, consent versions, and DB
// writes, so the phone and the website drive the exact same gates against the
// same database.

import { data } from "../data";
import { makeSessionToken, type SessionUser } from "../auth";
import { hashPassword, newId } from "../db";
import { encryptField } from "../crypto";
import { audit } from "../audit";
import { currentConsentSections, currentConsentVersion, currentTermsVersion } from "../policy";
import {
  FITNESS_ITEMS,
  FITNESS_SCREENER_VERSION,
  getFitnessState,
  recordFitnessScreening,
  type FitnessState,
} from "../fitness-screener";
import { INSTRUMENTS, getInstrument, scoreInstrument } from "../instruments";
import { computeReadiness, getProfile, type ReadinessAnswers } from "../profile";
import { writeMemory, getMemoryItemsByType } from "../companion";
import { subscriptionActive, startDemoSubscription } from "../billing";
import { hasConsent, screeningComplete } from "../gating";
import { getSavedCalmPlace } from "../session-focus";
import { profileComplete } from "../profile";

// ---------- signup ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signupMobile(input: {
  name: string; email: string; password: string; dob: string; wellnessAck: boolean;
}): Promise<{ token: string; user: SessionUser } | { error: string }> {
  const name = input.name.trim().slice(0, 80);
  const email = input.email.trim().toLowerCase().slice(0, 200);
  if (!name || !EMAIL_RE.test(email)) return { error: "Enter a valid name and email." };
  if (input.password.length < 8) return { error: "Password must be at least 8 characters." };

  const birth = new Date(input.dob);
  if (!input.dob || Number.isNaN(birth.getTime())) return { error: "Enter a valid date of birth." };
  const age = (Date.now() - birth.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (age < 18) return { error: "Steady is for adults 18 and older." };
  if (age > 120) return { error: "Enter a valid date of birth." };
  if (!input.wellnessAck) return { error: "Please acknowledge the wellness-lane terms to continue." };

  const c = await data();
  if (await c.get("SELECT id FROM users WHERE email = ?", [email])) {
    return { error: "An account with that email already exists." };
  }
  const userId = newId();
  await c.run(
    "INSERT INTO users (id, email, name, role, password_hash, dob) VALUES (?, ?, ?, 'member', ?, ?)",
    [userId, email, name, hashPassword(input.password), input.dob]
  );
  const insertConsent = "INSERT INTO consents (id, user_id, policy_version, scope) VALUES (?, ?, ?, ?)";
  await c.run(insertConsent, [newId(), userId, "wellness-ack-v1", "wellness_acknowledgment"]);
  await c.run(insertConsent, [newId(), userId, currentTermsVersion(), "terms_acceptance"]);
  await audit({
    actorId: userId, actorRole: "member", family: "identity", type: "account_created",
    detail: { wellnessAck: "wellness-ack-v1", via: "mobile" },
  });
  const token = await makeSessionToken(userId);
  return { token, user: { id: userId, email, name, role: "member" } };
}

// ---------- subscribe ----------

export async function subscribeMobile(userId: string): Promise<{ active: boolean }> {
  await startDemoSubscription(userId);
  return { active: await subscriptionActive(userId) };
}

// ---------- consent ----------

export function consentInfo(): { version: string; sections: { title: string; body: string }[] } {
  return { version: currentConsentVersion(), sections: currentConsentSections() };
}

export async function grantConsentMobile(userId: string): Promise<{ ok: boolean }> {
  const c = await data();
  const existing = await c.get(
    "SELECT id FROM consents WHERE user_id = ? AND scope = 'care_program_full' AND revoked_at IS NULL",
    [userId]
  );
  if (!existing) {
    await c.run("INSERT INTO consents (id, user_id, policy_version, scope) VALUES (?, ?, ?, ?)",
      [newId(), userId, currentConsentVersion(), "care_program_full"]);
    await audit({
      actorId: userId, actorRole: "member", family: "consent", type: "consent_granted",
      detail: { policy_version: currentConsentVersion(), scope: "care_program_full", via: "mobile" },
    });
  }
  return { ok: true };
}

// ---------- fitness screener ----------

export function screenerInfo() {
  return { version: FITNESS_SCREENER_VERSION, items: FITNESS_ITEMS };
}

export async function submitScreenerMobile(
  userId: string, answers: Record<string, boolean>
): Promise<{ outcome: string; flags: string[]; state: FitnessState }> {
  const { outcome, flags } = await recordFitnessScreening(userId, answers);
  const state = await getFitnessState(userId);
  await audit({
    actorId: userId, actorRole: "member", family: "clinical",
    type: "fitness_screening_submitted", detail: { outcome, flags, via: "mobile" },
  });
  return { outcome, flags, state };
}

// ---------- baseline measures ----------

export async function measuresInfo(userId: string) {
  const c = await data();
  const rows = (await c.all("SELECT DISTINCT instrument FROM screenings WHERE user_id = ?", [userId])) as { instrument: string }[];
  const completed = rows.map((r) => r.instrument);
  return { instruments: INSTRUMENTS, completed };
}

const WORSENING_THRESHOLDS: Record<string, number> = { "pcl-5": 10, itq: 8 };

export async function submitMeasureMobile(
  userId: string, instrumentId: string, answers: number[]
): Promise<{ total: number; positive: boolean; riskFlags: string[]; crisis: boolean } | { error: string }> {
  const instrument = getInstrument(instrumentId);
  if (!instrument) return { error: "Unknown instrument." };
  if (answers.length !== instrument.items.length || answers.some((a) => a < 0)) {
    return { error: "Please answer every item." };
  }
  const { total, positive, riskFlags } = scoreInstrument(instrument, answers);
  const c = await data();
  const previous = (await c.get(
    "SELECT total_score FROM screenings WHERE user_id = ? AND instrument = ? ORDER BY created_at DESC LIMIT 1",
    [userId, instrument.id]
  )) as { total_score: number } | undefined;

  await c.run(
    `INSERT INTO screenings (id, user_id, instrument, instrument_version, total_score, answers_json, risk_flags_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newId(), userId, instrument.id, instrument.version, total,
     encryptField(JSON.stringify(answers)), JSON.stringify(riskFlags)]
  );
  await audit({
    actorId: userId, actorRole: "member", family: "clinical", type: "screening_submitted",
    target: instrument.id, detail: { total, riskFlags, version: instrument.version, context: "baseline", via: "mobile" },
  });

  const worsenBy = WORSENING_THRESHOLDS[instrument.id];
  if (previous && worsenBy !== undefined && total - previous.total_score >= worsenBy) {
    await createAlert(userId, "symptom_worsening", "high",
      `${instrument.id} rose from ${previous.total_score} to ${total} since last measure.`);
  }
  if (riskFlags.length > 0) {
    await createAlert(userId, "screening_risk_item", "urgent",
      `${instrument.id}: ${riskFlags.join(", ")} (total ${total})`);
  }
  return { total, positive, riskFlags, crisis: riskFlags.length > 0 };
}

// ---------- profile onboarding ----------

async function upsertProfile(userId: string, fields: Record<string, string>) {
  const c = await data();
  await c.run("INSERT INTO user_profiles (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING", [userId]);
  for (const [col, value] of Object.entries(fields)) {
    await c.run(`UPDATE user_profiles SET ${col} = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`, [value, userId]);
  }
}

export async function saveSupportMobile(userId: string, b: {
  therapistStatus?: string; emdrExperience?: string; goals?: string[];
}) {
  await upsertProfile(userId, {
    therapist_status: b.therapistStatus ?? "prefer_not_to_say",
    emdr_experience: b.emdrExperience ?? "not_sure",
    goals_json: JSON.stringify((b.goals ?? []).slice(0, 10)),
  });
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "onboarding_support_status", detail: { via: "mobile" } });
}

export async function saveTraumaMobile(userId: string, b: { areas?: string[]; restrictedTopics?: string[] }) {
  await upsertProfile(userId, {
    trauma_areas_json: JSON.stringify((b.areas ?? []).slice(0, 20)),
    restricted_topics_json: JSON.stringify((b.restrictedTopics ?? []).slice(0, 20)),
  });
  for (const topic of (b.restrictedTopics ?? [])) {
    await writeMemory({ userId, type: "restricted_topic", key: topic, value: "Do not raise unless the member brings it up first.", source: "onboarding" });
  }
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "onboarding_trauma_context", detail: { via: "mobile" } });
}

export async function saveTriggersMobile(userId: string, b: {
  triggers?: { category: string; name: string; intensity?: number; responses?: string[] }[];
}) {
  const c = await data();
  const insert = `INSERT INTO user_triggers (id, user_id, trigger_name, trigger_category)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, trigger_name) DO UPDATE SET active = 1, updated_at = CURRENT_TIMESTAMP`;
  for (const t of (b.triggers ?? []).slice(0, 60)) {
    if (!t.name) continue;
    await c.run(insert, [newId(), userId, t.name.slice(0, 100), (t.category || "custom").slice(0, 30)]);
    if (t.intensity !== undefined) {
      await c.run(
        `UPDATE user_triggers SET intensity_score = ?, common_responses_json = ?, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND trigger_name = ?`,
        [Number(t.intensity), JSON.stringify((t.responses ?? []).slice(0, 12)), userId, t.name.slice(0, 100)]
      );
      await writeMemory({
        userId, type: "trigger", key: t.name.slice(0, 100),
        value: `Intensity ${t.intensity}/10. Usual response: ${(t.responses ?? []).join(", ") || "not specified"}.`,
        source: "onboarding",
      });
    }
  }
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "onboarding_triggers_saved", detail: { count: (b.triggers ?? []).length, via: "mobile" } });
}

export async function saveWarningSignsMobile(userId: string, signs: string[]) {
  const c = await data();
  const insert = `INSERT INTO early_warning_signs (id, user_id, sign_name) VALUES (?, ?, ?)
     ON CONFLICT(user_id, sign_name) DO UPDATE SET active = 1`;
  for (const s of (signs ?? []).slice(0, 20)) await c.run(insert, [newId(), userId, s.slice(0, 100)]);
  if ((signs ?? []).length > 0) {
    await writeMemory({ userId, type: "safety", key: "early_warning_signs", value: signs.join(", "), source: "onboarding" });
  }
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "onboarding_warning_signs", detail: { via: "mobile" } });
}

export async function saveReadinessMobile(userId: string, b: {
  stability: number; bodySafety: number; presentConnection: number; symptomIntensity: number;
  sleep: string; support: string; processing: string; pause: string; pace: string; risk: string;
}): Promise<{ score: number; track: string; crisis: boolean }> {
  const riskFlag = b.risk as ReadinessAnswers["riskFlag"];
  if (riskFlag === "not_safe") {
    await createAlert(userId, "onboarding_risk_disclosure", "urgent",
      "Member reported recent harm thoughts and possible current unsafety during onboarding readiness assessment (mobile).");
    await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "onboarding_crisis_route", detail: { via: "mobile" } });
    return { score: 0, track: "grounding", crisis: true };
  }
  // Coerce option values to the exact enum keys computeReadiness expects, so a
  // stale/unknown client value can never produce a NaN score.
  const pick = <T extends string>(v: string, allowed: readonly T[], fallback: T): T =>
    (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  const clampN = (n: number) => Math.max(0, Math.min(10, Number.isFinite(n) ? n : 5));
  const answers: ReadinessAnswers = {
    stability: clampN(Number(b.stability)), bodySafety: clampN(Number(b.bodySafety)),
    presentConnection: clampN(Number(b.presentConnection)), symptomIntensity: clampN(Number(b.symptomIntensity)),
    sleepQuality: pick(b.sleep, ["good", "okay", "poor", "very_poor"] as const, "okay"),
    supportAvailable: pick(b.support, ["yes", "sometimes", "no"] as const, "sometimes"),
    processingReadiness: pick(b.processing, ["ready", "curious", "unsure", "overwhelmed", "not_now"] as const, "unsure"),
    pauseCapacity: pick(b.pause, ["yes", "think_so", "not_sure", "no"] as const, "not_sure"),
    riskFlag,
  };
  const { score, track } = computeReadiness(answers);
  const c = await data();
  await c.run(
    `INSERT INTO readiness_assessments
       (id, user_id, stability_score, body_safety_score, present_connection_score, symptom_intensity_score,
        sleep_quality, support_available, processing_readiness, pause_capacity, pace_preference,
        risk_flag, calculated_readiness_score, recommended_track, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'onboarding')`,
    [newId(), userId, answers.stability, answers.bodySafety, answers.presentConnection,
     answers.symptomIntensity, answers.sleepQuality, answers.supportAvailable,
     answers.processingReadiness, answers.pauseCapacity, b.pace, riskFlag, score, track]
  );
  await writeMemory({ userId, type: "readiness", key: "current_track", value: `${track} (score ${score}/100)`, source: "onboarding" });
  if (riskFlag === "safe_now") {
    await createAlert(userId, "onboarding_risk_disclosure", "high",
      "Member reported recent harm thoughts during onboarding but feels safe right now. Routed to stabilization track (mobile).");
  }
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "readiness_assessed", detail: { score, track, source: "onboarding", via: "mobile" } });
  return { score, track, crisis: false };
}

export async function saveSafetyPlanMobile(userId: string, b: {
  tools?: string[]; contactName?: string; contactMethod?: string;
  reminder?: string; stopSigns?: string; carefulTopics?: string;
}) {
  const c = await data();
  await c.run(
    `INSERT INTO safety_plans
       (user_id, grounding_tools_json, support_contact_name, support_contact_method, reminder_phrase, stop_signs, careful_topics)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       grounding_tools_json=excluded.grounding_tools_json,
       support_contact_name=excluded.support_contact_name,
       support_contact_method=excluded.support_contact_method,
       reminder_phrase=excluded.reminder_phrase, stop_signs=excluded.stop_signs,
       careful_topics=excluded.careful_topics, updated_at=CURRENT_TIMESTAMP`,
    [userId, JSON.stringify((b.tools ?? []).slice(0, 15)),
     (b.contactName ?? "").slice(0, 100) || null, (b.contactMethod ?? "").slice(0, 100) || null,
     encryptField((b.reminder ?? "").slice(0, 300) || null),
     encryptField((b.stopSigns ?? "").slice(0, 500) || null),
     encryptField((b.carefulTopics ?? "").slice(0, 500) || null)]
  );
  for (const tool of (b.tools ?? []).slice(0, 15)) {
    await writeMemory({ userId, type: "grounding_tool", key: tool, value: "Chosen in safety plan.", source: "onboarding" });
  }
  const reminder = (b.reminder ?? "").trim();
  if (reminder) {
    await writeMemory({ userId, type: "safety", key: "reminder_phrase", value: reminder.slice(0, 300), source: "onboarding" });
  }
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "safety_plan_saved", detail: { via: "mobile" } });
}

export async function saveCompanionMobile(userId: string, b: {
  preferredName?: string; tone?: string; modes?: string[]; avoidances?: string[]; memory?: string;
}) {
  const c = await data();
  const memory = ["yes", "no", "ask"].includes(b.memory ?? "") ? b.memory! : "yes";
  await c.run(
    `INSERT INTO ai_companion_preferences
       (user_id, preferred_user_name, tone, support_modes_json, avoidances_json, memory_enabled)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       preferred_user_name=excluded.preferred_user_name, tone=excluded.tone,
       support_modes_json=excluded.support_modes_json, avoidances_json=excluded.avoidances_json,
       memory_enabled=excluded.memory_enabled, updated_at=CURRENT_TIMESTAMP`,
    [userId, (b.preferredName ?? "").slice(0, 60) || null, (b.tone ?? "Gentle").slice(0, 30),
     JSON.stringify((b.modes ?? []).slice(0, 10)), JSON.stringify((b.avoidances ?? []).slice(0, 10)), memory]
  );
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "companion_preferences_saved", detail: { via: "mobile" } });
}

// Set the member's calm place directly (e.g. from Settings) so it persists
// immediately — writes the same durable "calm place" memory slot the web reads.
export async function saveCalmPlaceMobile(userId: string, place: string): Promise<{ ok: boolean }> {
  const value = place.trim().slice(0, 200);
  if (!value) return { ok: false };
  await writeMemory({ userId, type: "grounding_tool", key: "calm place", value, source: "session_reflection" });
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "calm_place_set", detail: { via: "mobile" } });
  return { ok: true };
}

function safeArr(v: unknown): string[] {
  try { const a = JSON.parse(String(v ?? "[]")); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}

// The member's saved profile values (so the native forms can pre-fill / resume-
// edit, like the web forms do). Plaintext + memory-backed fields only — the
// encrypted safety-plan free text is reported as presence, never returned.
export async function savedProfileMobile(userId: string) {
  const c = await data();
  const [profile, triggers, warnings, companion, safetyPlan, restricted, calmPlace] = await Promise.all([
    getProfile(userId),
    c.all("SELECT trigger_name, trigger_category, intensity_score FROM user_triggers WHERE user_id = ? AND active = 1 ORDER BY updated_at DESC", [userId]),
    c.all("SELECT sign_name FROM early_warning_signs WHERE user_id = ? AND active = 1", [userId]),
    c.get("SELECT preferred_user_name, tone, support_modes_json, avoidances_json, memory_enabled FROM ai_companion_preferences WHERE user_id = ?", [userId]),
    c.get("SELECT user_id FROM safety_plans WHERE user_id = ?", [userId]),
    getMemoryItemsByType(userId, "restricted_topic"),
    getSavedCalmPlace(userId),
  ]);
  const p = (profile as unknown as Record<string, unknown> | null) ?? undefined;
  const comp = companion as Record<string, unknown> | undefined;
  return {
    support: p
      ? { therapistStatus: (p.therapist_status as string) ?? null, emdrExperience: (p.emdr_experience as string) ?? null, goals: safeArr(p.goals_json) }
      : null,
    restrictedTopics: restricted.map((m) => m.memory_key),
    triggers: (triggers as Array<Record<string, unknown>>).map((t) => ({
      name: t.trigger_name as string, category: t.trigger_category as string, intensity: t.intensity_score as number,
    })),
    warningSigns: (warnings as Array<Record<string, unknown>>).map((w) => w.sign_name as string),
    companion: comp
      ? {
          preferredName: (comp.preferred_user_name as string) ?? null,
          tone: (comp.tone as string) ?? null,
          modes: safeArr(comp.support_modes_json),
          avoidances: safeArr(comp.avoidances_json),
          memory: (comp.memory_enabled as string) ?? "yes",
        }
      : null,
    hasSafetyPlan: !!safetyPlan,
    calmPlace,
  };
}

export async function completeProfileMobile(userId: string) {
  await upsertProfile(userId, { profile_complete: "1" });
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "onboarding_profile_complete", detail: { via: "mobile" } });
}

// ---------- pipeline "next step" resolver ----------

export type NextStep =
  | "subscribe" | "consent" | "screener" | "screener_cooldown"
  | "measures" | "profile" | "ready";

export async function nextStep(userId: string): Promise<{ step: NextStep; detail?: unknown }> {
  if (!(await subscriptionActive(userId))) return { step: "subscribe" };
  if (!(await hasConsent(userId))) return { step: "consent" };
  const fit = await getFitnessState(userId);
  if (fit.status === "cooldown") return { step: "screener_cooldown", detail: { retakeInHours: fit.retakeInHours } };
  if (fit.status === "none") return { step: "screener" };
  if (!(await screeningComplete(userId))) return { step: "measures" };
  if (!(await profileComplete(userId))) return { step: "profile" };
  return { step: "ready" };
}

// A compact, server-driven catalog for the native profile forms (preference
// selections; not safety-critical). The app renders whatever is returned here.
export function profileCatalog() {
  return {
    goals: [
      "Fewer nightmares", "Less anxiety or panic", "Process a specific memory",
      "Feel present again", "Better sleep", "Kinder self-talk", "Less anger or overwhelm",
    ],
    therapistStatus: [
      { value: "currently_seeing", label: "I'm seeing a therapist now" },
      { value: "between", label: "Between therapists" },
      { value: "never", label: "I've never had therapy" },
      { value: "prefer_not_to_say", label: "Prefer not to say" },
    ],
    emdrExperience: [
      { value: "yes", label: "Yes, I've done EMDR" },
      { value: "some", label: "A little" },
      { value: "no", label: "No" },
      { value: "not_sure", label: "Not sure" },
    ],
    traumaAreas: ["Accident or injury", "Assault or violence", "Childhood experiences",
      "Loss or grief", "Medical trauma", "Combat or service", "Something else"],
    triggerCategories: [
      { value: "relational", label: "People & relationships" },
      { value: "environmental", label: "Places & situations" },
      { value: "body", label: "Body sensations" },
      { value: "memory", label: "Memories & dates" },
      { value: "internal", label: "Thoughts & feelings" },
      { value: "other", label: "Something else" },
    ],
    warningSigns: ["Racing heart", "Shallow breathing", "Clenched jaw", "Going numb",
      "Spacing out", "Irritability", "Sense of dread", "Nausea", "Tight chest",
      "Can't concentrate", "Urge to hide", "Hypervigilance", "Tearfulness",
      "Feeling unreal", "Sudden exhaustion"],
    triggerResponses: ["Freeze", "Want to flee", "Get angry", "Shut down", "Cry", "Overthink", "Reach out", "Isolate"],
    safetyTools: ["Calm place", "5-4-3-2-1 grounding", "Cold water", "Breathing", "A walk",
      "Call someone", "Music", "Pet", "Containment image"],
    tones: ["Gentle", "Warm", "Direct", "Practical", "Quiet"],
    companionModes: ["Just listen", "Help me ground", "Gentle encouragement", "Keep me on track", "Celebrate wins"],
    companionAvoidances: ["Toxic positivity", "Clinical jargon", "Pushing me", "Comparisons"],
    // NOTE: option `value`s below must match the enum keys consumed by
    // computeReadiness (lib/profile.ts) exactly — otherwise scoring yields NaN.
    sleep: [{ value: "good", label: "Well" }, { value: "okay", label: "Okay" }, { value: "poor", label: "Poorly" }, { value: "very_poor", label: "Very poorly" }],
    support: [{ value: "yes", label: "Yes" }, { value: "sometimes", label: "Somewhat" }, { value: "no", label: "Not really" }],
    processing: [{ value: "ready", label: "I feel ready" }, { value: "curious", label: "Curious" }, { value: "unsure", label: "Unsure" }, { value: "overwhelmed", label: "Feels like a lot" }, { value: "not_now", label: "Not yet" }],
    pause: [{ value: "yes", label: "Yes, usually" }, { value: "think_so", label: "I think so" }, { value: "not_sure", label: "Not sure" }, { value: "no", label: "No" }],
    pace: [{ value: "slow", label: "Slow and gentle" }, { value: "steady", label: "Steady" }, { value: "not_sure", label: "Not sure yet" }],
    risk: [
      { value: "none", label: "No" },
      { value: "safe_now", label: "Yes recently, but I feel safe right now" },
      { value: "not_safe", label: "Yes, and I may not be safe" },
    ],
  };
}

// local alert helper (mirrors createAlert in service.ts / actions.ts)
async function createAlert(userId: string, type: string, severity: "urgent" | "high" | "moderate" | "info", detail: string) {
  const c = await data();
  await c.run("INSERT INTO alerts (id, user_id, alert_type, severity, detail) VALUES (?, ?, ?, ?, ?)",
    [newId(), userId, type, severity, detail]);
}
