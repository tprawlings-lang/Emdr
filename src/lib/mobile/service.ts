// Mobile service layer — the shared core the JSON API route handlers call.
//
// This deliberately reuses the SAME deterministic helpers the web app's Server
// Actions use (evaluateCheckin, checkModuleAccess, readiness recompute, gating
// gates), so the iOS client and the website behave identically and stay in
// sync. Route handlers stay thin: parse → authenticate → call one of these →
// return JSON.
//
// NOTE: the web Server Actions in lib/actions.ts remain the source of truth for
// the browser. Ideally both would call this module; for now the logic is
// mirrored here 1:1. Keep them in lockstep when either changes.

import { data } from "../data";
import { makeSessionToken, type SessionUser } from "../auth";
import { newId, verifyPassword } from "../db";
import {
  checkModuleAccess,
  evaluateCheckin,
  getTodayCheckin,
  hasConsent,
  liveAvailableFor,
  screeningComplete,
  todayISO,
} from "../gating";
import { subscriptionActive } from "../billing";
import { getFitnessState } from "../fitness-screener";
import { nextStep } from "./onboarding";
import {
  computeReadiness,
  getLatestReadiness,
  profileComplete,
  readinessFromCheckin,
} from "../profile";
import { MODULES, getModule, type TherapyModule } from "../modules";
import { audit } from "../audit";

// ---------- shared shapes (the mobile API contract) ----------

export interface CheckinValues {
  activation: number;
  shutdown: number;
  harm_urge: boolean;
  feels_safe: boolean;
  dissociation: number;
  sleep_quality: number;
  substance_flag: boolean;
}

export interface ModuleDTO {
  id: string;
  order: number;
  name: string;
  tier: TherapyModule["tier"];
  objective: string;
  durationLabel: string;
  allowed: boolean;
  reason: string | null;
  action: string | null;
}

export interface GatingSnapshot {
  subscriptionActive: boolean;
  hasConsent: boolean;
  screeningComplete: boolean;
  profileComplete: boolean;
  fitnessStatus: string;               // none | pass | soft_flag | cooldown
  retakeInHours: number | null;
  seizureFlag: boolean;                // audio-only default
  liveVoiceAvailable: boolean;         // in-session spoken responder enabled
  nextStep: string;                    // subscribe|consent|screener|...|ready
  todayCheckin: { date: string; action: string } | null;
}

// ---------- alerts (mirrors the private createAlert in lib/actions.ts) ----------

async function createAlert(args: {
  userId: string;
  type: string;
  severity: "urgent" | "high" | "moderate" | "info";
  detail: string;
}) {
  const c = await data();
  await c.run("INSERT INTO alerts (id, user_id, alert_type, severity, detail) VALUES (?, ?, ?, ?, ?)", [
    newId(),
    args.userId,
    args.type,
    args.severity,
    args.detail,
  ]);
}

// ---------- auth ----------

export async function loginMobile(
  email: string,
  password: string
): Promise<{ token: string; user: SessionUser } | null> {
  const normalized = email.trim().toLowerCase();
  const c = await data();
  const row = (await c.get(
    "SELECT id, email, name, role, password_hash FROM users WHERE email = ? AND status = 'active'",
    [normalized]
  )) as { id: string; email: string; name: string; role: SessionUser["role"]; password_hash: string } | undefined;

  if (!row || !verifyPassword(password, row.password_hash)) {
    await audit({ family: "identity", type: "login_failed", target: normalized });
    return null;
  }
  await audit({ actorId: row.id, actorRole: row.role, family: "identity", type: "login_success", detail: { via: "mobile" } });
  const token = await makeSessionToken(row.id);
  return { token, user: { id: row.id, email: row.email, name: row.name, role: row.role } };
}

// ---------- gating snapshot + module access ----------

