// The member's day (handoff 09 §4, §1.11; Package 3).
//
// §1.11 IS THE RULING THIS FILE EXISTS TO CARRY OUT, and it is the one place
// handoff 09 overrules its own earlier note:
//
//   "My first-pass presentation-layer note proposed five member day shapes.
//    H08 §6.3 defines seven, adding Interrupted and Service unavailable.
//    Ruling: H08. Seven is correct and my five were wrong. Interruption and
//    service failure are not edge cases in a product used at 2 a.m. on a
//    phone; they are ordinary states that need designed treatment."
//
// The existing model has five. The two missing ones are not gate outcomes —
// they cannot be, because the gate answers "what may this person do" and these
// two answer "what happened to this person's session". So they arrive as
// inputs: an unfinished activity makes the day `interrupted`, and a projection
// that could not be read makes it `service_unavailable`. Deriving them from the
// gate would have meant asking the safety engine a question it does not answer.
//
// WHY THAT MATTERS MORE THAN IT SOUNDS. Without `interrupted`, somebody whose
// phone died mid-check-in comes back to a Today screen that offers them the
// activity again from the beginning — and their answers are either silently
// gone or silently resumed, neither of which they were told. Without
// `service_unavailable`, a failed read renders as an open day with no practices
// in it, which reads as "there is nothing for you today".
//
// AND EVERY STATE CARRIES ITS REQUIRED PATHS. §4.2 gives each state a list, and
// they are data rather than markup: a state whose paths live in a component is
// a state whose paths get dropped when somebody restyles it. Grounding and
// crisis are in every list, including `open` — §1's rule that they "remain
// reachable even when a write, subscription, sync, or service fails".

import { assertMemberProjection } from "./member-projection";
import type { MemberDay as GateDay, DayShape as GateShape, PracticeRef } from "../member/view";

/**
 * §4.2's seven states.
 *
 * The five the gate produces, plus the two §1.11 restores. Ordered as §4.2's
 * table lists them, which is roughly least to most constrained with the two
 * failure states last — a reading order rather than a severity ranking, since
 * `interrupted` is not worse than `crisis`.
 */
export const DAY_STATES = [
  "open",
  "narrow",
  "stabilizing",
  "paused",
  "crisis",
  "interrupted",
  "service_unavailable",
] as const;
export type DayState = (typeof DAY_STATES)[number];

/** §8.5: "Every member-facing string is a versioned copy key, never an inline
 *  literal, so the CI banned-vocabulary guard is enforceable at build time and
 *  clinical copy review is a diff." */
export const DAY_STATE_COPY: Record<DayState, string> = {
  open: "day.open.v1",
  narrow: "day.narrow.v1",
  stabilizing: "day.stabilizing.v1",
  paused: "day.paused.v1",
  crisis: "day.crisis.v1",
  interrupted: "day.interrupted.v1",
  service_unavailable: "day.service_unavailable.v1",
};

/**
 * The rendered copy.
 *
 * §4.5's content rules, applied to the two new ones:
 *
 *   `interrupted` says what happened and offers to pick it up — it does NOT
 *   say "your answers are saved", because at this point nobody has checked
 *   with the server. §4.4: "On reconnect, check current server state before
 *   offering resume. A prior answer or permission may no longer be valid."
 *
 *   `service_unavailable` names the unavailable service and does not ask the
 *   member to diagnose it. §4.4: "Explain a failure without making the member
 *   diagnose connectivity." And it does not read as an empty day: an open day
 *   with nothing in it and a day Steady could not read are different sentences.
 */
/**
 * What ends a pause, said to the member (§11's paused-state retention).
 *
 * §11 flags this as the highest churn risk in the product: "A member under a
 * 0–90 day exclusion faces weeks with no practice available." The paused day
 * said processing was on hold and named a human, and said nothing at all about
 * when it lifts — so a person facing weeks of it could not see an end, only an
 * absence.
 *
 * DECIDED 2026-09-09: say when it lifts and what happens then. The hard part is
 * saying it without leaking WHY, because the day model reads the gate's reasons
 * to pick a shape and then discards them precisely so no surface can render one
 * (§2: "if narrowing reads as 'you failed the check', you produce shame in a
 * population where shame is the presenting problem").
 *
 * So there are three answers and no fourth, and which one applies is decided by
 * what is actually knowable rather than by what would be reassuring:
 *
 *   `at`        — a real time the pause is next reconsidered, when one exists.
 *                 The 24-hour pacing cooldowns have one.
 *   `person`    — nothing expires on its own; a person reopens it. This is the
 *                 honest answer for a clinical exclusion, and it is a better
 *                 one than a date, because a date nobody is bound by is a
 *                 promise the product cannot keep.
 *   `unknown`   — the surface could not establish either. Says so plainly
 *                 rather than implying the first or the second.
 *
 * None of the three names a reason, a criterion, or a threshold.
 */
