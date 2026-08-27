import { data } from "./data";
import { MODULES, TherapyModule } from "./modules";
import { getLatestReadiness, getSafetyPlan, profileComplete } from "./profile";
import { subscriptionActive } from "./billing";
import { getFitnessState } from "./fitness-screener";
import { MAX_PROCESSING_PER_24H, SUDS_COOLDOWN_AT, sessionsKilled } from "./session-safety";
import { GROUNDING_MODULE_IDS as GROUNDING_MODULES, engineModuleVerdict } from "./safety/module-verdict";

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

/** Whether a self-guided resourcing (Calm/Safe Place) BLS session may be offered
 *  to this member right now: the Phase-4a flag is on, the BLS kill switch is off,
 *  and the member has granted the processing-session consent. Clinical exclusions
 *  are enforced separately (`resourcingClinicallyBlocked` against the access
 *  decision) at the session route. */
export async function resourcingBlsAvailable(userId: string): Promise<boolean> {
  const { blsResourcingEnabled } = await import("./safety/config");
  const { blsDisabled } = await import("./safety/governance");
  if (!blsResourcingEnabled() || blsDisabled()) return false;
  return hasProcessingConsent(userId);
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
      action: "subscribe" | "upgrade" | "consent" | "screening" | "profile" | "checkin" | "crisis" | "grounding" | "unlock" | "prereq" | "readiness" | "safety_plan" | "paused" | "cooldown";
    };

// GROUNDING_MODULES is imported from safety/module-verdict (single source of truth).

// DEMO ONLY. Opens the gated modules without a per-member clinician unlock, so
// the full module set can be exercised in a testing cycle. It behaves like a
// clinician override — relaxing the unlock requirement + readiness track +
// prerequisites — but NEVER the daily safety read (crisis / grounding-only /
// stabilization), the cooldown, the per-day cap, or the kill switch. Inert on
// any real deployment (EMDR_DEMO unset), so it can never open processing
// modules for a real member.
//
// ON by default in demo. A reviewer who is not a clinician — an executive, an
// investor, a security reviewer — has no way to unlock a module for themselves,
// so leaving this off meant most of the product was unreachable for most of the
// people the environment exists for.
//
// Set EMDR_OPEN_GATED=0 to turn it off in a demo environment. That is the
// setting a clinician wants when reviewing the UNLOCK WORKFLOW itself: with
// modules already open, the request-and-approve path never runs. Both
// directions are useful, so both are available and the clinician testing page
// says which one is active.
export function testOpenGated(): boolean {
  if (process.env.EMDR_DEMO !== "1") return false;
  return process.env.EMDR_OPEN_GATED !== "0";
}

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
  // The guided module program is a Plus/Premium feature. Base keeps the whole
  // regulate suite, Learn, Ground, and SOS — safety is never tier-gated.
  {
    const { getEntitlements } = await import("./entitlements");
    const ent = await getEntitlements(userId);
    if (ent && !ent.program)
      return {
        allowed: false,
        reason: "Guided sessions are part of Plus and Premium. Your practices, lessons, and grounding tools are all still here.",
        action: "upgrade",
      };
  }
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
  const override =
    (!!unlockRow && unlockRow.status === "unlocked" && unlockRow.override === 1) ||
    (mod.tier === "gated" && testOpenGated());

  // Engine-to-govern (README §14.7 step 4). When EMDR_AUTONOMOUS_SAFETY is on,
  // the deterministic engine governs — MOST-RESTRICTIVE-WINS. It can AUTO-UNLOCK
  // a gated module it has deterministically cleared (replacing the manual
  // clinician unlock) and can additionally CLOSE any module it deems unsafe. It
  // relaxes NOTHING else: every deterministic safety + pacing gate (daily
  // check-in read, readiness track, safety plan, prerequisites, cooldown, cap,
  // kill switch) still holds. Default OFF → this block is inert and the human
  // gate governs exactly as today, so the flip is config-only. (decideAccess is
  // dynamically imported to avoid a static gating↔safety cycle.)
  const governed = process.env.EMDR_AUTONOMOUS_SAFETY === "1";
  let engineAllows = true;
  let engineReason: string | null = null;
  if (governed) {
    const { decideAccess } = await import("./safety/decide");
    const nowMs = Date.now();
    const decision = await decideAccess(userId, nowMs);
    engineAllows = engineModuleVerdict(decision, mod, nowMs);
    engineReason = decision.primaryReason;
  }

  // A human decision to open a gated module (clinician override, or a granted
  // unlock) stands in both governed and human-in-the-loop modes.
  const humanCleared =
    override || (mod.tier === "gated" && !!unlockRow && unlockRow.status === "unlocked");

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
    // Otherwise: when governed, the engine decides (below); when
    // human-in-the-loop, a specialist unlock is required.
    if (!humanCleared && !(governed && engineAllows)) {
      if (governed) {
        // Autonomy governs — there is no specialist to "wait for". The engine is
        // holding this module (in the beta config, all processing is held).
        return {
          allowed: false,
          reason:
            engineReason ??
            "This isn't available right now based on today's safety read and readiness. Grounding and your companion stay open.",
          action: "readiness",
        };
      }
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

  // Engine backstop (governed only): even if every human-gate check passed, the
  // governing engine can still hold the module (most-restrictive-wins). This can
  // only make access MORE conservative, never less. An explicit clinician
  // override (override===1) remains a human safety valve and is left to stand —
  // it is an audited manual decision, not the autonomous path. NOTE: because the
  // signed beta config keeps autonomous stimulation OFF, the engine holds every
  // *processing* module here, so flipping the flag never auto-opens processing.
  if (governed && !engineAllows && !humanCleared) {
    return {
      allowed: false,
      reason:
        engineReason ??
        "This isn't available right now based on today's safety read and readiness. Grounding and your companion stay open.",
      action: "readiness",
    };
  }

  return { allowed: true };
}
