import { data } from "./data";
import { MODULES, TherapyModule } from "./modules";
import { getLatestReadiness, getSafetyPlan, profileComplete } from "./profile";
import { subscriptionActive } from "./billing";
import { getFitnessState } from "./fitness-screener";
import { MAX_PROCESSING_PER_24H, SUDS_COOLDOWN_AT, sessionsKilled } from "./session-safety";

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
  triggers_json: string;
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

export async function getTodayCheckin(userId: string): Promise<CheckinRow | null> {
  const c = await data();
  const row = (await c.get("SELECT * FROM checkins WHERE user_id = ? AND checkin_date = ?", [
    userId,
    todayISO(),
  ])) as CheckinRow | undefined;
  return row ?? null;
}

export async function hasConsent(userId: string): Promise<boolean> {
  const c = await data();
  // Scope-specific: the wellness acknowledgment recorded at signup is a
  // separate consent and must not satisfy the informed-consent gate.
  const row = await c.get(
    "SELECT id FROM consents WHERE user_id = ? AND scope = 'care_program_full' AND revoked_at IS NULL LIMIT 1",
    [userId]
  );
  return !!row;
}

/** Whether the member has an active voice/biometric consent on file. */
export async function hasVoiceConsent(userId: string): Promise<boolean> {
  const c = await data();
  const row = await c.get(
    "SELECT id FROM consents WHERE user_id = ? AND scope = 'voice_biometric' AND revoked_at IS NULL LIMIT 1",
    [userId]
  );
  return !!row;
}

// Processing-session (BLS) consent — a distinct opt-in required before any
// bilateral-stimulation session (docs/autonomous/bls-validation).
export async function hasProcessingConsent(userId: string): Promise<boolean> {
  const c = await data();
  const row = await c.get(
    "SELECT id FROM consents WHERE user_id = ? AND scope = 'processing_session' AND revoked_at IS NULL LIMIT 1",
    [userId]
  );
  return !!row;
}

// Pure availability decision (audit-friendly, testable): voice/live is
// available in demo (for reviewers) OR when the feature flag is on AND the
// member has granted the distinct voice/biometric consent. Never on flag alone.
export function decideVoiceAvailability(env: {
  demo: boolean;
  flagOn: boolean;
  hasConsent: boolean;
}): boolean {
  if (env.demo) return true;
  return env.flagOn && env.hasConsent;
}

/** Is voice INPUT available for this member right now (env + consent)? */
export async function voiceAvailableFor(userId: string): Promise<boolean> {
  return decideVoiceAvailability({
    demo: process.env.EMDR_DEMO === "1",
    flagOn: process.env.EMDR_VOICE_INPUT === "1",
    hasConsent: await hasVoiceConsent(userId),
  });
}

/** Are LIVE spoken sessions available for this member right now? */
export async function liveAvailableFor(userId: string): Promise<boolean> {
  return decideVoiceAvailability({
    demo: process.env.EMDR_DEMO === "1",
    flagOn: process.env.EMDR_LIVE_SESSION === "1",
    hasConsent: await hasVoiceConsent(userId),
  });
}

export async function screeningComplete(userId: string): Promise<boolean> {
  const c = await data();
  const rows = (await c.all("SELECT DISTINCT instrument FROM screenings WHERE user_id = ?", [
    userId,
  ])) as { instrument: string }[];
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
  override: number;
  requested_at: string;
  decided_at: string | null;
}

export async function getUnlock(userId: string, moduleId: string): Promise<UnlockRow | null> {
  const c = await data();
  const row = (await c.get("SELECT * FROM module_unlocks WHERE user_id = ? AND module_id = ?", [
    userId,
    moduleId,
  ])) as UnlockRow | undefined;
  return row ?? null;
}

export async function completedModuleIds(userId: string): Promise<Set<string>> {
  const c = await data();
  const rows = (await c.all(
    "SELECT DISTINCT module_id FROM therapy_sessions WHERE user_id = ? AND status = 'completed'",
    [userId]
  )) as { module_id: string }[];
  return new Set(rows.map((r) => r.module_id));
}

export type ModuleAccess =
  | { allowed: true }
  | {
      allowed: false;
      reason: string;
      action: "subscribe" | "consent" | "screening" | "profile" | "checkin" | "crisis" | "grounding" | "unlock" | "prereq" | "readiness" | "safety_plan" | "paused" | "cooldown";
    };

const GROUNDING_MODULES = new Set(["calm-place", "containment"]);

