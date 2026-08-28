// Gate decisions, for the member banner and the clinician drawer
// (GUI and Decision-Surface Handoff §9.1, §9.2, §8.3).
//
// The gate today answers one question — allowed or not — and hands back a
// sentence. §3.7 is precise about why that is not enough:
//
//   "Temporarily limited by today's check-in / Waiting for a named human review
//    / Locked by program sequence / Unavailable because of consent or profile
//    state / Stopped by a safety rule / Unavailable because data is stale or
//    missing / Unavailable because the service cannot confirm access… Those
//    states are not interchangeable. They must not share one lock icon and one
//    generic message."
//
// A member who is one form away from proceeding and a member stopped by a
// safety rule are in completely different situations, and a shared padlock
// tells both of them the same nothing. Worse, it teaches the second member that
// the stop is an obstacle to work around rather than a decision made for them.
//
// This module is §8.3's `gate_decision_projection`: one object carrying the
// state, the member-safe copy, the reasons, the evidence behind them, the
// policy version, the prior decision, and — the part that makes the clinician
// drawer honest — what may and may not be overridden.

import { checkModuleAccess, getTodayCheckin, type ModuleAccess } from "../gating";
import { getModule, type TherapyModule } from "../modules";
import { OVERRIDABLE, NEVER_OVERRIDABLE, type OverrideTarget } from "./review";
import { activePolicy, type ClinicalPolicy } from "../clinical-policy";
import { data } from "../data";

/** §9.1's six member-facing states. Six rather than one, because the six are
 *  what a member can actually act differently on. */
export type GateState =
  | "open"
  | "caution"
  | "limited"
  | "review_needed"
  | "safety_stop"
  | "unknown";

export interface GateReason {
  code: string;
  label: string;
  detail?: string;
}

/** A pointer to what the decision rests on. §9.2 requires the drawer to show
 *  evidence references, not just a conclusion. */
export interface GateEvidence {
  label: string;
  /** When it happened. Null when the thing is an absence — "no check-in today"
   *  is evidence, and it has no timestamp. */
  at: string | null;
}

export interface GateDecision {
  personId: string;
  moduleId: string;
  moduleTitle: string;
  state: GateState;
  /** Clinician-facing one-liner. */
  headline: string;
  /** §9.2: "Member-safe copy preview." The clinician sees exactly the sentence
   *  the member sees, on the same screen as the decision — so a reason that
   *  reads fine in clinical shorthand and badly to a person in distress is
   *  visible at review time rather than after release. */
  memberCopy: string;
  /** §9.1 and §23.4: a gate is never shown without a safe alternative. */
  safeAlternative: string | null;
  /** The member's primary action from §9.1's table. */
  memberAction: string;
  reasons: GateReason[];
  evidence: GateEvidence[];
  policy: { id: string; version: string };
  effectiveAt: string;
  /** §9.2: "Prior decision and change." Null where there is no prior decision
   *  on record — which renders as its own state, never as "no change". */
  prior: { state: GateState; at: string } | null;
  /** What a clinician may relax here, or null. Pacing only, ever. */
  overridable: OverrideTarget | null;
  /** Stated explicitly, because §9.2 requires the drawer to show "what cannot
   *  be overridden". Naming the boundary is what stops an override being read
   *  as a general-purpose unlock. */
  neverOverridable: readonly string[];
}

/** §9.1's table: treatment, member message, and primary action per state.
 *
 *  Copy is verbatim from the handoff where it gives it. Note that no state
 *  apologises and none uses alarm language — a limited day is a normal
 *  operating state, and copy that treats it as a failure teaches the member to
 *  experience it as one. */
