// The scenario contract (handoff 09 §9, §7.2, §7.3; Package 4).
//
// §9's shape: "Presentation audience, permitted transitions, preflight, reset
// lock." Its reason, in six words: "Investor storytelling must not add
// privileges."
//
// THAT REASON IS THE WHOLE DESIGN OF THIS FILE. A guided demonstration is the
// one surface in this product whose entire purpose is to show somebody things
// they are not otherwise entitled to see, and the obvious implementation —
// "the investor scenario runs as a clinician" — is a role switcher with a
// story wrapped round it. §7.2 rules it out by name: "No unbounded role
// switcher."
//
// So a Scenario HAS NO FIELD A CAPABILITY COULD OCCUPY. Not a role, not a
// persona-with-permissions, not an `as`, not an elevation. Its `audience` is a
// PRESENTATION audience — who the story is told to — and the access a viewer
// actually has continues to come from where it always came from: their own
// session, resolved server-side. `assertGrantsNothing` walks a scenario for
// the field names that would quietly turn this into an authorization surface,
// and the guard runs it over every registered scenario.
//
// §7.2's OTHER FOUR REQUIREMENTS, each of which is a property here rather than
// a habit in a component:
//
//   "The presenter can move backward, resume, or choose a shorter story."
//   `back` is always permitted; `next` moves exactly one step and only when
//   preflight passed; a jump forward is refused. A presenter who has lost the
//   room needs to go back, and a presenter who is out of time needs the short
//   version — neither is an error state.
//
//   "Claims and limitations stay attached to the scenario version." A resume
//   carries the version it started under and REFUSES to resume into a
//   different one, because the alternative is a presenter picking up at step 4
//   of a story whose claims changed at step 2.
//
//   "Real working screens with clearly labeled simulations." Every step names
//   the route it opens and says whether what it shows is simulated. A step
//   with no route is not a step; it is a slide, and this is not a slide deck.
//
//   "A concise statement of what exists, what is unfinished, and what decision
//   is being asked for." That is the closeout, and it is required on the type
//   rather than optional — see the note on `Closeout` below.
//
// Client-safe: no imports at all.

// ---------------------------------------------------------------------------
// Presentation audience
// ---------------------------------------------------------------------------

/**
 * Who a story is told to.
 *
 * NOT A ROLE, and the distinction is the point. "investor" here means the
 * narrative is pitched at somebody deciding whether to fund this; it does not
 * mean an account, a permission set, or a way in. The registry's guard asserts
 * these names never appear as a role anywhere in a scenario.
 */
export const PRESENTATION_AUDIENCES = [
  "investor",
  "clinical",
  "organization",
  "payer",
  "security",
] as const;
export type PresentationAudience = (typeof PRESENTATION_AUDIENCES)[number];

export const AUDIENCE_LABEL: Record<PresentationAudience, string> = {
  investor: "Investor",
  clinical: "Clinical reviewer",
  organization: "Organization",
  payer: "Payer",
  security: "Security reviewer",
};

/**
 * Field names a scenario may never carry, at any depth.
 *
 * REDUNDANT WITH THE TYPE ON PURPOSE. TypeScript stops these at compile time
 * for a literal; it does not stop a scenario assembled from a JSON file, a
 * database row, or a future registry that spreads an object in. The walk below
 * is what makes §9's reason hold against the version of this code that has not
 * been written yet.
 */
export const FORBIDDEN_SCENARIO_FIELDS: ReadonlyArray<{ name: string; what: string }> = [
  { name: "role", what: "a role to run as" },
  { name: "roles", what: "roles to run as" },
  { name: "as", what: "an identity to assume" },
  { name: "runAs", what: "an identity to assume" },
  { name: "capability", what: "a capability to grant" },
  { name: "capabilities", what: "capabilities to grant" },
  { name: "grant", what: "a grant" },
  { name: "grants", what: "grants" },
  { name: "permission", what: "a permission" },
  { name: "permissions", what: "permissions" },
  { name: "elevate", what: "an elevation" },
  { name: "writeCapable", what: "write access" },
  { name: "impersonate", what: "impersonation" },
  { name: "tenantId", what: "a tenant to read as" },
];

export class ScenarioError extends Error {}

/** Every place a forbidden name appears, with the path to it. */
export function grantViolations(value: unknown, at = "$"): Array<{ at: string; detail: string }> {
  const out: Array<{ at: string; detail: string }> = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...grantViolations(v, `${at}[${i}]`)));
    return out;
  }
  if (value === null || typeof value !== "object") return out;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const forbidden = FORBIDDEN_SCENARIO_FIELDS.find((f) => f.name === key);
    if (forbidden) {
      out.push({ at: `${at}.${key}`, detail: `carries ${forbidden.what}` });
    }
    out.push(...grantViolations(v, `${at}.${key}`));
  }
  return out;
}

/** The refusal. A scenario that would grant something does not get registered. */
export function assertGrantsNothing<T>(scenario: T, what = "scenario"): T {
  const bad = grantViolations(scenario, what);
  if (bad.length > 0) {
    throw new ScenarioError(
      `A ${what} may not carry access: ` +
        bad.map((b) => `${b.at} ${b.detail}`).join("; ") +
        ". A presentation audience is who the story is told to, never what the viewer may do."
    );
  }
  return scenario;
}

