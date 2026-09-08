// Therapeutic-load evidence adapters (expansion handoff 05 §2, §12 Phase 1).
//
// §2 lists eight input classes and gives each one a ROLE — external hard
// constraint, load exposure, recovery burden, personal tolerance, broader
// course, capacity in real life, current regulation, human context. This file
// gathers them, and the discipline is that it gathers rather than judges: every
// number here is read from a subsystem's own front door and handed on
// unchanged. What any of it MEANS is decided once, in therapeutic-load.ts,
// under the versioned policy.
//
// THE FIRST ADAPTER IS THE SAFETY GATE, AND IT IS NOT ONE INPUT AMONG EIGHT.
// §1: "Safety asks: is the person allowed to access this activity under
// Steady's deterministic rules? Therapeutic Load asks: based on observed
// recovery, how much additional intensity appears prudent for a clinician to
// consider? The second can never answer the first or override it." So the gate
// arrives as a CONSTRAINT rather than a signal: `readSafetyConstraint` returns
// what the safety engine already decided, and the engine's first act is to stop
// when it says stop. Nothing in this file recomputes a gate, and nothing here
// can produce one.
//
// SOURCE CLASSES DO NOT COLLAPSE. A post-session check is the patient's report,
// a peak SUDS is a system measurement, a clinician's recorded uncertainty is a
// clinician observation, and a fingerprint state is a derived summary. They
// travel in separate fields and are cited separately, because the
// cross-feature invariant says so and because a clinician reading "difficulty
// afterwards" needs to know whether that is the person's own words or a
// number the app wrote down.

import { repo, type TenantContext } from "../repository";
import { data } from "../data";
import { activePolicy, type ClinicalPolicy } from "../clinical-policy";
import { MODULES } from "../modules";
import { gateDecisionsFor, type GateDecision, type GateState } from "./gate-review";
import { alertQueue, type ClinicalAlert } from "./alerts";
import { computeFingerprints, displayable, type FingerprintSummary } from "./response-fingerprint";
import { computeTrajectory, type TrajectorySet } from "./recovery-trajectory";
import { listGoals, observationsFor } from "./return-to-life";
import { listThoughts, currentTranscript } from "./thought-store";
import { BLOCKING_GATE_STATES } from "./therapeutic-load-policy";

// ---------------------------------------------------------------------------
// The safety constraint (§1, §2)
// ---------------------------------------------------------------------------

export interface SafetyConstraint {
  /** True when the safety engine is holding something. The engine stops here. */
  blocked: boolean;
  /** The binding gate, when there is one — the worst state across modules, so
   *  the constraint shown is the one that actually binds rather than the
   *  alphabetically first. */
  gateState: GateState | null;
  moduleTitle: string | null;
  /** The safety engine's own words. Never rephrased: a constraint restated in
   *  this feature's voice is a constraint this feature could get wrong. */
  headline: string | null;
  safeAlternative: string | null;
  /** Open alerts. §7: "any unresolved existing safety state prevents
   *  progression suggestion" — an open alert is unresolved by definition. */
  openAlerts: ClinicalAlert[];
  /** A reference a stored snapshot can carry, so a recommendation held by a
   *  gate says which gate. */
  ref: string | null;
  evidenceIds: string[];
}

export async function readSafetyConstraint(args: {
  personId: string;
  tenantId: string;
  policy?: ClinicalPolicy;
  now?: Date;
}): Promise<SafetyConstraint> {
  const policy = args.policy ?? activePolicy();
  const [gates, alerts] = await Promise.all([
    gateDecisionsFor({
      personId: args.personId, moduleIds: MODULES.map((m) => m.id), policy, now: args.now,
    }),
    alertQueue({ tenantId: args.tenantId, policy, now: args.now }),
  ]);

  const openAlerts = alerts.filter((a) => a.personId === args.personId && a.status === "open");
  // `gateDecisionsFor` already sorts worst-state-first, so the binding
  // constraint is the head of the list.
  const binding: GateDecision | undefined = gates.find(
    (g) => (BLOCKING_GATE_STATES as readonly string[]).includes(g.state)
  );

  return {
    blocked: Boolean(binding),
    gateState: binding?.state ?? gates[0]?.state ?? null,
    moduleTitle: binding?.moduleTitle ?? null,
    headline: binding?.headline ?? null,
    safeAlternative: binding?.safeAlternative ?? null,
    openAlerts,
    ref: binding ? `gate:${binding.moduleId}:${binding.state}` : null,
    evidenceIds: openAlerts.map((a) => a.id),
  };
}

// ---------------------------------------------------------------------------
// Session load and recovery (§2, §4)
// ---------------------------------------------------------------------------

/**
 * One session and what followed it.
 *
 * MISSING IS ITS OWN VALUE, everywhere in this shape. §7: "missing delayed
 * follow-up prevents the system from assuming good recovery", and the way to
 * make that structural rather than remembered is for `recoveryConfirmed` to be
 * `null` when nobody asked rather than `false`. A boolean would have made an
 * unasked question indistinguishable from a bad night in every branch that
 * reads it.
 */