export async function checkModuleAccess(userId: string, mod: TherapyModule): Promise<ModuleAccess> {
  // Global kill switch (compliance 4D): new session starts can be disabled
  // within minutes if a safety defect is found in production.
  if (sessionsKilled())
    return {
      allowed: false,
      reason: "New sessions are temporarily paused for maintenance. Grounding tools and your companion remain open.",
      action: "paused",
    };
  if (!(await subscriptionActive(userId)))
    return { allowed: false, reason: "An active membership is needed for sessions.", action: "subscribe" };
  if (!(await hasConsent(userId)))
    return { allowed: false, reason: "Please review and complete consent first.", action: "consent" };

  // Fitness screener (compliance 4A) gates everything session-shaped.
  const fitness = await getFitnessState(userId);
  if (fitness.status === "none")
    return { allowed: false, reason: "Please complete the program-fit questions first.", action: "screening" };
  if (fitness.status === "cooldown")
    return {
      allowed: false,
      reason: "Based on your fit questions, this program isn't the right fit right now. The crisis page has support that can help today.",
      action: "crisis",
    };

  if (!(await screeningComplete(userId)))
    return { allowed: false, reason: "Please complete your baseline screening first.", action: "screening" };
  if (!(await profileComplete(userId)))
    return { allowed: false, reason: "Finish getting set up first — triggers, readiness, and your safety plan.", action: "profile" };

  const checkin = await getTodayCheckin(userId);
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

  // A clinician override opens a gated module ahead of the program's pacing.
  // It relaxes only the pacing gates below (readiness track + prerequisites) —
  // never the daily safety read above (check-in crisis/grounding/stabilization)
  // or the cooldown/cap checks further down.
  const unlockRow = mod.tier === "gated" ? await getUnlock(userId, mod.id) : null;
  const override = !!unlockRow && unlockRow.status === "unlocked" && unlockRow.override === 1;

  // Readiness track gating (feature spec section 5). The language never
  // implies failure: today may simply be better for grounding.
  const readiness = await getLatestReadiness(userId);
  if (readiness && !override) {
    if (readiness.recommended_track === "stabilization" && !GROUNDING_MODULES.has(mod.id))
      return {
        allowed: false,
        reason: "Your current readiness track is Stabilization — grounding modules, safety planning, and your companion are open. Processing can wait.",
        action: "readiness",
      };
    if (readiness.recommended_track === "preparation" && mod.tier === "gated")
      return {
        allowed: false,
        reason: "Your current readiness track is Preparation. Trigger awareness, grounding, and resourcing come first; processing modules open as readiness grows.",
        action: "readiness",
      };
  }

  // Deeper work requires a completed safety plan (spec section 18).
  if (mod.tier === "gated" && !(await getSafetyPlan(userId)))
    return {
      allowed: false,
      reason: "Before deeper work, Steady needs your safety plan — grounding tools, a support contact, and your stop signs.",
      action: "safety_plan",
    };

  const completed = await completedModuleIds(userId);
  const missing = override ? [] : mod.prerequisiteIds.filter((p) => !completed.has(p));
  if (missing.length > 0) {
    const names = missing
      .map((id) => MODULES.find((m) => m.id === id)?.name ?? id)
      .join(", ");
    return { allowed: false, reason: `Complete first: ${names}.`, action: "prereq" };
  }

  if (mod.tier === "gated") {
    const unlock = unlockRow;
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

    const c = await data();
    const dayAgo = new Date(Date.now() - 86400000).toISOString().slice(0, 19).replace("T", " ");
    // Hard cap: at most N processing sessions per 24 hours (compliance 4B.3).
    const recent = (await c.get(
      `SELECT COUNT(*) AS n FROM therapy_sessions
         WHERE user_id = ? AND started_at > ?
           AND module_id IN (${MODULES.filter((m) => m.tier === "gated").map(() => "?").join(",")})`,
      [userId, dayAgo, ...MODULES.filter((m) => m.tier === "gated").map((m) => m.id)]
    )) as { n: number };
    if (recent.n >= MAX_PROCESSING_PER_24H)
      return {
        allowed: false,
        reason: "Processing sessions are limited to one per day — that pacing protects the work. Stabilization and grounding stay open.",
        action: "cooldown",
      };

    // High distress at the end of a recent session puts processing on a 24h
    // cooldown (compliance 4B.2); stabilization modules remain available.
    const hot = (await c.get(
      `SELECT COUNT(*) AS n FROM therapy_sessions
         WHERE user_id = ? AND ended_at > ? AND post_suds >= ?`,
      [userId, dayAgo, SUDS_COOLDOWN_AT]
    )) as { n: number };
    if (hot.n > 0)
      return {
        allowed: false,
        reason: "Your last session ended with distress still high, so processing is resting for 24 hours. Grounding and stabilization are open, and your companion is here.",
        action: "cooldown",
      };
  }

  return { allowed: true };
}