// ---------------------------------------------------------------------------
// A step
// ---------------------------------------------------------------------------

export interface ScenarioStep {
  id: string;
  /** What the presenter is showing. */
  title: string;
  /** What to say, in one or two sentences. Written for someone reading it off
   *  a screen while talking, so it is short by rule rather than by taste. */
  say: string;
  /** The real screen this step opens. §7.2: "Real working screens." A step
   *  with no route is a slide, and a slide belongs in a deck. */
  href: string;
  /** Whether what this screen shows is simulated rather than observed.
   *  §7.2: "clearly labeled simulations." Required rather than optional: an
   *  unset flag defaults to "not simulated", which is the dangerous default. */
  simulated: boolean;
  /** Roughly how long. Sums to the scenario's own estimate, which the guard
   *  checks — a five-minute story whose steps total eleven minutes is a
   *  promise the presenter breaks in the room. */
  minutes: number;
  /** Whether the shorter story keeps it. §7.2: the presenter can "choose a
   *  shorter story", which means somebody has decided in advance which steps
   *  survive — not that the surface truncates the list. */
  essential: boolean;
}

// ---------------------------------------------------------------------------
// The closeout
// ---------------------------------------------------------------------------

/**
 * §7.2's three sentences, and they are REQUIRED on the type.
 *
 *   "Include a concise statement of what exists, what is unfinished, and what
 *    decision is being asked for."
 *
 * Optional fields get left empty on the scenario somebody writes in a hurry
 * before a meeting, which is precisely the scenario where the honest-limits
 * statement matters most. §7.2 again, and it is worth quoting because it is a
 * commercial argument rather than a compliance one: "The honest-limitations
 * slide is not a concession; it is the strongest asset in the deck for this
 * category… Say what Steady does not do, plainly, and the discipline reads as
 * competence."
 */
export interface Closeout {
  exists: string[];
  unfinished: string[];
  /** The one question the audience is being asked to answer. Singular on
   *  purpose: a story that ends with four asks has no ask. */
  decision: string;
}

// ---------------------------------------------------------------------------
// A scenario
// ---------------------------------------------------------------------------

export interface Scenario {
  id: string;
  title: string;
  /** Who the story is told to. Not a role — see the header. */
  audience: PresentationAudience;
  /** Bumped whenever a claim, a limitation or a step changes. A resume that
   *  crosses a version boundary is refused rather than migrated. */
  version: string;
  /** One line on what the story is for. */
  purpose: string;
  minutes: number;
  steps: ScenarioStep[];
  /** What this story asserts. Attached to the version (§7.2). */
  claims: string[];
  /** What it does not assert. Same. */
  limitations: string[];
  closeout: Closeout;
  /** Preflight requirements, by id. The registry resolves them against the
   *  live environment; the scenario only names what it needs, so a scenario
   *  cannot smuggle in a check that always passes. */
  requires: string[];
}

/** The shorter story: the steps somebody decided in advance were the spine.
 *
 *  NEVER AN EMPTY LIST. A scenario whose short version is nothing is a
 *  scenario with no spine, and the presenter finds out in the room. */
export function shorterStory(scenario: Scenario): ScenarioStep[] {
  const kept = scenario.steps.filter((s) => s.essential);
  if (kept.length === 0) {
    throw new ScenarioError(
      `"${scenario.id}" has no essential steps, so there is no shorter story to offer.`
    );
  }
  return kept;
}

/**
 * Whether there is a shorter story to offer at all.
 *
 * FOUND BY LOOKING AT THE LAUNCHER. The investor story is five minutes and
 * every one of §7.2's five beats is essential, so its "shorter story" was the
 * same five steps — and the card advertised "5 minutes · 5 screens · 5 minutes
 * short", which is a shorter story that is not shorter. A presenter who
 * reaches for it mid-meeting because they are out of time gets nothing and
 * loses the seconds they were trying to save.
 *
 * §7.2 gives the presenter a shorter story WHERE ONE EXISTS. A five-minute
 * story genuinely has no shorter version, and saying so is better than
 * offering a control that does nothing.
 */
export function hasShorterStory(scenario: Scenario): boolean {
  return scenario.steps.some((s) => s.essential) &&
    shorterStory(scenario).length < scenario.steps.length;
}

/** How long the story actually runs, from its steps rather than its estimate. */
export function actualMinutes(steps: readonly ScenarioStep[]): number {
  return steps.reduce((n, s) => n + s.minutes, 0);
}

// ---------------------------------------------------------------------------
// Permitted transitions
// ---------------------------------------------------------------------------

export const TRANSITIONS = ["next", "back", "restart", "shorter", "exit"] as const;
export type Transition = (typeof TRANSITIONS)[number];

export const TRANSITION_LABEL: Record<Transition, string> = {
  next: "Next",
  back: "Back",
  restart: "Start again",
  shorter: "Shorter story",
  exit: "End the walkthrough",
};

