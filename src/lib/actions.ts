"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb, hashPassword, newId, verifyPassword } from "./db";
import { setCancelAtPeriodEnd, startDemoSubscription, subscriptionActive } from "./billing";
import { audit } from "./audit";
import {
  requireUser,
  requireMember,
  requireClinician,
  setSessionCookie,
  clearSessionCookie,
} from "./auth";
import { getInstrument, scoreInstrument } from "./instruments";
import { getModule } from "./modules";
import { checkModuleAccess, evaluateCheckin, todayISO } from "./gating";
import { CONSENT_VERSION } from "./policy";
import {
  ReadinessAnswers,
  computeReadiness,
  getActiveTriggers,
  getLatestReadiness,
  readinessFromCheckin,
} from "./profile";
import { buildCompanionContext, detectRisk, generateReply, writeMemory } from "./companion";
import { aiCompanionEnabled, generateAiReply } from "./companion-ai";

function createAlert(args: {
  userId: string;
  type: string;
  severity: "urgent" | "high" | "moderate" | "info";
  detail: string;
}) {
  const db = getDb();
  db.prepare(
    "INSERT INTO alerts (id, user_id, alert_type, severity, detail) VALUES (?, ?, ?, ?, ?)"
  ).run(newId(), args.userId, args.type, args.severity, args.detail);
}

// ---------- Identity ----------

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const db = getDb();
  const user = db
    .prepare("SELECT id, role, password_hash FROM users WHERE email = ? AND status = 'active'")
    .get(email) as { id: string; role: string; password_hash: string } | undefined;

  if (!user || !verifyPassword(password, user.password_hash)) {
    audit({ family: "identity", type: "login_failed", target: email });
    redirect("/login?error=1");
  }
  await setSessionCookie(user.id);
  audit({ actorId: user.id, actorRole: user.role, family: "identity", type: "login_success" });
  redirect(user.role === "member" ? "/dashboard" : "/clinician");
}

export async function logout() {
  await clearSessionCookie();
  redirect("/");
}

export async function signup(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const password = String(formData.get("password") ?? "");

  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect("/signup?error=invalid");
  if (password.length < 8) redirect("/signup?error=password");

  // Demo deployments let reviewers create clinician accounts, gated by a
  // shared access code (EMDR_CLINICIAN_CODE) so the clinician view — which
  // sees every member — can't be reached by arbitrary visitors. Production
  // clinician accounts are provisioned, never self-served.
  const demo = process.env.EMDR_DEMO === "1";
  const wantsClinician = demo && formData.get("role") === "clinician";
  if (wantsClinician) {
    const code = String(formData.get("clinician_code") ?? "").trim();
    if (!code || code !== (process.env.EMDR_CLINICIAN_CODE ?? "steady-colleague"))
      redirect("/signup?error=code");
  }

  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) redirect("/signup?error=exists");

  const userId = newId();
  db.prepare(
    "INSERT INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)"
  ).run(userId, email, name, wantsClinician ? "clinician" : "member", hashPassword(password));
  await setSessionCookie(userId);
  audit({
    actorId: userId,
    actorRole: wantsClinician ? "clinician" : "member",
    family: "identity",
    type: "account_created",
    detail: wantsClinician ? { demoClinicianSignup: true } : {},
  });
  redirect(wantsClinician ? "/clinician" : "/subscribe");
}

// ---------- Membership billing ----------

export async function startSubscription() {
  const user = await requireMember();
  // The demo provider simulates checkout; a real provider would redirect to
  // hosted checkout here and activate via webhook (see lib/billing.ts).
  startDemoSubscription(user.id);
  redirect("/onboarding");
}

export async function cancelSubscription() {
  const user = await requireMember();
  setCancelAtPeriodEnd(user.id, true);
  revalidatePath("/settings/billing");
  redirect("/settings/billing");
}

export async function resumeSubscription() {
  const user = await requireMember();
  setCancelAtPeriodEnd(user.id, false);
  revalidatePath("/settings/billing");
  redirect("/settings/billing");
}

export async function restartSubscription() {
  const user = await requireMember();
  if (!subscriptionActive(user.id)) startDemoSubscription(user.id);
  redirect("/dashboard");
}

// ---------- Consent ----------