export const REOPENS_KINDS = ["at", "person", "unknown"] as const;
export type ReopensKind = (typeof REOPENS_KINDS)[number];

export type Reopens =
  | { kind: "at"; at: string }
  | { kind: "person" }
  | { kind: "unknown" };

export const REOPENS_COPY: Record<ReopensKind, string> = {
  at: "day.paused.reopens_at.v1",
  person: "day.paused.reopens_person.v1",
  unknown: "day.paused.reopens_unknown.v1",
};

export const DAY_STATE_MESSAGE: Record<string, string> = {
  "day.open.v1": "Everything is open today. Start wherever you like.",
  "day.narrow.v1": "Today is a grounding day. These are the practices for it.",
  "day.stabilizing.v1": "Today is for steadying. These practices are here whenever you want them.",
  "day.paused.v1": "Processing work is on hold for now. Grounding and support stay open, and someone can help you pick this back up.",
  // §11's paused-state retention. Each says when it lifts and what happens
  // then; none says why it started.
  "day.paused.reopens_at.v1": "This opens again on its own. Nothing is required from you in the meantime, and grounding and support stay open until it does.",
  "day.paused.reopens_person.v1": "This does not expire on a timer — your care team reopens it, and you can ask them about it whenever you want. Grounding and support stay open until then.",
  "day.paused.reopens_unknown.v1": "Steady could not check when this reopens. Your care team can tell you, and grounding and support stay open either way.",
  "day.crisis.v1": "Support is what matters right now.",
  "day.interrupted.v1": "You were part-way through something. You can pick it up, or leave it — either is fine.",
  "day.service_unavailable.v1": "Steady cannot load your day right now. Grounding and support do not need it and are open below.",
};

/**
 * The paths a state must offer.
 *
 * §4.2's own table, as data. Grounding and crisis appear in every one of them
 * — §1: "grounding and crisis resources remain reachable even when a write,
 * subscription, sync, or service fails" — and the guard asserts it, because a
 * list that could omit them is a list somebody eventually trims.
 */
export interface RequiredPath {
  label: string;
  href: string;
}

const GROUND: RequiredPath = { label: "Ground now", href: "/app/ground" };
const SUPPORT: RequiredPath = { label: "Talk to someone", href: "/crisis" };

export const REQUIRED_PATHS: Record<DayState, RequiredPath[]> = {
  open: [
    { label: "Choose another", href: "/app/activities" },
    // NO "TODAY" HERE, and that came out of looking at the screen. Today's own
    // surface rendered a pill linking to Today, which does nothing. §4.2 lists
    // a Today path for the two states reached from INSIDE an activity —
    // `interrupted` and `service_unavailable`, where getting back out is the
    // point — and an open day is already out.
    GROUND, SUPPORT,
  ],
  narrow: [
    { label: "Choose another", href: "/app/activities" },
    GROUND, SUPPORT,
  ],
  stabilizing: [
    { label: "Calm place", href: "/app/session/resourcing" },
    { label: "Practices", href: "/app/activities" },
    GROUND, SUPPORT,
  ],
  paused: [
    // §4.2: "State that processing is paused and name the safe next step."
    // The care-team path is where a person picks it back up with a human,
    // which is the whole answer to "what does a paused day offer".
    { label: "Your care team", href: "/app/care-team" },
    GROUND, SUPPORT,
  ],
  crisis: [
    // §4.2's crisis row names 988 and 911 specifically. They live on the
    // crisis page, which renders with nothing behind it.
    SUPPORT,
    GROUND,
  ],
  interrupted: [
    // §4.2: "Return to the last committed step with context. Resume or exit to
    // Today." Resume is offered by the surface once it has checked the server,
    // never from this list — see the note on `resumable` below.
    { label: "Today", href: "/app/today" },
    GROUND, SUPPORT,
  ],
  service_unavailable: [
    // §4.2: "Name the unavailable service; retain non-network safety
    // resources. Retry, Ground, crisis resources."
    { label: "Try again", href: "/app/today" },
    GROUND, SUPPORT,
  ],
};