export async function gatingSnapshot(userId: string): Promise<GatingSnapshot> {
  const [sub, consent, screening, profile, checkin, fit, next, liveVoice] = await Promise.all([
    subscriptionActive(userId),
    hasConsent(userId),
    screeningComplete(userId),
    profileComplete(userId),
    getTodayCheckin(userId),
    getFitnessState(userId),
    nextStep(userId),
    liveAvailableFor(userId),
  ]);
  return {
    subscriptionActive: sub,
    hasConsent: consent,
    screeningComplete: screening,
    profileComplete: profile,
    fitnessStatus: fit.status,
    retakeInHours: fit.retakeInHours ?? null,
    seizureFlag: fit.flags.includes("soft_flag:seizure_disorder"),
    liveVoiceAvailable: liveVoice,
    nextStep: next.step,
    todayCheckin: checkin
      ? { date: checkin.checkin_date, action: checkin.recommended_action }
      : null,
  };
}

export async function moduleCatalog(userId: string): Promise<ModuleDTO[]> {
  const out: ModuleDTO[] = [];
  for (const mod of MODULES) {
    const access = await checkModuleAccess(userId, mod);
    out.push({
      id: mod.id,
      order: mod.order,
      name: mod.name,
      tier: mod.tier,
      objective: mod.objective,
      durationLabel: mod.durationLabel,
      allowed: access.allowed,
      reason: access.allowed ? null : access.reason,
      action: access.allowed ? null : access.action,
    });
  }
  return out.sort((a, b) => a.order - b.order);
}

// ---------- check-ins ----------

export async function submitCheckinMobile(
  userId: string,
  values: CheckinValues
): Promise<{ action: string; date: string }> {
  const action = evaluateCheckin(values);
  const c = await data();
  const date = todayISO();
  await c.run(
    `INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe,
       dissociation, sleep_quality, substance_flag, recommended_action, triggers_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, checkin_date) DO UPDATE SET
       activation=excluded.activation, shutdown=excluded.shutdown, harm_urge=excluded.harm_urge,
       feels_safe=excluded.feels_safe, dissociation=excluded.dissociation,
       sleep_quality=excluded.sleep_quality, substance_flag=excluded.substance_flag,
       recommended_action=excluded.recommended_action, triggers_json=excluded.triggers_json`,
    [
      newId(), userId, date,
      values.activation, values.shutdown,
      values.harm_urge ? 1 : 0, values.feels_safe ? 1 : 0,
      values.dissociation, values.sleep_quality, values.substance_flag ? 1 : 0,
      action, JSON.stringify([]),
    ]
  );

  // Readiness recompute — identical to submitCheckin in lib/actions.ts.
  try {
    const base = await getLatestReadiness(userId);
    if (base) {
      const recalced = readinessFromCheckin(base, values);
      const { score, track } = computeReadiness(recalced);
      await c.run(
        `INSERT INTO readiness_assessments
           (id, user_id, stability_score, body_safety_score, present_connection_score, symptom_intensity_score,
            sleep_quality, support_available, processing_readiness, pause_capacity, pace_preference,
            risk_flag, calculated_readiness_score, recommended_track, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'checkin')`,
        [
          newId(), userId, recalced.stability, recalced.bodySafety, recalced.presentConnection,
          recalced.symptomIntensity, recalced.sleepQuality, recalced.supportAvailable,
          recalced.processingReadiness, recalced.pauseCapacity, base.pace_preference,
          recalced.riskFlag, score, track,
        ]
      );
    }
  } catch {
    // Readiness recompute is best-effort; the check-in itself is saved above.
  }

  await audit({
    actorId: userId, actorRole: "member", family: "clinical",
    type: "checkin_submitted", detail: { ...values, recommended_action: action, via: "mobile" },
  });

  if (action === "crisis") {
    await createAlert({
      userId, type: "checkin_safety_positive", severity: "urgent",
      detail: values.harm_urge
        ? "Member reported urge to harm self or others on daily check-in (mobile)."
        : "Member reported not feeling safe where they are (mobile).",
    });
  }
  return { action, date };
}

export async function listCheckins(userId: string, sinceISO?: string) {
  const c = await data();
  const rows = await c.all(
    `SELECT checkin_date, activation, shutdown, harm_urge, feels_safe, dissociation,
            sleep_quality, substance_flag, recommended_action
       FROM checkins WHERE user_id = ? ${sinceISO ? "AND checkin_date >= ?" : ""}
       ORDER BY checkin_date DESC LIMIT 120`,
    sinceISO ? [userId, sinceISO] : [userId]
  );
  return rows;
}