export interface ScenarioProgress {
  scenarioId: string;
  /** The version the walkthrough started under. */
  version: string;
  /** 0-based index into the step list currently in play. */
  index: number;
  /** Whether the short story is the one running. */
  shortened: boolean;
  startedAt: string;
}

export interface TransitionRefusal {
  allowed: false;
  reason: string;
}
export interface TransitionAllowed {
  allowed: true;
  next: ScenarioProgress;
}
export type TransitionResult = TransitionAllowed | TransitionRefusal;

/** The steps currently in play, honouring the short story. */
export function stepsFor(scenario: Scenario, progress: ScenarioProgress): ScenarioStep[] {
  return progress.shortened ? shorterStory(scenario) : scenario.steps;
}

/**
 * Whether a transition may be taken, and what it produces.
 *
 * BACK IS ALWAYS PERMITTED and forward is one step at a time. §7.2 gives the
 * presenter backward movement without qualification, and the reason a jump
 * forward is refused is not tidiness: the steps are ordered because the story
 * is an argument, and a presenter who lands on the aggregate evidence without
 * the member action before it is presenting a chart nobody has context for.
 *
 * `preflightReady` is a REQUIRED argument with no default. A walkthrough that
 * advances into a screen the environment cannot serve is the failure §7.3
 * names — "a reset failure never displays ready" — reaching the audience.
 */
export function transition(
  scenario: Scenario,
  progress: ScenarioProgress,
  to: Transition,
  preflightReady: boolean
): TransitionResult {
  if (progress.scenarioId !== scenario.id) {
    return { allowed: false, reason: "That progress belongs to a different walkthrough." };
  }
  if (progress.version !== scenario.version) {
    // §7.2: claims and limitations stay attached to the scenario version.
    return {
      allowed: false,
      reason:
        "This story changed since the walkthrough began. Start again so the claims and " +
        "limitations on screen are the ones this version makes.",
    };
  }

  const steps = stepsFor(scenario, progress);

  switch (to) {
    case "back":
      if (progress.index === 0) {
        return { allowed: false, reason: "This is the first step." };
      }
      return { allowed: true, next: { ...progress, index: progress.index - 1 } };

    case "next":
      if (!preflightReady) {
        return {
          allowed: false,
          reason:
            "The environment is not ready, so the next screen would not show what this step " +
            "claims. Fix the environment before continuing.",
        };
      }
      if (progress.index >= steps.length - 1) {
        return { allowed: false, reason: "This is the last step." };
      }
      return { allowed: true, next: { ...progress, index: progress.index + 1 } };

    case "restart":
      return { allowed: true, next: { ...progress, index: 0 } };

    case "shorter":
      if (progress.shortened) {
        return { allowed: false, reason: "The shorter story is already running." };
      }
      if (!hasShorterStory(scenario)) {
        return {
          allowed: false,
          reason: "Every step in this story is essential, so there is no shorter version.",
        };
      }
      // Lands at the start of the short story rather than at the equivalent
      // position, because "equivalent" is a guess and the presenter switching
      // to the short version has already decided to change what they say.
      return { allowed: true, next: { ...progress, shortened: true, index: 0 } };

    case "exit":
      return { allowed: true, next: { ...progress, index: steps.length - 1 } };
  }
}

/** Start a walkthrough. */
export function begin(scenario: Scenario, at: string): ScenarioProgress {
  return {
    scenarioId: scenario.id,
    version: scenario.version,
    index: 0,
    shortened: false,
    startedAt: at,
  };
}

/**
 * Whether a stored walkthrough may be picked up.
 *
 * §7.2 gives the presenter "resume". This is where that promise is kept
 * honestly: a walkthrough whose scenario has been edited since it started is
 * NOT resumable, because the claims on the screen would be the new version's
 * and the story the presenter has been telling is the old one's.
 */
export function resumable(
  scenario: Scenario,
  progress: ScenarioProgress
): { ok: boolean; reason?: string } {
  if (progress.scenarioId !== scenario.id) {
    return { ok: false, reason: "That walkthrough is for a different story." };
  }
  if (progress.version !== scenario.version) {
    return {
      ok: false,
      reason: `This story is now ${scenario.version}; the walkthrough began under ${progress.version}.`,
    };
  }
  const steps = stepsFor(scenario, progress);
  if (progress.index < 0 || progress.index >= steps.length) {
    return { ok: false, reason: "That step is no longer part of this story." };
  }
  return { ok: true };
}

/** Where the presenter is, for the progress guide. */
export function position(scenario: Scenario, progress: ScenarioProgress): {
  step: ScenarioStep;
  number: number;
  total: number;
  remainingMinutes: number;
  atEnd: boolean;
} {
  const steps = stepsFor(scenario, progress);
  const index = Math.min(Math.max(progress.index, 0), steps.length - 1);
  return {
    step: steps[index],
    number: index + 1,
    total: steps.length,
    remainingMinutes: actualMinutes(steps.slice(index + 1)),
    atEnd: index === steps.length - 1,
  };
}
