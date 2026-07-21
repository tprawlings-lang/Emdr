// Deterministic safety core — DB adapter (Autonomous Step 2).
//
// Reads resolved facts from the database into SafetyInputs for evaluateAccess().
// This is the ONE impure boundary; the engine itself stays pure. Every read is
// best-effort and conservative: any missing/unparseable input is left undefined
// so the engine treats it as unfavorable (never favorable — Vol II §11).
//
// Mappings from the current schema to the spec are PROVISIONAL (ledger). This
// runs in shadow mode until EMDR_AUTONOMOUS_SAFETY=1.

import { getDb } from "../db";
import { decryptField } from "../crypto";
import { getTodayCheckin } from "../gating";
import { getLatestReadiness } from "../profile";
import { FITNESS_SCREENER_ID } from "../fitness-screener";
import { SUDS_COOLDOWN_AT } from "../session-safety";
import { mapProgramFit, type FitnessAnswers } from "./program-fit";
import { scoreReadiness, type ReadinessDomains } from "./readiness";
import type { SafetyInputs } from "./types";

const HOUR_MS = 3600 * 1000;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Parse a readiness-form scale string into an approximate 0–10 value. */
function scaleToNum(v: string | null | undefined, dflt = 5): number {
  if (v == null) return dflt;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(0, Math.min(10, n));
  const s = v.toLowerCase();
  if (/(never|no\b|not|rarely|unable)/.test(s)) return 1;
  if (/(sometimes|somewhat|unsure|maybe)/.test(s)) return 4;
  if (/(usually|often|mostly|yes|able)/.test(s)) return 8;
  if (/(always|very|fully|confident)/.test(s)) return 9;
  return dflt;
}

function latestItemAnswers(userId: string, instrument: string): number[] | null {
  const row = getDb()
    .prepare(
      "SELECT answers_json FROM screenings WHERE user_id = ? AND instrument = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"
    )
    .get(userId, instrument) as { answers_json: string } | undefined;
  if (!row) return null;
  const parsed = JSON.parse(decryptField(row.answers_json));
  return Array.isArray(parsed) ? (parsed as number[]) : null;
}

export function gatherSafetyInputs(userId: string, nowMs: number): SafetyInputs {
  const db = getDb();
  const inputs: SafetyInputs = { nowMs };

  // ── Program-fit (coded 0/1 answers stored under the fitness screener) ─────
  inputs.programFit = safe(() => {
    const row = db
      .prepare(
        "SELECT answers_json, created_at FROM screenings WHERE user_id = ? AND instrument = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"
      )
      .get(userId, FITNESS_SCREENER_ID) as { answers_json: string; created_at: string } | undefined;
    const user = db.prepare("SELECT dob FROM users WHERE id = ?").get(userId) as { dob: string | null } | undefined;
    let under18 = false;
    if (user?.dob) {
      const age = (nowMs - new Date(user.dob).getTime()) / (365.25 * 24 * HOUR_MS);
      under18 = age < 18;
    }
    if (!row) return { under18 };
    const coded = JSON.parse(row.answers_json) as Record<string, number>;
    const answers: FitnessAnswers = {};
    for (const [k, v] of Object.entries(coded)) answers[k] = v === 1;
    const atMs = new Date(row.created_at + "Z").getTime();
    return mapProgramFit(answers, { under18, stateHardStopAtMs: Number.isFinite(atMs) ? atMs : null });
  }, undefined);

  // ── Today's check-in ──────────────────────────────────────────────────────
  inputs.dailyCheckin = safe(() => {
    const c = getTodayCheckin(userId);
    if (!c) return undefined;
    return {
      activation: c.activation,
      shutdown: c.shutdown,
      harmUrge: c.harm_urge === 1,
      feelsSafe: c.feels_safe === 1,
      dissociation: c.dissociation,
      sleepQuality: c.sleep_quality,
      substanceFlag: c.substance_flag === 1,
    };
  }, undefined);

  // ── Item-level instrument safety ──────────────────────────────────────────
  inputs.instruments = safe(() => {
    const phq9 = latestItemAnswers(userId, "phq-9");
    const pcl5 = latestItemAnswers(userId, "pcl-5");
    return {
      phq9Item9: phq9 && phq9.length >= 9 ? phq9[8] : undefined, // item 9 (0-indexed 8)
      pcl5Item16: pcl5 && pcl5.length >= 16 ? pcl5[15] : undefined, // item 16
    };
  }, undefined);

  // ── Readiness (approximate mapping from the readiness assessment) ─────────
  inputs.readiness = safe(() => {
    const r = getLatestReadiness(userId);
    if (!r) return undefined;
    const domains: ReadinessDomains = {
      stability: r.stability_score,
      bodySafety: r.body_safety_score,
      presentConnection: r.present_connection_score,
      symptomIntensity: r.symptom_intensity_score,
      sleep: scaleToNum(r.sleep_quality),
      support: scaleToNum(r.support_available),
      selfReadiness: scaleToNum(r.processing_readiness),
      pauseCapacity: scaleToNum(r.pause_capacity),
      feelsFullySafe: r.body_safety_score >= 7,
      riskFlag: r.risk_flag !== "none",
    };
    const scored = scoreReadiness(domains);
    return { track: scored.track, ...scored.caps };
  }, undefined);

  // ── Cooldowns derived from recent high-distress sessions ──────────────────
  inputs.activeCooldowns = safe(() => {
    const hot = db
      .prepare(
        "SELECT ended_at FROM therapy_sessions WHERE user_id = ? AND ended_at IS NOT NULL AND post_suds >= ? ORDER BY ended_at DESC LIMIT 1"
      )
      .get(userId, SUDS_COOLDOWN_AT) as { ended_at: string } | undefined;
    if (!hot) return [];
    const endMs = new Date(hot.ended_at + "Z").getTime();
    const until = endMs + 24 * HOUR_MS;
    return until > nowMs ? [{ id: "derived-hot", kind: "containment" as const, untilMs: until }] : [];
  }, []);

  return inputs;
}