export async function grantConsent() {
  const user = await requireMember();
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM consents WHERE user_id = ? AND revoked_at IS NULL")
    .get(user.id);
  if (!existing) {
    db.prepare(
      "INSERT INTO consents (id, user_id, policy_version, scope) VALUES (?, ?, ?, ?)"
    ).run(newId(), user.id, CONSENT_VERSION, "care_program_full");
    audit({
      actorId: user.id,
      actorRole: "member",
      family: "consent",
      type: "consent_granted",
      detail: { policy_version: CONSENT_VERSION, scope: "care_program_full" },
    });
  }
  redirect("/screening");
}

// ---------- Screening ----------

// Sharp week-over-week worsening on tracked measures queues clinician review.
const WORSENING_THRESHOLDS: Record<string, number> = { "pcl-5": 10, itq: 8 };

export async function submitScreening(formData: FormData) {
  const user = await requireMember();
  const instrumentId = String(formData.get("instrument") ?? "");
  const context = formData.get("context") === "weekly" ? "weekly" : "baseline";
  const returnPath = context === "weekly" ? "/measures" : "/screening";
  const instrument = getInstrument(instrumentId);
  if (!instrument) redirect(returnPath);

  const answers: number[] = instrument.items.map((_, i) =>
    Number(formData.get(`item-${i}`) ?? -1)
  );
  if (answers.some((a) => a < 0)) redirect(`${returnPath}?incomplete=${instrumentId}`);

  const { total, riskFlags } = scoreInstrument(instrument, answers);
  const db = getDb();

  const previous = db
    .prepare(
      "SELECT total_score FROM screenings WHERE user_id = ? AND instrument = ? ORDER BY created_at DESC LIMIT 1"
    )
    .get(user.id, instrument.id) as { total_score: number } | undefined;

  db.prepare(
    `INSERT INTO screenings (id, user_id, instrument, instrument_version, total_score, answers_json, risk_flags_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(newId(), user.id, instrument.id, instrument.version, total, JSON.stringify(answers), JSON.stringify(riskFlags));

  audit({
    actorId: user.id,
    actorRole: "member",
    family: "clinical",
    type: "screening_submitted",
    target: instrument.id,
    detail: { total, riskFlags, version: instrument.version, context },
  });

  const worsenBy = WORSENING_THRESHOLDS[instrument.id];
  if (previous && worsenBy !== undefined && total - previous.total_score >= worsenBy) {
    createAlert({
      userId: user.id,
      type: "symptom_worsening",
      severity: "high",
      detail: `${instrument.id} rose from ${previous.total_score} to ${total} since last measure.`,
    });
  }

  // Risk items (e.g., PHQ-9 item 9) never get an autonomous assessment —
  // they route to the crisis screen and queue same-day specialist review.
  if (riskFlags.length > 0) {
    createAlert({
      userId: user.id,
      type: "screening_risk_item",
      severity: "urgent",
      detail: `${instrument.id}: ${riskFlags.join(", ")} (total ${total})`,
    });
    redirect("/crisis?from=screening");
  }
  redirect(context === "weekly" ? "/measures?submitted=1" : "/screening");
}

// ---------- Onboarding profile (feature spec sections 3–7) ----------

function upsertProfile(userId: string, fields: Record<string, string>) {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO user_profiles (user_id) VALUES (?)").run(userId);
  for (const [col, value] of Object.entries(fields)) {
    // Column names are fixed by the call sites below, never user input.
    db.prepare(`UPDATE user_profiles SET ${col} = ?, updated_at = datetime('now') WHERE user_id = ?`).run(
      value,
      userId
    );
  }
}

export async function saveSupportStatus(formData: FormData) {
  const user = await requireMember();
  upsertProfile(user.id, {
    therapist_status: String(formData.get("therapist_status") ?? "prefer_not_to_say"),
    emdr_experience: String(formData.get("emdr_experience") ?? "not_sure"),
    goals_json: JSON.stringify(formData.getAll("goal").map(String).slice(0, 10)),
  });
  audit({ actorId: user.id, actorRole: "member", family: "clinical", type: "onboarding_support_status" });
  redirect("/onboarding/profile?step=background");
}

export async function saveTraumaContext(formData: FormData) {
  const user = await requireMember();
  const restricted =
    formData.get("restrict") === "yes" ? formData.getAll("restricted_topic").map(String) : [];
  upsertProfile(user.id, {
    trauma_areas_json: JSON.stringify(formData.getAll("area").map(String).slice(0, 20)),
    restricted_topics_json: JSON.stringify(restricted.slice(0, 20)),
  });
  for (const topic of restricted) {
    writeMemory({ userId: user.id, type: "restricted_topic", key: topic, value: "Do not raise unless the member brings it up first.", source: "onboarding" });
  }
  audit({ actorId: user.id, actorRole: "member", family: "clinical", type: "onboarding_trauma_context" });
  redirect("/onboarding/profile?step=triggers");
}

export async function saveTriggers(formData: FormData) {
  const user = await requireMember();
  const db = getDb();
  const selected = formData.getAll("trigger").map(String);
  const custom = String(formData.get("custom_triggers") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);

  const insert = db.prepare(
    `INSERT INTO user_triggers (id, user_id, trigger_name, trigger_category)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, trigger_name) DO UPDATE SET active = 1, updated_at = datetime('now')`
  );
  for (const entry of selected.slice(0, 60)) {
    const [category, name] = entry.split("|");
    if (category && name) insert.run(newId(), user.id, name.slice(0, 100), category.slice(0, 30));
  }
  for (const name of custom) insert.run(newId(), user.id, name.slice(0, 100), "custom");

  audit({
    actorId: user.id,
    actorRole: "member",
    family: "clinical",
    type: "onboarding_triggers_saved",
    detail: { count: selected.length + custom.length },
  });
  redirect("/onboarding/profile?step=trigger-details");
}

export async function saveTriggerDetails(formData: FormData) {
  const user = await requireMember();
  const db = getDb();
  for (const t of getActiveTriggers(user.id)) {
    const intensity = formData.get(`intensity-${t.id}`);
    const responses = formData.getAll(`resp-${t.id}`).map(String).slice(0, 12);
    if (intensity === null) continue;
    db.prepare(
      `UPDATE user_triggers SET intensity_score = ?, common_responses_json = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`
    ).run(Number(intensity), JSON.stringify(responses), t.id, user.id);
    writeMemory({
      userId: user.id,
      type: "trigger",
      key: t.trigger_name,
      value: `Intensity ${intensity}/10. Usual response: ${responses.join(", ") || "not specified"}.`,
      source: "onboarding",
      sourceId: t.id,
    });
  }
  audit({ actorId: user.id, actorRole: "member", family: "clinical", type: "onboarding_trigger_details" });
  redirect("/onboarding/profile?step=warning-signs");
}

export async function saveWarningSigns(formData: FormData) {
  const user = await requireMember();
  const db = getDb();
  const signs = formData.getAll("sign").map(String).slice(0, 20);
  const insert = db.prepare(
    `INSERT INTO early_warning_signs (id, user_id, sign_name) VALUES (?, ?, ?)
     ON CONFLICT(user_id, sign_name) DO UPDATE SET active = 1`
  );
  for (const s of signs) insert.run(newId(), user.id, s.slice(0, 100));
  if (signs.length > 0) {
    writeMemory({
      userId: user.id,
      type: "safety",
      key: "early_warning_signs",
      value: signs.join(", "),
      source: "onboarding",
    });
  }
  audit({ actorId: user.id, actorRole: "member", family: "clinical", type: "onboarding_warning_signs" });
  redirect("/onboarding/profile?step=readiness");
}

export async function saveReadinessAssessment(formData: FormData) {
  const user = await requireMember();
  const riskFlag = String(formData.get("risk") ?? "none") as ReadinessAnswers["riskFlag"];

  // "Yes, and I may not be safe" routes straight to crisis support. Onboarding
  // stays incomplete until safety is confirmed (spec screen 8).
  if (riskFlag === "not_safe") {
    createAlert({
      userId: user.id,
      type: "onboarding_risk_disclosure",
      severity: "urgent",
      detail: "Member reported recent harm thoughts and possible current unsafety during onboarding readiness assessment.",
    });
    audit({ actorId: user.id, actorRole: "member", family: "clinical", type: "onboarding_crisis_route" });
    redirect("/crisis?from=onboarding");
  }

  const answers: ReadinessAnswers = {
    stability: Number(formData.get("stability") ?? 0),
    bodySafety: Number(formData.get("body_safety") ?? 0),
    presentConnection: Number(formData.get("present_connection") ?? 0),
    symptomIntensity: Number(formData.get("symptom_intensity") ?? 0),
    sleepQuality: String(formData.get("sleep") ?? "okay") as ReadinessAnswers["sleepQuality"],
    supportAvailable: String(formData.get("support") ?? "no") as ReadinessAnswers["supportAvailable"],
    processingReadiness: String(formData.get("processing") ?? "unsure") as ReadinessAnswers["processingReadiness"],
    pauseCapacity: String(formData.get("pause") ?? "not_sure") as ReadinessAnswers["pauseCapacity"],
    riskFlag,
  };
  const { score, track } = computeReadiness(answers);
  const db = getDb();
  db.prepare(
    `INSERT INTO readiness_assessments
       (id, user_id, stability_score, body_safety_score, present_connection_score, symptom_intensity_score,
        sleep_quality, support_available, processing_readiness, pause_capacity, pace_preference,
        risk_flag, calculated_readiness_score, recommended_track, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'onboarding')`
  ).run(
    newId(), user.id, answers.stability, answers.bodySafety, answers.presentConnection,
    answers.symptomIntensity, answers.sleepQuality, answers.supportAvailable,
    answers.processingReadiness, answers.pauseCapacity,
    String(formData.get("pace") ?? "not_sure"), riskFlag, score, track
  );
  writeMemory({
    userId: user.id,
    type: "readiness",
    key: "current_track",
    value: `${track} (score ${score}/100)`,
    source: "onboarding",
  });
  if (riskFlag === "safe_now") {
    createAlert({
      userId: user.id,
      type: "onboarding_risk_disclosure",
      severity: "high",
      detail: "Member reported recent harm thoughts during onboarding but feels safe right now. Routed to stabilization track.",
    });
  }
  audit({
    actorId: user.id,
    actorRole: "member",
    family: "clinical",
    type: "readiness_assessed",
    detail: { score, track, source: "onboarding" },
  });
  redirect("/onboarding/profile?step=safety-plan");
}

export async function saveSafetyPlan(formData: FormData) {
  const user = await requireMember();
  const tools = formData.getAll("tool").map(String).slice(0, 15);
  const custom = String(formData.get("custom_tool") ?? "").trim();
  if (custom) tools.push(custom.slice(0, 100));
  const db = getDb();
  db.prepare(
    `INSERT INTO safety_plans
       (user_id, grounding_tools_json, support_contact_name, support_contact_method, reminder_phrase, stop_signs, careful_topics)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       grounding_tools_json=excluded.grounding_tools_json,
       support_contact_name=excluded.support_contact_name,
       support_contact_method=excluded.support_contact_method,
       reminder_phrase=excluded.reminder_phrase,
       stop_signs=excluded.stop_signs,
       careful_topics=excluded.careful_topics,
       updated_at=datetime('now')`
  ).run(
    user.id,
    JSON.stringify(tools),
    String(formData.get("contact_name") ?? "").slice(0, 100) || null,
    String(formData.get("contact_method") ?? "").slice(0, 100) || null,
    String(formData.get("reminder") ?? "").slice(0, 300) || null,
    String(formData.get("stop_signs") ?? "").slice(0, 500) || null,
    String(formData.get("careful_topics") ?? "").slice(0, 500) || null
  );
  for (const tool of tools) {
    writeMemory({ userId: user.id, type: "grounding_tool", key: tool, value: "Chosen in safety plan.", source: "onboarding" });
  }
  const reminder = String(formData.get("reminder") ?? "").trim();
  if (reminder) {
    writeMemory({ userId: user.id, type: "safety", key: "reminder_phrase", value: reminder.slice(0, 300), source: "onboarding" });
  }
  audit({ actorId: user.id, actorRole: "member", family: "clinical", type: "safety_plan_saved" });
  redirect("/onboarding/profile?step=companion");
}

export async function saveCompanionPrefs(formData: FormData) {
  const user = await requireMember();
  const db = getDb();
  db.prepare(
    `INSERT INTO ai_companion_preferences
       (user_id, preferred_user_name, tone, support_modes_json, avoidances_json, memory_enabled)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       preferred_user_name=excluded.preferred_user_name, tone=excluded.tone,
       support_modes_json=excluded.support_modes_json, avoidances_json=excluded.avoidances_json,
       memory_enabled=excluded.memory_enabled, updated_at=datetime('now')`
  ).run(
    user.id,
    String(formData.get("preferred_name") ?? "").slice(0, 60) || null,
    String(formData.get("tone") ?? "Gentle").slice(0, 30),
    JSON.stringify(formData.getAll("mode").map(String).slice(0, 10)),
    JSON.stringify(formData.getAll("avoid").map(String).slice(0, 10)),
    ["yes", "no", "ask"].includes(String(formData.get("memory"))) ? String(formData.get("memory")) : "yes"
  );
  audit({ actorId: user.id, actorRole: "member", family: "clinical", type: "companion_preferences_saved" });
  redirect("/onboarding/profile?step=summary");
}

export async function completeOnboardingProfile() {
  const user = await requireMember();
  upsertProfile(user.id, { profile_complete: "1" });
  audit({ actorId: user.id, actorRole: "member", family: "clinical", type: "onboarding_profile_complete" });
  redirect("/dashboard");
}

// ---------- AI companion (feature spec sections 8–9, 14–15) ----------

export async function sendCompanionMessage(
  conversationId: string | null,
  text: string
): Promise<{ conversationId: string; reply: string; riskFlag: boolean }> {
  const user = await requireMember();
  const trimmed = text.trim().slice(0, 2000);
  const db = getDb();

  let convId = conversationId;
  if (convId) {
    const owned = db
      .prepare("SELECT id FROM ai_conversations WHERE id = ? AND user_id = ?")
      .get(convId, user.id);
    if (!owned) convId = null;
  }
  if (!convId) {
    convId = newId();
    db.prepare("INSERT INTO ai_conversations (id, user_id, context_type) VALUES (?, ?, 'general')").run(
      convId,
      user.id
    );
  }

  // Deterministic crisis routing always runs first — the regex gate and its
  // canned 988/911 reply never depend on a model call succeeding. Otherwise
  // use the Claude-backed companion when configured, with the rules engine
  // as fallback so the demo still works without an API key or network.
  const ctx = buildCompanionContext(user.id);
  let reply;
  if (detectRisk(trimmed) || !aiCompanionEnabled()) {
    reply = generateReply(ctx, trimmed);
  } else {
    try {
      reply = await generateAiReply(ctx, convId, trimmed);
    } catch (err) {
      console.error("Companion AI call failed; using rules engine fallback:", err);
      reply = generateReply(ctx, trimmed);
    }
  }

  const insertMsg = db.prepare(
    "INSERT INTO ai_messages (id, conversation_id, user_id, sender, message_text, risk_flag) VALUES (?, ?, ?, ?, ?, ?)"
  );
  insertMsg.run(newId(), convId, user.id, "member", trimmed, reply.riskFlag ? 1 : 0);
  insertMsg.run(newId(), convId, user.id, "companion", reply.text, reply.riskFlag ? 1 : 0);

  if (reply.riskFlag) {
    db.prepare("UPDATE ai_conversations SET risk_level = 'urgent' WHERE id = ?").run(convId);
    createAlert({
      userId: user.id,
      type: "companion_risk_language",
      severity: "urgent",
      detail: "Risk language detected in a companion conversation. Companion routed the member to crisis resources.",
    });
  }
  audit({
    actorId: user.id,
    actorRole: "member",
    family: "clinical",
    type: "companion_message",
    target: convId,
    detail: { mode: reply.mode, riskFlag: reply.riskFlag },
  });
  return { conversationId: convId, reply: reply.text, riskFlag: reply.riskFlag };
}

// ---------- Memory privacy controls (feature spec section 10) ----------

export async function setMemoryEnabled(formData: FormData) {
  const user = await requireMember();
  const value = ["yes", "no", "ask"].includes(String(formData.get("memory")))
    ? String(formData.get("memory"))
    : "yes";
  getDb()
    .prepare(
      `INSERT INTO ai_companion_preferences (user_id, memory_enabled) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET memory_enabled = excluded.memory_enabled, updated_at = datetime('now')`
    )
    .run(user.id, value);
  audit({ actorId: user.id, actorRole: "member", family: "clinical", type: "companion_memory_setting", detail: { value } });
  revalidatePath("/settings/memory");
  redirect("/settings/memory");
}

export async function deleteMemoryItem(formData: FormData) {
  const user = await requireMember();
  const id = String(formData.get("id") ?? "");
  getDb()
    .prepare("UPDATE ai_memory_items SET active = 0, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .run(id, user.id);
  audit({ actorId: user.id, actorRole: "member", family: "clinical", type: "companion_memory_deleted", target: id });
  revalidatePath("/settings/memory");
  redirect("/settings/memory");
}

export async function clearCompanionMemory() {
  const user = await requireMember();
  getDb()
    .prepare("UPDATE ai_memory_items SET active = 0, updated_at = datetime('now') WHERE user_id = ?")
    .run(user.id);
  audit({ actorId: user.id, actorRole: "member", family: "clinical", type: "companion_memory_cleared" });
  revalidatePath("/settings/memory");
  redirect("/settings/memory");
}

export async function setTriggerActive(formData: FormData) {
  const user = await requireMember();
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "1" ? 1 : 0;
  getDb()
    .prepare("UPDATE user_triggers SET active = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .run(active, id, user.id);
  audit({ actorId: user.id, actorRole: "member", family: "clinical", type: "trigger_updated", target: id, detail: { active } });
  revalidatePath("/settings/memory");
  redirect("/settings/memory");
}

// ---------- Daily check-in ----------

export async function submitCheckin(formData: FormData) {
  const user = await requireMember();
  const values = {
    activation: Number(formData.get("activation") ?? 0),
    shutdown: Number(formData.get("shutdown") ?? 0),
    harm_urge: formData.get("harm_urge") === "yes",
    feels_safe: formData.get("feels_safe") === "yes",
    dissociation: Number(formData.get("dissociation") ?? 0),
    sleep_quality: Number(formData.get("sleep_quality") ?? 5),
    substance_flag: formData.get("substance_flag") === "yes",
  };
  const action = evaluateCheckin(values);
  // Known triggers the member says showed up today (trigger watch).
  const knownIds = new Set(getActiveTriggers(user.id).map((t) => t.id));
  const triggersToday = formData
    .getAll("trigger_today")
    .map(String)
    .filter((id) => knownIds.has(id));
  const db = getDb();
  db.prepare(
    `INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe,
       dissociation, sleep_quality, substance_flag, recommended_action, triggers_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, checkin_date) DO UPDATE SET
       activation=excluded.activation, shutdown=excluded.shutdown, harm_urge=excluded.harm_urge,
       feels_safe=excluded.feels_safe, dissociation=excluded.dissociation,
       sleep_quality=excluded.sleep_quality, substance_flag=excluded.substance_flag,
       recommended_action=excluded.recommended_action, triggers_json=excluded.triggers_json`
  ).run(
    newId(),
    user.id,
    todayISO(),
    values.activation,
    values.shutdown,
    values.harm_urge ? 1 : 0,
    values.feels_safe ? 1 : 0,
    values.dissociation,
    values.sleep_quality,
    values.substance_flag ? 1 : 0,
    action,
    JSON.stringify(triggersToday)
  );

  // Readiness recalculates over time: blend today's somatic state with the
  // slower-moving answers from the latest stored assessment.
  const base = getLatestReadiness(user.id);
  if (base) {
    const recalced = readinessFromCheckin(base, values);
    const { score, track } = computeReadiness(recalced);
    db.prepare(
      `INSERT INTO readiness_assessments
         (id, user_id, stability_score, body_safety_score, present_connection_score, symptom_intensity_score,
          sleep_quality, support_available, processing_readiness, pause_capacity, pace_preference,
          risk_flag, calculated_readiness_score, recommended_track, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'checkin')`
    ).run(
      newId(), user.id, recalced.stability, recalced.bodySafety, recalced.presentConnection,
      recalced.symptomIntensity, recalced.sleepQuality, recalced.supportAvailable,
      recalced.processingReadiness, recalced.pauseCapacity, base.pace_preference,
      recalced.riskFlag, score, track
    );
  }

  audit({
    actorId: user.id,
    actorRole: "member",
    family: "clinical",
    type: "checkin_submitted",
    detail: { ...values, recommended_action: action },
  });

  if (action === "crisis") {
    createAlert({
      userId: user.id,
      type: "checkin_safety_positive",
      severity: "urgent",
      detail: values.harm_urge
        ? "Member reported urge to harm self or others on daily check-in."
        : "Member reported not feeling safe where they are.",
    });
    redirect("/crisis?from=checkin");
  }
  redirect("/dashboard");
}

// ---------- Session runtime ----------

export async function startSession(moduleId: string) {
  const user = await requireMember();
  const mod = getModule(moduleId);
  if (!mod) redirect("/dashboard");
  const access = checkModuleAccess(user.id, mod);
  if (!access.allowed) redirect("/dashboard");

  const db = getDb();
  const id = newId();
  db.prepare(
    "INSERT INTO therapy_sessions (id, user_id, module_id) VALUES (?, ?, ?)"
  ).run(id, user.id, mod.id);
  audit({
    actorId: user.id,
    actorRole: "member",
    family: "module_runtime",
    type: "session_started",
    target: mod.id,
    detail: { sessionId: id },
  });
  return id;
}

export async function finishSession(args: {
  sessionId: string;
  outcome: "completed" | "hard_stop" | "abandoned";
  preSuds: number | null;
  postSuds: number | null;
  peakSuds: number | null;
  hardStopReason?: string;
  sudsTrail: number[];
}) {
  const user = await requireMember();
  const db = getDb();
  const session = db
    .prepare("SELECT id, module_id FROM therapy_sessions WHERE id = ? AND user_id = ?")
    .get(args.sessionId, user.id) as { id: string; module_id: string } | undefined;
  if (!session) return;

  db.prepare(
    `UPDATE therapy_sessions SET status = ?, pre_suds = ?, post_suds = ?, peak_suds = ?,
       hard_stop_reason = ?, detail_json = ?, ended_at = datetime('now')
     WHERE id = ?`
  ).run(
    args.outcome,
    args.preSuds,
    args.postSuds,
    args.peakSuds,
    args.hardStopReason ?? null,
    JSON.stringify({ sudsTrail: args.sudsTrail }),
    args.sessionId
  );

  audit({
    actorId: user.id,
    actorRole: "member",
    family: "module_runtime",
    type: `session_${args.outcome}`,
    target: session.module_id,
    detail: {
      sessionId: args.sessionId,
      preSuds: args.preSuds,
      postSuds: args.postSuds,
      peakSuds: args.peakSuds,
      hardStopReason: args.hardStopReason,
    },
  });

  if (args.outcome === "hard_stop") {
    createAlert({
      userId: user.id,
      type: "session_hard_stop",
      severity: "high",
      detail: `Hard stop in module ${session.module_id}: ${args.hardStopReason ?? "unspecified"}`,
    });
  }
}

export async function submitPostSessionCheck(formData: FormData) {
  const user = await requireMember();
  const sessionId = String(formData.get("sessionId") ?? "");
  const distress = Number(formData.get("distress") ?? 0);
  const oriented = formData.get("oriented") === "yes";
  const safeTonight = formData.get("safe_tonight") === "yes";
  const delayedRisk = Number(formData.get("delayed_risk") ?? 0);
  const recoveryConfirmed = formData.get("recovery_confirmed") === "on";

  const needsEscalation = !oriented || !safeTonight || distress >= 8 || delayedRisk >= 8;

  const db = getDb();
  db.prepare(
    `INSERT INTO post_session_checks
       (id, session_id, user_id, distress, oriented, safe_tonight, delayed_risk, recovery_confirmed, escalated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId(),
    sessionId,
    user.id,
    distress,
    oriented ? 1 : 0,
    safeTonight ? 1 : 0,
    delayedRisk,
    recoveryConfirmed ? 1 : 0,
    needsEscalation ? 1 : 0
  );

  audit({
    actorId: user.id,
    actorRole: "member",
    family: "clinical",
    type: "post_session_check",
    target: sessionId,
    detail: { distress, oriented, safeTonight, delayedRisk, recoveryConfirmed, needsEscalation },
  });

  if (!safeTonight) {
    createAlert({
      userId: user.id,
      type: "post_session_unsafe",
      severity: "urgent",
      detail: "Member reported they cannot stay safe until tomorrow after a session.",
    });
    redirect("/crisis?from=post-session");
  }
  if (needsEscalation) {
    createAlert({
      userId: user.id,
      type: "post_session_review",
      severity: "high",
      detail: `Post-session thresholds exceeded (distress ${distress}, oriented ${oriented}, delayed risk ${delayedRisk}).`,
    });
  }
  redirect("/dashboard?postSession=done");
}

