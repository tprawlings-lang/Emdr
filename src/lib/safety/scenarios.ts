import { evaluateAccess } from "./engine";
import { AccessTier, TIER_LABEL, type SafetyInputs } from "./types";

// Fixed safety scenarios, replayed through the real engine.
//
// Handoff 06 §26 (p44) gives the reviewer a screen whose question is "replay
// fixed scenarios" and whose data is "expected, actual, resources". Handoff 07
// says why it matters more here than anywhere else (p3, p54):
//
//   REQUIRED   Use the same deterministic gate engine and most-restrictive-rule
//              precedence.
//   PROHIBITED Create a separate relaxed demo safety path.
//   BLOCKS     Demo bypass or a relaxed safety rule.
//
// A claim like that is worth exactly as much as the thing that checks it. So
// this module holds INPUTS and EXPECTATIONS only — never an outcome — and the
// screen computes the outcome by calling `evaluateAccess`, the same function
// the member's daily check-in calls. If someone forks a relaxed path for the
// demo, these rows go red on a page a reviewer is already looking at.
//
// The unit suite covers the same ground in `tests/safety-redteam.test.ts`.
// That is not a duplication to remove: a test proves the engine was correct
// when CI ran, and this proves it is correct in the environment being shown,
// on the build being demonstrated, at the moment someone asks.

export interface Scenario {
  id: string;
  /** What a person did, in a sentence anyone in the room can follow. */
  situation: string;
  /** Why the rule exists — not what it does. */
  rationale: string;
  inputs: SafetyInputs;
  expect: {
    tier: AccessTier;
    /** Whether an activating (processing-shaped) session may start. */
    activating: boolean;
    /** A fragment that must appear in the member-facing reason, so a scenario
     *  cannot pass by reaching the right tier with the wrong explanation. */
    reasonIncludes?: string;
  };
}

const NOW = 1_800_000_000_000;

function inputs(over: Partial<SafetyInputs> = {}): SafetyInputs {
  return {
    nowMs: NOW,
    programFit: {},
    dailyCheckin: {
      activation: 2, shutdown: 1, harmUrge: false, feelsSafe: true,
      dissociation: 0, sleepQuality: 7, substanceFlag: false,
    },
    instruments: {},
    readiness: { track: "steady" },
    ...over,
  };
}