export interface SessionRecovery {
  sessionId: string;
  moduleId: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  /** In-session readings. Null where nothing was recorded. */
  preSuds: number | null;
  peakSuds: number | null;
  postSuds: number | null;
  hardStop: boolean;
  /** The post-session check, if one exists. Null means nobody asked. */
  check: {
    id: string;
    distress: number;
    oriented: boolean;
    safeTonight: boolean;
    /** 0-10: how hard the person expected the hours afterwards to be. */
    delayedRisk: number;
    /** Null is impossible here — the check asks — but the SHAPE keeps the
     *  distinction visible at the call site. */
    recoveryConfirmed: boolean;
    escalated: boolean;
    at: string;
  } | null;
  /** Check-in readings the day after, for the sleep and dissociation costs.
   *  Null where the person did not check in — which is not a good night. */
  nextDay: { sleepQuality: number; dissociation: number; at: string } | null;
  /** The most recent check-in BEFORE the session, so "after" has a "before". */
  baseline: { sleepQuality: number; dissociation: number; at: string } | null;
}

interface SessionRow {
  id: string; module_id: string; status: string;
  pre_suds: number | null; peak_suds: number | null; post_suds: number | null;
  started_at: string; ended_at: string | null;
}
interface CheckRow {
  id: string; session_id: string; distress: number; oriented: number;
  safe_tonight: number; delayed_risk: number; recovery_confirmed: number;
  escalated: number; created_at: string;
}
interface CheckinRow {
  checkin_date: string; sleep_quality: number; dissociation: number;
}