// ---------- Unlock requests ----------

export async function requestUnlock(formData: FormData) {
  const user = await requireMember();
  const moduleId = String(formData.get("moduleId") ?? "");
  const note = String(formData.get("note") ?? "").slice(0, 500);
  const mod = getModule(moduleId);
  if (!mod || mod.tier !== "gated") redirect("/dashboard");

  const db = getDb();
  db.prepare(
    `INSERT INTO module_unlocks (id, user_id, module_id, member_note)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, module_id) DO UPDATE SET
       status = 'requested', member_note = excluded.member_note,
       requested_at = datetime('now'), decided_at = NULL, decision_reason = NULL`
  ).run(newId(), user.id, moduleId, note || null);

  createAlert({
    userId: user.id,
    type: "unlock_requested",
    severity: "moderate",
    detail: `Member requested unlock for module: ${mod.name}`,
  });
  audit({
    actorId: user.id,
    actorRole: "member",
    family: "clinical",
    type: "unlock_requested",
    target: moduleId,
  });
  redirect("/dashboard?unlock=requested");
}

// ---------- Clinician actions ----------

export async function decideUnlock(formData: FormData) {
  const clinician = await requireClinician();
  const unlockId = String(formData.get("unlockId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const reason = String(formData.get("reason") ?? "").slice(0, 1000);
  if (decision !== "unlocked" && decision !== "denied") return;
  if (!reason.trim()) redirect("/clinician?error=reason_required");

  const db = getDb();
  const unlock = db
    .prepare("SELECT id, user_id, module_id FROM module_unlocks WHERE id = ?")
    .get(unlockId) as { id: string; user_id: string; module_id: string } | undefined;
  if (!unlock) return;

  db.prepare(
    `UPDATE module_unlocks SET status = ?, clinician_id = ?, decision_reason = ?, decided_at = datetime('now')
     WHERE id = ?`
  ).run(decision, clinician.id, reason, unlockId);

  audit({
    actorId: clinician.id,
    actorRole: "clinician",
    family: "specialist_action",
    type: decision === "unlocked" ? "module_unlocked" : "module_unlock_denied",
    target: `${unlock.user_id}:${unlock.module_id}`,
    detail: { reason },
  });
  revalidatePath("/clinician");
  redirect("/clinician");
}

export async function reviewAlert(formData: FormData) {
  const clinician = await requireClinician();
  const alertId = String(formData.get("alertId") ?? "");
  const note = String(formData.get("note") ?? "").slice(0, 1000);
  if (!note.trim()) redirect("/clinician?error=note_required");

  const db = getDb();
  const alert = db
    .prepare("SELECT id, user_id, alert_type FROM alerts WHERE id = ? AND status = 'open'")
    .get(alertId) as { id: string; user_id: string; alert_type: string } | undefined;
  if (!alert) return;

  db.prepare(
    `UPDATE alerts SET status = 'reviewed', reviewed_by = ?, review_note = ?, reviewed_at = datetime('now')
     WHERE id = ?`
  ).run(clinician.id, note, alertId);

  audit({
    actorId: clinician.id,
    actorRole: "clinician",
    family: "specialist_action",
    type: "alert_reviewed",
    target: alert.id,
    detail: { alertType: alert.alert_type, memberId: alert.user_id, note },
  });
  revalidatePath("/clinician");
  redirect("/clinician");
}

export async function acknowledgeCrisis() {
  const user = await requireUser();
  audit({
    actorId: user.id,
    actorRole: user.role,
    family: "clinical",
    type: "crisis_screen_acknowledged",
  });
  redirect("/dashboard");
}