const STATE_COPY: Record<GateState, { member: string; action: string; alternative: string | null; headline: string }> = {
  open: {
    member: "This is available today.",
    action: "Start",
    alternative: null,
    headline: "Open",
  },
  caution: {
    member: "Go gently today because your activation is higher than usual.",
    action: "Start gentler option",
    alternative: "Grounding and regulation practices",
    headline: "Caution — proceed gently",
  },
  limited: {
    member: "Processing is paused today. Grounding and regulation remain open.",
    action: "Start grounding",
    alternative: "Grounding and regulation practices",
    headline: "Limited — processing paused today",
  },
  review_needed: {
    member: "A specialist review is needed before this opens.",
    action: "See what happens next",
    alternative: "Grounding and regulation practices",
    headline: "Review needed before this opens",
  },
  safety_stop: {
    member: "This session stopped because continuing was not the safe choice.",
    action: "Ground now or get help",
    alternative: "Crisis support and grounding",
    headline: "Safety stop",
  },
  unknown: {
    member: "Steady cannot confirm access right now.",
    action: "Use always-open tools and retry",
    alternative: "Grounding, SOS, and crisis resources",
    headline: "Unknown — access could not be confirmed",
  },
};

export function memberCopyFor(state: GateState): string {
  return STATE_COPY[state].member;
}

type GateAction = Extract<ModuleAccess, { allowed: false }>["action"];

/** Gate causes whose member sentence is §9.1's generic `limited` line.
 *
 *  Found by rendering the drawer: a member blocked by the fitness screener was
 *  being shown "Processing is paused today. Grounding and regulation remain
 *  open." — while the clinician, one line above, read the real reason
 *  ("Please complete the program-fit questions first").
 *
 *  Those are different claims. §3.7 is explicit that "temporarily limited by
 *  today's check-in" and "unavailable because of consent or profile state" are
 *  not interchangeable states, and telling a member their day is limited when
 *  in fact one form stands between them and the module is both untrue and
 *  demotivating — it describes a wait where there is an action.
 *
 *  So the §9.1 sentence belongs only to the causes it actually describes: the
 *  daily read, a cooldown, and the kill switch. Every other cause keeps the
 *  visual treatment of `limited` (§9.1's "amber banner with reason") and
 *  carries its OWN reason as the sentence — which `checkModuleAccess` already
 *  writes in member-facing language. */
const GENERIC_LIMITED_CAUSES: readonly GateAction[] = ["grounding", "cooldown", "paused"];

/** The member's next step, per cause.
 *
 *  The same defect as the sentence, one line down: §9.1's default action for
 *  `limited` is "Start grounding", which is right when the day is limited and
 *  wrong when a form is. Telling a member to start grounding when what stands
 *  between them and the module is the fitness screener sends them away from the
 *  thing that would actually open it.
 *
 *  §23.4 — "do not show a gate without a reason and a safe alternative" — is
 *  satisfied either way: the safe alternative stays grounding. This is the
 *  PRIMARY action, which should be the step that resolves the gate. */
const ACTION_FOR_CAUSE: Partial<Record<GateAction, { action: string; short: string }>> = {
  screening:   { action: "Complete the program-fit questions", short: "screening incomplete" },
  consent:     { action: "Review and complete consent",        short: "consent incomplete" },
  profile:     { action: "Finish setting up",                  short: "setup incomplete" },
  checkin:     { action: "Complete today's check-in",          short: "check-in not done" },
  safety_plan: { action: "Complete your safety plan",          short: "safety plan incomplete" },
  subscribe:   { action: "Start a membership",                 short: "no active membership" },
  upgrade:     { action: "See Plus and Premium",               short: "not in this plan" },
  prereq:      { action: "Complete the earlier modules",       short: "program sequence" },
  readiness:   { action: "Keep to today's pace",               short: "readiness track" },
};

/** Map a gate outcome to the state a member can act on.
 *
 *  The grouping is by what the member should DO, not by which code path
 *  produced it — which is why several setup gates share `limited`: from the
 *  member's side they are all "not today, here is what opens it", and the
 *  differing next step is carried in the reason rather than in the state. */
const STATE_FOR_ACTION: Record<GateAction, GateState> = {
  crisis: "safety_stop",
  grounding: "limited",
  cooldown: "limited",
  paused: "limited",
  unlock: "review_needed",
  prereq: "limited",
  readiness: "limited",
  safety_plan: "limited",
  consent: "limited",
  profile: "limited",
  screening: "limited",
  checkin: "limited",
  subscribe: "limited",
  upgrade: "limited",
};