export async function readSessionRecovery(
  ctx: TenantContext,
  args: { personId: string; asOf: string; limit: number }
): Promise<SessionRecovery[]> {
  const r = repo(ctx);
  const sessions = await r.findMany<SessionRow>(
    "therapy_sessions", "user_id = ? AND started_at <= ?", [args.personId, args.asOf],
    { orderBy: "started_at DESC", limit: args.limit }
  );
  if (sessions.length === 0) return [];

  const checks = await r.findMany<CheckRow>(
    "post_session_checks", "user_id = ? AND created_at <= ?", [args.personId, args.asOf],
    { orderBy: "created_at ASC" }
  );
  const checkBySession = new Map(checks.map((c) => [c.session_id, c]));

  // Check-ins are a legacy user-scoped table, read through the unscoped client
  // filtered by person — the same path the engagement provider takes. The
  // person is already the caller's decision by the time this is asked.
  const c = await data();
  const checkins = (await c.all(
    `SELECT checkin_date, sleep_quality, dissociation FROM checkins
      WHERE user_id = ? AND checkin_date <= ? ORDER BY checkin_date ASC`,
    [args.personId, args.asOf.slice(0, 10)]
  )) as CheckinRow[];

  const dayOf = (ts: string) => ts.slice(0, 10);
  const addDays = (day: string, n: number) =>
    new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  return sessions.map((s): SessionRecovery => {
    const check = checkBySession.get(s.id) ?? null;
    const sessionDay = dayOf(s.started_at);
    const next = checkins.find((k) => k.checkin_date === addDays(sessionDay, 1)) ?? null;
    // The newest check-in strictly before the session day. Without a before
    // there is no "worse afterwards" to observe, only a reading.
    const priors = checkins.filter((k) => k.checkin_date < sessionDay);
    const before = priors[priors.length - 1] ?? null;

    return {
      sessionId: s.id,
      moduleId: s.module_id,
      status: s.status,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      preSuds: s.pre_suds,
      peakSuds: s.peak_suds,
      postSuds: s.post_suds,
      hardStop: s.status === "hard_stop",
      check: check
        ? {
            id: check.id,
            distress: check.distress,
            oriented: check.oriented === 1,
            safeTonight: check.safe_tonight === 1,
            delayedRisk: check.delayed_risk,
            recoveryConfirmed: check.recovery_confirmed === 1,
            escalated: check.escalated === 1,
            at: check.created_at,
          }
        : null,
      nextDay: next
        ? { sleepQuality: next.sleep_quality, dissociation: next.dissociation, at: next.checkin_date }
        : null,
      baseline: before
        ? { sleepQuality: before.sleep_quality, dissociation: before.dissociation, at: before.checkin_date }
        : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Capacity in real life, the broader course, and personal tolerance (§2)
// ---------------------------------------------------------------------------

export interface FunctionalCapacity {
  /** Active goals with at least two accepted observations in the window. */
  moving: number;
  /** Goals whose latest accepted level is below their earliest in the window. */
  losingGround: number;
  goalCount: number;
  evidenceIds: string[];
}

export async function readFunctionalCapacity(
  ctx: TenantContext, args: { personId: string; asOf: string; windowDays: number }
): Promise<FunctionalCapacity> {
  const goals = await listGoals(ctx, args.personId, ["active"]);
  const from = new Date(Date.parse(args.asOf) - args.windowDays * 86_400_000).toISOString();
  let moving = 0;
  let losingGround = 0;
  const evidenceIds: string[] = [];

  for (const goal of goals) {
    const accepted = (await observationsFor(ctx, goal.id))
      .filter(
        (o) => o.status === "accepted" && o.observedLevel !== null &&
          o.occurredAt <= args.asOf && o.occurredAt >= from
      )
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    if (accepted.length < 2) continue;
    evidenceIds.push(...accepted.map((o) => o.id));
    const first = accepted[0].observedLevel as number;
    const last = accepted[accepted.length - 1].observedLevel as number;
    if (last > first) moving++;
    if (last < first) losingGround++;
  }
  return { moving, losingGround, goalCount: goals.length, evidenceIds };
}

/** A clinician's own recorded uncertainty (§2's "clinician judgement", §7).
 *
 *  HUMAN CONTEXT, NOT A RULE. §7: it "appears as context and can force
 *  'maintain' or 'defer' display policy if configured, but should not be
 *  silently treated as a deterministic safety rule." So this returns the
 *  clinician's own saved words and the engine reports it by name when it acts
 *  on it — a clinician should be able to see that their own note is why the
 *  screen is saying what it is saying. */
export interface ClinicianContext {
  uncertain: boolean;
  quote: string | null;
  thoughtId: string | null;
}

/** Words a clinician uses when they are not sure. Matched on the clinician's
 *  OWN saved note only — never on patient text, never on Companion text. */
const UNCERTAINTY_WORDS = [
  "not sure", "unsure", "uncertain", "hesitant", "wary", "cautious about",
  "want to wait", "hold off", "too soon", "not ready", "keep it steady",
];

export async function readClinicianContext(
  ctx: TenantContext, personId: string
): Promise<ClinicianContext> {
  const saved = (await listThoughts(ctx, personId, 5)).filter((t) => t.status === "saved");
  for (const t of saved) {
    const transcript = await currentTranscript(ctx, t);
    if (!transcript) continue;
    const lower = transcript.text.toLowerCase();
    const hit = UNCERTAINTY_WORDS.find((w) => lower.includes(w));
    if (hit) {
      return {
        uncertain: true,
        quote: transcript.text.length > 240
          ? `${transcript.text.slice(0, 240).trimEnd()}…`
          : transcript.text,
        thoughtId: t.id,
      };
    }
  }
  return { uncertain: false, quote: null, thoughtId: null };
}

/** Everything the engine reads, gathered once. */
export interface LoadEvidence {
  safety: SafetyConstraint;
  sessions: SessionRecovery[];
  fingerprints: FingerprintSummary[];
  trajectory: TrajectorySet;
  functional: FunctionalCapacity;
  clinician: ClinicianContext;
  /** Adapters that could not run, by name. A recommendation computed over a
   *  partial picture must say so rather than look like a complete one. */
  unavailable: string[];
}

export async function gatherLoadEvidence(
  ctx: TenantContext,
  args: {
    personId: string; asOf: string; windowSessions: number;
    policy?: ClinicalPolicy; functionWindowDays?: number;
  }
): Promise<LoadEvidence> {
  const unavailable: string[] = [];
  const guard = async <T>(name: string, load: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await load();
    } catch (err) {
      // The class of failure only — a message can carry a goal title.
      console.error(`therapeutic load: ${name} failed:`, err instanceof Error ? err.name : "unknown");
      unavailable.push(name);
      return fallback;
    }
  };

  const [safety, sessions, fingerprints, trajectory, functional, clinician] = await Promise.all([
    guard("safety", () => readSafetyConstraint({
      personId: args.personId, tenantId: ctx.tenantId, policy: args.policy,
      now: new Date(args.asOf),
    }), {
      // A safety picture that could not be read is NOT an open one. The
      // conservative fallback blocks, which is the only direction this failure
      // may go: a load recommendation computed while the gate is unreadable
      // would be resting on an assumption nobody made.
      blocked: true, gateState: "unknown" as GateState, moduleTitle: null,
      headline: "Steady could not read this person's safety decisions just now.",
      safeAlternative: null, openAlerts: [], ref: null, evidenceIds: [],
    }),
    guard("sessions", () => readSessionRecovery(ctx, {
      personId: args.personId, asOf: args.asOf, limit: args.windowSessions,
    }), [] as SessionRecovery[]),
    guard("response fingerprint", async () =>
      displayable(await computeFingerprints(ctx, args.personId, { asOf: args.asOf })),
      [] as FingerprintSummary[]),
    guard("recovery trajectory", () =>
      computeTrajectory(ctx, args.personId, { asOf: args.asOf }), {
        personId: args.personId, evidenceCutoff: args.asOf,
        policyVersion: "unavailable", snapshots: [], unavailable: ["all"],
      } as TrajectorySet),
    guard("life goals", () => readFunctionalCapacity(ctx, {
      personId: args.personId, asOf: args.asOf, windowDays: args.functionWindowDays ?? 90,
    }), { moving: 0, losingGround: 0, goalCount: 0, evidenceIds: [] } as FunctionalCapacity),
    guard("clinician thoughts", () => readClinicianContext(ctx, args.personId),
      { uncertain: false, quote: null, thoughtId: null } as ClinicianContext),
  ]);

  return { safety, sessions, fingerprints, trajectory, functional, clinician, unavailable };
}
