"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb, newId, verifyPassword } from "./db";
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

export async function submitScreening(formData: FormData) {
  const user = await requireMember();
  const instrumentId = String(formData.get("instrument") ?? "");
  const instrument = getInstrument(instrumentId);
  if (!instrument) redirect("/screening");

  const answers: number[] = instrument.items.map((_, i) =>
    Number(formData.get(`item-${i}`) ?? -1)
  );
  if (answers.some((a) => a < 0)) redirect(`/screening?incomplete=${instrumentId}`);

  const { total, riskFlags } = scoreInstrument(instrument, answers);
  const db = getDb();
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
    detail: { total, riskFlags, version: instrument.version },
  });

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
  redirect("/screening");
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
  const db = getDb();
  db.prepare(
    `INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe,
       dissociation, sleep_quality, substance_flag, recommended_action)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, checkin_date) DO UPDATE SET
       activation=excluded.activation, shutdown=excluded.shutdown, harm_urge=excluded.harm_urge,
       feels_safe=excluded.feels_safe, dissociation=excluded.dissociation,
       sleep_quality=excluded.sleep_quality, substance_flag=excluded.substance_flag,
       recommended_action=excluded.recommended_action`
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
    action
  );

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