/** Which override target, if any, could relax this gate.
 *
 *  Everything not named here is not overridable — the default is refusal, so a
 *  new gate reason cannot become quietly overridable by omission. */
const OVERRIDE_FOR_ACTION: Partial<Record<GateAction, OverrideTarget>> = {
  unlock: "module_unlock",
  readiness: "readiness_track",
  prereq: "prerequisites",
};

/** The daily read, in words. The raw enum is a storage detail, and it was
 *  rendering into the drawer's evidence list as `processing_ok`. */
const CHECKIN_READING: Record<string, string> = {
  processing_ok: "cleared for processing",
  stabilization: "keep intensity lower",
  grounding_only: "grounding only",
  crisis: "crisis routing",
};

function stamp(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

export async function buildGateDecision(args: {
  personId: string;
  moduleId: string;
  policy?: ClinicalPolicy;
  now?: Date;
}): Promise<GateDecision | null> {
  const mod: TherapyModule | undefined = getModule(args.moduleId);
  if (!mod) return null;

  const policy = args.policy ?? activePolicy();
  const now = args.now ?? new Date();
  const c = await data();

  const [access, checkin, recent] = await Promise.all([
    checkModuleAccess(args.personId, mod),
    getTodayCheckin(args.personId),
    // Two most recent check-ins: the older one is the prior daily decision.
    c.all(
      "SELECT checkin_date, recommended_action, activation, sleep_quality FROM checkins WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 2",
      [args.personId]
    ) as Promise<Array<{ checkin_date: string; recommended_action: string; activation: number; sleep_quality: number }>>,
  ]);

  const reasons: GateReason[] = [];
  const evidence: GateEvidence[] = [];
  let state: GateState;
  let overridable: OverrideTarget | null = null;

  if (access.allowed) {
    // Allowed, but not necessarily unremarkable. A stabilization day is open
    // for this module and still warrants the gentler framing — that difference
    // is exactly what §9.1's `caution` state is for, and collapsing it into
    // `open` loses the only signal the member gets.
    state = checkin?.recommended_action === "stabilization" ? "caution" : "open";
    if (state === "caution") {
      reasons.push({
        code: "checkin.stabilization",
        label: "Today's check-in suggests keeping intensity lower",
      });
    }
  } else {
    state = STATE_FOR_ACTION[access.action] ?? "unknown";
    overridable = OVERRIDE_FOR_ACTION[access.action] ?? null;
    reasons.push({
      code: `gate.${access.action}`,
      label: access.reason,
    });
  }

  // Evidence. Each entry is a thing a clinician can go and look at; an absence
  // is recorded as an absence rather than omitted, because "no check-in today"
  // is often the whole reason.
  if (checkin) {
    evidence.push({
      label: `Check-in — ${CHECKIN_READING[checkin.recommended_action] ?? checkin.recommended_action}`,
      at: checkin.checkin_date,
    });
    if (recent[0]) {
      evidence.push({
        label: `Activation ${recent[0].activation}/10, sleep ${recent[0].sleep_quality}/10`,
        at: recent[0].checkin_date,
      });
    }
  } else {
    evidence.push({ label: "No check-in recorded today", at: null });
  }

  const prior = recent[1]
    ? {
        state: STATE_FOR_ACTION[
          (recent[1].recommended_action === "crisis"
            ? "crisis"
            : recent[1].recommended_action === "grounding_only"
              ? "grounding"
              : "checkin") as GateAction
        ] ?? "unknown",
        at: recent[1].checkin_date,
      }
    : null;

  const copy = STATE_COPY[state];

  // The member sentence: §9.1's line where it genuinely describes the cause,
  // the gate's own member-facing reason otherwise.
  const specific =
    !access.allowed && state === "limited" && !GENERIC_LIMITED_CAUSES.includes(access.action)
      ? { reason: access.reason, ...ACTION_FOR_CAUSE[access.action] }
      : null;

  const memberCopy = specific ? specific.reason : copy.member;
  const memberAction = specific?.action ?? copy.action;
  // The clinician headline names the cause too, so a list of eleven modules
  // does not read as eleven identical "processing paused today" rows.
  const headline = specific?.short ? `Limited — ${specific.short}` : copy.headline;

  return {
    personId: args.personId,
    moduleId: mod.id,
    moduleTitle: mod.name,
    state,
    headline,
    memberCopy,
    safeAlternative: copy.alternative,
    memberAction,
    reasons,
    evidence,
    policy: { id: "module-access-gate", version: policy.version },
    effectiveAt: stamp(now),
    prior,
    overridable,
    neverOverridable: NEVER_OVERRIDABLE,
  };
}

/** Every gate decision for a person, worst state first.
 *
 *  Ordered so a clinician opening the drawer sees the binding constraint rather
 *  than the alphabetically-first module. */
const STATE_SEVERITY: GateState[] = ["safety_stop", "review_needed", "limited", "unknown", "caution", "open"];

export async function gateDecisionsFor(args: {
  personId: string;
  moduleIds: string[];
  policy?: ClinicalPolicy;
  now?: Date;
}): Promise<GateDecision[]> {
  const out = await Promise.all(
    args.moduleIds.map((moduleId) =>
      buildGateDecision({ personId: args.personId, moduleId, policy: args.policy, now: args.now })
    )
  );
  const decisions = out.filter((d): d is GateDecision => d !== null);
  decisions.sort((a, b) => {
    const s = STATE_SEVERITY.indexOf(a.state) - STATE_SEVERITY.indexOf(b.state);
    return s !== 0 ? s : a.moduleTitle.localeCompare(b.moduleTitle);
  });
  return decisions;
}

/** Guard used by the drawer before it renders any override control.
 *
 *  Deliberately duplicated from `override()`'s own check rather than trusted
 *  from it: the server refusal is the boundary, and this is the UI refusing to
 *  offer what the server would reject. §15.2 says an attempted safety-stop
 *  override "does not render" — so the question has to be answerable before
 *  the button is drawn, not after it is pressed. */
export function overrideAllowed(d: GateDecision): boolean {
  if (d.state === "safety_stop") return false;
  if (!d.overridable) return false;
  return (OVERRIDABLE as readonly string[]).includes(d.overridable);
}


// ---------------------------------------------------------------------------
// Collapsing decisions that are the same decision
// ---------------------------------------------------------------------------

/** One gate cause, and every module it currently blocks.
 *
 *  Found by rendering the drawer against a seeded member: an incomplete fitness
 *  screener blocks all eleven modules, so the panel was eleven expandable rows
 *  carrying the identical decision, reason, policy, evidence, prior state and
 *  member sentence. Reading the second one taught a clinician nothing, and the
 *  repetition made a single unresolved form look like eleven problems.
 *
 *  This is §10.3's duplicate-collapse rule applied one surface over: "duplicate
 *  alerts for the same person and reason should collapse into one work item
 *  with an event count." Same person, same reason — so one drawer, with the
 *  modules it affects named rather than hidden. */
export interface GateGroup {
  /** The representative decision. Every field except the module is shared. */
  decision: GateDecision;
  /** Module names this cause currently applies to, in display order. */
  moduleNames: string[];
}

export function groupGateDecisions(decisions: GateDecision[]): GateGroup[] {
  const groups = new Map<string, GateGroup>();
  for (const d of decisions) {
    // Grouped by state AND cause: two modules that are both "limited" for
    // different reasons are two decisions, and merging them would hide one.
    const key = `${d.state}::${d.reasons.map((r) => r.code).join("|")}`;
    const g = groups.get(key);
    if (g) g.moduleNames.push(d.moduleTitle);
    else groups.set(key, { decision: d, moduleNames: [d.moduleTitle] });
  }
  return [...groups.values()];
}