/**
 * What the member surface receives.
 *
 * ASSERTED AGAINST PACKAGE 1'S ALLOW-LIST, which is §3's "structural
 * impossibility beats prohibition" reaching a real projection for the first
 * time. The existing `assertNoScores` is a deny-list over the older model and
 * still runs; this is the allow-list, and the difference is what it catches: a
 * deny-list catches `severity_band`, and what it cannot catch is a field
 * somebody adds next quarter with a tidy short name.
 */
export interface MemberDayView {
  state: DayState;
  dayState: DayState;
  dayStateLabel: string;
  orientingSentence: string;
  /** §4.1's one recommended activity, or null. Null is a real answer on a
   *  crisis or paused day, where the strongest thing on the screen is not an
   *  activity. */
  recommended: {
    activityId: string;
    title: string;
    description: string;
    approximateMinutes: number;
    pausePromise: string;
    startHref: string;
  } | null;
  /** §4.1: "Secondary tools below the primary card, not beside it." */
  tools: Array<{ label: string; href: string; description: string }>;
  /** §4.1: "Recent activity shown quietly. No streaks, no missed-day
   *  penalties, no progress percentages, no withheld-card counts." */
  recent: Array<{ kind: string; occurredAt: string }>;
  /** §11's paused-state answer: when this lifts, and what happens then. Null on
   *  every state but `paused` — a day that is not on hold has nothing to
   *  reopen, and rendering the sentence anyway would invent a hold. */
  reopens: { kind: ReopensKind; sentence: string; at: string | null } | null;
  groundHref: string;
  crisisHref: string;
  supportHref: string;
  schemaVersion: string;
  generatedAt: string;
}

/**
 * The paused day's "when does this lift" line.
 *
 * ONLY ON A PAUSED DAY. A stabilizing day still has work available and a narrow
 * one is not on hold; telling either that something will reopen describes a
 * hold that is not happening.
 */
export function reopensLine(
  state: DayState,
  reopens: Reopens | null
): { kind: ReopensKind; sentence: string; at: string | null } | null {
  if (state !== "paused") return null;
  const r = reopens ?? { kind: "unknown" as const };
  return {
    kind: r.kind,
    sentence: DAY_STATE_MESSAGE[REOPENS_COPY[r.kind]],
    at: r.kind === "at" ? r.at : null,
  };
}

/** §4.2's member treatment, in one line per state, for the reader rather than
 *  for the code. Never says why a day is narrow — §2: "If narrowing reads as
 *  'you failed the check', you produce shame in a population where shame
 *  drives disengagement." */
export const DAY_STATE_LABEL: Record<DayState, string> = {
  open: "Open",
  narrow: "A grounding day",
  stabilizing: "A steadying day",
  paused: "On hold",
  crisis: "Support first",
  interrupted: "Part-way through",
  service_unavailable: "Cannot load right now",
};

export class MemberDayError extends Error {}

const MINUTES_FALLBACK = 10;

/**
 * Build the view a member surface renders.
 *
 * COMPOSITION OVER THE GATE, not a second reading of it. `buildMemberDay` in
 * src/lib/member/view.ts reads `checkModuleAccess` for every module and returns
 * what is available; this reshapes that into §4.1's hierarchy and adds the two
 * states the gate cannot produce. Nothing here asks the safety engine anything.
 *
 * THE ORDER OF THE OVERRIDES IS A SAFETY ORDER. A crisis day stays a crisis day
 * even if the member was part-way through something — an interruption does not
 * outrank support. And an unreadable projection is `service_unavailable`
 * whatever else was true, because Steady does not know what else was true.
 */
export function memberDayView(args: {
  /** The gate's answer, or null when it could not be read. */
  day: GateDay | null;
  /** An activity the member left unfinished, if the surface knows of one. */
  interrupted?: { activityId: string; title: string; resumeHref: string } | null;
  recent?: Array<{ kind: string; occurredAt: string }>;
  /** When a paused day next reopens, where the caller can establish it
   *  honestly. Omitted is not the same as `unknown` being wrong — it IS
   *  unknown, and the copy says so rather than guessing. */
  reopens?: Reopens | null;
  now: string;
}): MemberDayView {
  const state = deriveState(args.day, args.interrupted ?? null);
  const practices = args.day?.practices ?? [];
  const primary = args.day?.primary ?? null;

  return assertMemberProjection<MemberDayView>({
    state,
    dayState: state,
    dayStateLabel: DAY_STATE_LABEL[state],
    orientingSentence: DAY_STATE_MESSAGE[DAY_STATE_COPY[state]],
    recommended: recommendedFor(state, primary, args.interrupted ?? null),
    // §4.1: below the primary card. The ORDER here is the render order, and
    // support is not in this list — it is in the dock, which cannot be gated.
    tools: practices
      .filter((p) => p.id !== primary?.id)
      .slice(0, 4)
      .map((p) => ({
        label: p.name,
        href: `/app/session/${p.id}`,
        description: `About ${p.minutes} minutes.`,
      })),
    // Quietly, and never counted into a run.
    recent: (args.recent ?? []).slice(0, 3),
    reopens: reopensLine(state, args.reopens ?? null),
    groundHref: "/app/ground",
    crisisHref: "/crisis",
    supportHref: "/crisis",
    schemaVersion: "member_day.v2",
    generatedAt: args.now,
  }, "member day");
}