// ---------- sessions ----------

export type SessionStartResult =
  | { ok: true; sessionId: string }
  | { ok: false; reason: string; action: string };

export async function startSessionMobile(
  userId: string,
  moduleId: string,
  focus?: string
): Promise<SessionStartResult> {
  const mod = getModule(moduleId);
  if (!mod) return { ok: false, reason: "Unknown module.", action: "dashboard" };
  const access = await checkModuleAccess(userId, mod);
  if (!access.allowed) return { ok: false, reason: access.reason, action: access.action };

  const chosenFocus = focus?.trim().slice(0, 200) || null;
  const c = await data();
  const id = newId();
  await c.run(
    "INSERT INTO therapy_sessions (id, user_id, module_id, detail_json) VALUES (?, ?, ?, ?)",
    [id, userId, mod.id, JSON.stringify(chosenFocus ? { focus: chosenFocus } : {})]
  );
  await audit({
    actorId: userId, actorRole: "member", family: "module_runtime",
    type: "session_started", target: mod.id, detail: { sessionId: id, focus: chosenFocus, via: "mobile" },
  });
  return { ok: true, sessionId: id };
}

export async function finishSessionMobile(
  userId: string,
  args: {
    sessionId: string;
    outcome: "completed" | "hard_stop" | "abandoned";
    preSuds: number | null;
    postSuds: number | null;
    peakSuds: number | null;
    hardStopReason?: string | null;
    sudsTrail: number[];
  }
): Promise<{ ok: boolean }> {
  const c = await data();
  const session = (await c.get(
    "SELECT id, module_id, detail_json FROM therapy_sessions WHERE id = ? AND user_id = ?",
    [args.sessionId, userId]
  )) as { id: string; module_id: string; detail_json: string } | undefined;
  if (!session) return { ok: false };

  let detail: Record<string, unknown> = {};
  try { detail = JSON.parse(session.detail_json) as Record<string, unknown>; } catch { detail = {}; }
  detail.sudsTrail = args.sudsTrail;

  await c.run(
    `UPDATE therapy_sessions SET status = ?, pre_suds = ?, post_suds = ?, peak_suds = ?,
       hard_stop_reason = ?, detail_json = ?, ended_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [args.outcome, args.preSuds, args.postSuds, args.peakSuds, args.hardStopReason ?? null,
     JSON.stringify(detail), args.sessionId]
  );
  await audit({
    actorId: userId, actorRole: "member", family: "module_runtime",
    type: `session_${args.outcome}`, target: session.module_id,
    detail: { sessionId: args.sessionId, preSuds: args.preSuds, postSuds: args.postSuds, peakSuds: args.peakSuds, hardStopReason: args.hardStopReason, via: "mobile" },
  });
  if (args.outcome === "hard_stop") {
    await createAlert({
      userId, type: "session_hard_stop", severity: "high",
      detail: `Hard stop in module ${session.module_id} (mobile): ${args.hardStopReason ?? "unspecified"}`,
    });
  }
  return { ok: true };
}

export async function listSessions(userId: string, sinceISO?: string) {
  const c = await data();
  const rows = await c.all(
    `SELECT id, module_id, status, pre_suds, post_suds, peak_suds, hard_stop_reason,
            detail_json, started_at, ended_at
       FROM therapy_sessions WHERE user_id = ? ${sinceISO ? "AND started_at >= ?" : ""}
       ORDER BY started_at DESC LIMIT 100`,
    sinceISO ? [userId, sinceISO] : [userId]
  );
  return rows;
}

// Mirrors logSafetyEvent in lib/actions.ts: same whitelist, same family, and
// the sessionId travels in `target` (coded ids only — never user content).
const SAFETY_EVENT_TYPES = new Set([
  "ground_me_pressed",
  "suds_pause",
  "session_time_cap",
  "session_winddown_shown",
]);

export async function logSafetyEventMobile(userId: string, type: string, sessionId?: string) {
  if (!SAFETY_EVENT_TYPES.has(type)) return;
  await audit({
    actorId: userId,
    actorRole: "member",
    family: "safety",
    type,
    target: sessionId,
  });
}
