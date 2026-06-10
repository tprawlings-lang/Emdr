import { getDb } from "./db";
import { MODULES, TherapyModule } from "./modules";

// Gating rules from the executive plan: every session entry point routes
// through consent -> screening -> today's check-in -> tier/unlock checks.
// The app never makes a hidden treatment decision; every block reason is
// shown to the user and visible to the clinician.

export interface CheckinRow {
  id: string;
  user_id: string;
  checkin_date: string;
  activation: number;
  shutdown: number;
  harm_urge: number;
  feels_safe: number;
  dissociation: number;
  sleep_quality: number;
  substance_flag: number;
  recommended_action: string;
  created_at: string;
}

export type RecommendedAction =
  | "crisis"
  | "grounding_only"
  | "stabilization"
  | "processing_ok"
  | "clinician_contact";

export function evaluateCheckin(c: {
  activation: number;
  shutdown: number;
  harm_urge: boolean;
  feels_safe: boolean;
  dissociation: number;
  sleep_quality: number;
  substance_flag: boolean;
}): RecommendedAction {
  if (c.harm_urge || !c.feels_safe) return "crisis";
  if (c.dissociation >= 7) return "grounding_only";
  if (c.activation >= 8 || c.shutdown >= 8) return "grounding_only";
  if (c.substance_flag || c.sleep_quality <= 2 || c.dissociation >= 4) return "stabilization";
  return "processing_ok";
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getTodayCheckin(userId: string): CheckinRow | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM checkins WHERE user_id = ? AND checkin_date = ?")
    .get(userId, todayISO()) as CheckinRow | undefined;
  return row ?? null;
}

export function hasConsent(userId: string): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT id FROM consents WHERE user_id = ? AND revoked_at IS NULL LIMIT 1")
    .get(userId);
  return !!row;
}

export function screeningComplete(userId: string): boolean {
  const db = getDb();
  const rows = db
    .prepare("SELECT DISTINCT instrument FROM screenings WHERE user_id = ?")
    .all(userId) as { instrument: string }[];
  const done = new Set(rows.map((r) => r.instrument));
  return ["pc-ptsd-5", "pcl-5", "itq", "phq-9", "gad-7"].every((i) => done.has(i));
}

export interface UnlockRow {
  id: string;
  user_id: string;
  module_id: string;
  status: "requested" | "unlocked" | "denied" | "revoked";
  member_note: string | null;
  clinician_id: string | null;
  decision_reason: string | null;
  requested_at: string;
  decided_at: string | null;
}

export function getUnlock(userId: string, moduleId: string): UnlockRow | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM module_unlocks WHERE user_id = ? AND module_id = ?")
    .get(userId, moduleId) as UnlockRow | undefined;
  return row ?? null;
}

export function completedModuleIds(userId: string): Set<string> {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT DISTINCT module_id FROM therapy_sessions WHERE user_id = ? AND status = 'completed'"
    )
    .all(userId) as { module_id: string }[];
  return new Set(rows.map((r) => r.module_id));
}

export type ModuleAccess =
  | { allowed: true }
  | { allowed: false; reason: string; action: "consent" | "screening" | "checkin" | "crisis" | "grounding" | "unlock" | "prereq" };

const GROUNDING_MODULES = new Set(["calm-place", "containment"]);

export function checkModuleAccess(userId: string, mod: TherapyModule): ModuleAccess {
  if (!hasConsent(userId))
    return { allowed: false, reason: "Please review and complete consent first.", action: "consent" };
  if (!screeningComplete(userId))
    return { allowed: false, reason: "Please complete your baseline screening first.", action: "screening" };

  const checkin = getTodayCheckin(userId);
  if (!checkin)
    return { allowed: false, reason: "Complete today's check-in before starting a session.", action: "checkin" };

  if (checkin.recommended_action === "crisis")
    return {
      allowed: false,
      reason: "Today's check-in flagged safety concerns. Sessions are paused while your care team reviews.",
      action: "crisis",
    };

  if (checkin.recommended_action === "grounding_only" && !GROUNDING_MODULES.has(mod.id))
    return {
      allowed: false,
      reason: "Based on today's check-in, only grounding modules (Calm Place, Containment) are available today.",
      action: "grounding",
    };

  if (checkin.recommended_action === "stabilization" && mod.tier === "gated")
    return {
      allowed: false,
      reason: "Today's check-in suggests keeping intensity lower. Processing modules are unavailable today; stabilization modules are open.",
      action: "grounding",
    };

  const completed = completedModuleIds(userId);
  const missing = mod.prerequisiteIds.filter((p) => !completed.has(p));
  if (missing.length > 0) {
    const names = missing
      .map((id) => MODULES.find((m) => m.id === id)?.name ?? id)
      .join(", ");
    return { allowed: false, reason: `Complete first: ${names}.`, action: "prereq" };
  }

  if (mod.tier === "gated") {
    const unlock = getUnlock(userId, mod.id);
    if (!unlock || unlock.status !== "unlocked")
      return {
        allowed: false,
        reason:
          unlock?.status === "requested"
            ? "Unlock requested — waiting for your specialist's review."
            : unlock?.status === "denied"
              ? "Your specialist has not approved this module yet. They will discuss next steps with you."
              : "This module requires specialist review and unlock.",
        action: "unlock",
      };
  }

  return { allowed: true };
}