/** §4.2's states, and the two the gate cannot answer for. */
function deriveState(
  day: GateDay | null,
  interrupted: { activityId: string } | null
): DayState {
  // An unreadable projection first: Steady does not know what else was true,
  // and guessing would put a member on an open day with nothing in it.
  if (!day) return "service_unavailable";
  // Crisis outranks an interruption. Somebody part-way through a check-in on a
  // crisis day needs support, not a resume prompt.
  if (day.shape === "crisis") return "crisis";
  if (interrupted) return "interrupted";
  return day.shape as DayState;
}

function recommendedFor(
  state: DayState,
  primary: PracticeRef | null,
  interrupted: { activityId: string; title: string; resumeHref: string } | null
): MemberDayView["recommended"] {
  // §4.2: an interrupted day's primary action is picking the thing back up —
  // "Return to the last committed step with context."
  if (state === "interrupted" && interrupted) {
    return {
      activityId: interrupted.activityId,
      title: interrupted.title,
      // NOT "your answers are saved". §4.4: the surface checks the server
      // before it offers resume, and this sentence is written before that
      // check. What it promises is that picking it up is optional.
      description: "You can pick this up where you left it, or leave it for now.",
      approximateMinutes: MINUTES_FALLBACK,
      pausePromise: "You can stop at any point.",
      startHref: interrupted.resumeHref,
    };
  }
  // §4.2: on a crisis day the flow stops, and on a day nothing loaded there is
  // nothing to recommend. Null is the honest answer, and the surface renders
  // the required paths instead.
  if (state === "crisis" || state === "service_unavailable") return null;
  if (!primary) return null;

  return {
    activityId: primary.id,
    title: primary.name,
    description: state === "stabilizing"
      ? "Here whenever you want it."
      : "Start wherever you like.",
    approximateMinutes: primary.minutes,
    // §4.1: "a clear pause promise". On every recommendation, because the
    // reason a person needs it is the reason they might not start.
    pausePromise: "You can stop at any point.",
    startHref: `/app/session/${primary.id}`,
  };
}

/** The paths a state must show. Exported so a surface renders §4.2's list
 *  rather than one it composed. */
export function requiredPaths(state: DayState): RequiredPath[] {
  return REQUIRED_PATHS[state];
}

/**
 * A state's required paths, minus the ones the fixed dock already carries.
 *
 * FOUND BY LOOKING AT A SCREENSHOT. Today rendered "Ground now" and "Talk to
 * someone" as pills in an "Always open" row, about a hundred pixels above the
 * fixed dock rendering the same two labels — so a member on a narrow screen saw
 * each support route twice and had to work out whether they were the same
 * thing. They are.
 *
 * THE REQUIRED LIST IS NOT NARROWED, ONLY THE DRAWING OF IT. `requiredPaths`
 * still returns §4.2's full list and `alwaysReachable` still asserts grounding
 * and crisis are in every state's — this takes the dock's hrefs as an argument
 * and returns what is left to draw, so the guard can check the union covers the
 * state's list rather than trusting a component not to drop one.
 *
 * An empty result is a real answer: on a crisis day the required paths ARE the
 * dock's, and the honest surface is the dock plus the state card, not a second
 * row of the same two buttons.
 */
export function pathsBesidesDock(
  state: DayState,
  dockHrefs: readonly string[]
): RequiredPath[] {
  return REQUIRED_PATHS[state].filter((p) => !dockHrefs.includes(p.href));
}

/** Whether the two always-reachable paths are in a state's list. Exported for
 *  the guard, so the property is checked rather than trusted. */
export function alwaysReachable(state: DayState): boolean {
  const hrefs = REQUIRED_PATHS[state].map((p) => p.href);
  return hrefs.includes("/app/ground") && hrefs.includes("/crisis");
}

/** The five states the gate itself produces, so a caller can tell a gate
 *  outcome from a session outcome. */
export const GATE_STATES: readonly GateShape[] = [
  "open", "narrow", "stabilizing", "paused", "crisis",
];