export const SCENARIOS: Scenario[] = [
  {
    id: "SAFE_BASELINE",
    situation: "A settled check-in: low activation, feels safe, no harm urge, slept well.",
    rationale:
      "The control. A gate chain that denies everything is not safe, it is broken — and a " +
      "reviewer looking only at refusals cannot tell the difference. Note that activating " +
      "sessions are blocked even here: beta runs no autonomous bilateral stimulation at " +
      "all, so this is a product decision rather than a response to this person.",
    inputs: inputs(),
    expect: { tier: AccessTier.STEADY, activating: false },
  },
  {
    id: "HARM_URGE_CRISIS",
    situation: "The daily check-in reports an urge to harm themselves.",
    rationale:
      "The strongest signal in the chain. Nothing else on the screen — a good readiness " +
      "score, a long streak, a clinician override — may reach past it.",
    inputs: inputs({ dailyCheckin: { ...inputs().dailyCheckin!, harmUrge: true } }),
    expect: { tier: AccessTier.CRISIS, activating: false },
  },
  {
    id: "NOT_SAFE_NOW",
    situation: "The member says they do not feel safe where they are right now.",
    rationale:
      "Present physical safety is a precondition for everything else. It is asked " +
      "separately from distress because a person can be calm and unsafe.",
    inputs: inputs({ dailyCheckin: { ...inputs().dailyCheckin!, feelsSafe: false } }),
    expect: { tier: AccessTier.CRISIS, activating: false },
  },
  {
    id: "DISSOCIATION_GROUNDING_ONLY",
    situation: "Dissociation is reported at 7 out of 10.",
    rationale:
      "Someone who is not present cannot consent to, follow, or stop a session. A hard " +
      "stop rather than a caution, and it does not depend on distress being high.",
    inputs: inputs({ dailyCheckin: { ...inputs().dailyCheckin!, dissociation: 7 } }),
    expect: { tier: AccessTier.GROUNDING_ONLY, activating: false },
  },
  {
    id: "DISSOCIATION_STABILIZATION",
    situation: "Dissociation is reported at 4 out of 10 — the middle band.",
    rationale:
      "The band between is the interesting one. It is not a lockout: stabilization and " +
      "grounding stay open, and clinician support is surfaced. A chain with only two " +
      "outcomes would round this person to one of them.",
    inputs: inputs({ dailyCheckin: { ...inputs().dailyCheckin!, dissociation: 4 } }),
    expect: { tier: AccessTier.STABILIZATION, activating: false },
  },
  {
    id: "HIGH_ACTIVATION",
    situation: "Activation is at 8 out of 10, with everything else settled.",
    rationale:
      "Distress at the top of the scale narrows to grounding. Below the threshold it does " +
      "not narrow at all, which is what keeps an ordinary hard day from locking someone " +
      "out of the programme.",
    inputs: inputs({ dailyCheckin: { ...inputs().dailyCheckin!, activation: 8 } }),
    expect: { tier: AccessTier.GROUNDING_ONLY, activating: false },
  },
  {
    id: "POOR_SLEEP",
    situation: "Sleep quality is reported at 2 out of 10.",
    rationale:
      "A physiological input with no distress attached, and deliberately the GENTLEST " +
      "restriction in the chain: a cautious ceiling rather than stabilization. A clinical " +
      "review set it there on the reasoning that poor sleep reduces capacity without " +
      "being evidence of current impairment, so it lowers the pace and prompts a check " +
      "rather than closing the track. Stimulation is still removed and a review is still " +
      "triggered.",
    inputs: inputs({ dailyCheckin: { ...inputs().dailyCheckin!, sleepQuality: 2 } }),
    expect: { tier: AccessTier.CAUTIOUS, activating: false },
  },
  {
    id: "SUBSTANCE_FLAG",
    situation: "The member reports substance use before the session.",
    rationale:
      "Not a judgement and not a lockout: it removes the activating path and leaves " +
      "grounding, because consent and stop-capacity are what is in question.",
    inputs: inputs({ dailyCheckin: { ...inputs().dailyCheckin!, substanceFlag: true } }),
    expect: { tier: AccessTier.STABILIZATION, activating: false },
  },
  {
    id: "MOST_RESTRICTIVE_WINS",
    situation: "A strong readiness track AND an urge to harm, submitted together.",
    rationale:
      "Precedence, stated as a scenario. The chain takes the most restrictive result of " +
      "every rule that fired — it does not average them, and a good signal cannot offset " +
      "a crisis one. This is the row that would go red if anyone ever made the engine " +
      "additive.",
    inputs: inputs({
      readiness: { track: "steady" },
      dailyCheckin: { ...inputs().dailyCheckin!, harmUrge: true, activation: 1 },
    }),
    expect: { tier: AccessTier.CRISIS, activating: false },
  },
  {
    id: "MISSING_CHECKIN",
    situation: "No check-in has been completed today.",
    rationale:
      "Absence of a signal is not a safe signal. The chain fails closed to grounding — " +
      "more restrictive, not less, than a poor check-in would produce. A reviewer should " +
      "check this row first: failing OPEN here would be invisible on every other screen.",
    inputs: inputs({ dailyCheckin: undefined }),
    expect: { tier: AccessTier.GROUNDING_ONLY, activating: false },
  },
];

export interface ScenarioResult {
  scenario: Scenario;
  actualTier: AccessTier;
  actualTierLabel: string;
  actualActivating: boolean;
  primaryReason: string | null;
  /** The rules that fired, in evaluation order — the trace p44 calls for. */
  hits: { id: string; reason: string }[];
  pass: boolean;
  /** Why it failed, when it did. Empty on a pass. */
  failures: string[];
}

/** Replay every scenario through the live engine. Pure and synchronous — it
 *  reads no database, so what it reports is the ENGINE's behaviour and not a
 *  particular member's data. */
export function replayScenarios(): ScenarioResult[] {
  return SCENARIOS.map((scenario) => {
    const d = evaluateAccess(scenario.inputs);
    const failures: string[] = [];
    if (d.tier !== scenario.expect.tier) {
      failures.push(
        `expected tier ${TIER_LABEL[scenario.expect.tier]}, got ${TIER_LABEL[d.tier]}`,
      );
    }
    if (d.activatingSessionsAllowed !== scenario.expect.activating) {
      failures.push(
        `expected activating sessions ${scenario.expect.activating ? "allowed" : "blocked"}, ` +
        `got ${d.activatingSessionsAllowed ? "allowed" : "blocked"}`,
      );
    }
    const want = scenario.expect.reasonIncludes;
    if (want && !(d.primaryReason ?? "").toLowerCase().includes(want.toLowerCase())) {
      failures.push(`expected the reason to mention "${want}"`);
    }
    return {
      scenario,
      actualTier: d.tier,
      actualTierLabel: d.tierLabel,
      actualActivating: d.activatingSessionsAllowed,
      primaryReason: d.primaryReason,
      hits: d.hits.map((h) => ({ id: h.id, reason: h.reason })),
      pass: failures.length === 0,
      failures,
    };
  });
}
