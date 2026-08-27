// BLS Part 6 clinical oversight (Phase 4, workflow spec §8).
//
// Part 6 is the bilateral-stimulation validation workstream. It is signed at
// protocol level (docs/autonomous/bls-validation/Part6-SIGNED-2026-07-22.pdf)
// and is NOT approved for real-person use. This module gives a clinician the
// oversight view the protocol assumes exists: which gates are met, which stage
// the rollout is at, what the pre-registered thresholds are, and — the part a
// document cannot tell you — what the running system is actually configured to
// do right now.
//
// The distinction this file is built around:
//
//   A DOCUMENT states the protocol. A CONSOLE states the configuration. The
//   failure mode Part 6 is most exposed to is the two drifting apart — a signed
//   protocol saying desensitization is disabled while a flag somewhere has
//   turned it on. So every stage below reports live state read from the same
//   functions the runtime uses, never a transcribed value.
//
// Nothing here governs anything. It reads configuration and renders it. The
// gates are enforced in src/lib/safety/ and src/lib/gating.ts, which is where
// they belong — an oversight view that could also flip a switch is a control
// surface, and a control surface needs a different review than this has had.

import { BETA_CONFIG, BLS_RESOURCING, blsResourcingEnabled } from "../safety/config";
import { killSwitches, blsDisabled } from "../safety/governance";

export type GateState = "met" | "open" | "blocked";

export const GATE_STATE_LABEL: Record<GateState, string> = {
  met: "Met",
  open: "Open",
  blocked: "Blocked",
};

export interface Part6Gate {
  id: string;
  n: number;
  name: string;
  state: GateState;
  detail: string;
  evidence: string | null;
}

/** The six Part-6 gates, with the evidence that closed each one. Gate state is
 *  a documented fact about the protocol package, not a live reading — so each
 *  one cites the artefact a reviewer can open. */
export const PART6_GATES: Part6Gate[] = [
  {
    id: "protocol",
    n: 1,
    name: "BLS protocol signed",
    state: "met",
    detail: "The bilateral-stimulation protocol was reviewed and signed. Any parameter change voids the sign-off and requires renewed clinician review.",
    evidence: "docs/autonomous/bls-protocol-SIGNED-2026-07-22.pdf",
  },
  {
    id: "human-factors",
    n: 2,
    name: "Human-factors test plan",
    state: "open",
    detail: "The plan exists. The testing it describes — how the interface behaves for a person under stress — has not been run, and it is a condition of the existing clinical sign-off.",
    evidence: "docs/autonomous/bls-validation/02-human-factors-test-plan.md",
  },
  {
    id: "consent",
    n: 3,
    name: "Processing-session consent",
    state: "met",
    detail: "A distinct, versioned consent separate from the care-program and voice consents, approved by clinical review and counsel. It must be granted and unrevoked before any stimulation set.",
    evidence: "docs/autonomous/bls-validation/01-processing-session-consent.md",
  },
  {
    id: "red-team",
    n: 4,
    name: "Red-team plan",
    state: "open",
    detail: "The plan exists; the exercise has not been run. An unresolved critical finding is one of the hard stopping criteria, so this gate has to close before a monitored cohort, not after.",
    evidence: "docs/autonomous/bls-validation/03-red-team-plan.md",
  },
  {
    id: "rollout",
    n: 5,
    name: "Staged rollout plan with pre-registered thresholds",
    state: "met",
    detail: "Sub-stages, cohort sizes, windows, and stop triggers were set by clinicians before entry rather than fitted afterwards.",
    evidence: "docs/autonomous/bls-validation/04-phase4-staged-rollout.md",
  },
  {
    id: "emdria",
    n: 6,
    name: "Self-administration policy question",
    state: "blocked",
    detail: "Professional-body policy opposes self-administered desensitization. Counsel cleared the terminology and the processing scope; whether the product offers self-administered processing at all is a standing clinical decision, not a resolved one. Stage 4b cannot open while this is unresolved.",
    evidence: "docs/autonomous/bls-validation/01-processing-session-consent.md",
  },
];

export interface RolloutStage {
  id: string;
  name: string;
  scope: string;
  /** Whether the running configuration currently permits this stage. */
  enabled: boolean;
  /** Why it is or is not enabled — read from configuration, not transcribed. */
  because: string;
  cohort: number | null;
  window: string | null;
  entry: string[];
}

/** The 4a/4b/4c ladder, with live enablement read from the same functions the
 *  runtime uses. */
export function rolloutStages(): RolloutStage[] {
  const killed = blsDisabled();
  const resourcing = blsResourcingEnabled();

  return [
    {
      id: "4a",
      name: "Resourcing BLS only",
      scope:
        "Short, slow sets paired with a positive resource and a cue word. Calm/Safe Place installation. No trauma-memory targeting.",
      enabled: resourcing && !killed,
      because: killed
        ? "EMDR_KILL_BLS is set — the kill switch disables all bilateral stimulation globally, overriding the stage flag."
        : resourcing
          ? (process.env.EMDR_DEMO === "1"
              ? "On in this demonstration environment, so a clinical reviewer can actually walk the workflow rather than read about it. Each member still needs an unrevoked processing-session consent, and the kill switch still overrides. Set EMDR_BLS_RESOURCING=0 to force it off and review the refusal path."
              : "EMDR_BLS_RESOURCING=1 and the kill switch is off. Each member still needs an unrevoked processing-session consent.")
          : "Off. Set EMDR_BLS_RESOURCING=1, or run a demonstration environment with EMDR_DEMO=1.",
      cohort: 12,
      window: "14 days plus review before 4b",
      entry: [
        "All other Part-6 gates complete",
        "Kill switch live",
        "Monitored cohort defined",
      ],
    },
    {
      id: "4b",
      name: "Supervised internal desensitization",
      scope:
        "Desensitization to the approved parameters, internal supervised cohort only, tight monitoring, low volume.",
      // Not a flag read: desensitization is disabled in the safety config
      // itself, and no environment variable can reach it.
      enabled: BETA_CONFIG.autonomousStimulationEnabled,
      because:
        "autonomousStimulationEnabled is false in the safety configuration. This is not an environment flag — the engine removes the stimulation capability globally, so no deployment setting can turn 4b on.",
      cohort: 6,
      window: "Predefined window with 4a stable",
      entry: [
        "The self-administration policy question resolved in favour of offering processing",
        "Stage 4a stable for the predefined window",
      ],
    },
    {
      id: "4c",
      name: "Limited real-member desensitization",
      scope: "Small, consented, monitored cohort with an explicit off-ramp to clinician referral.",
      enabled: false,
      because: "Requires 4b clean for its window plus counsel and clinician re-affirmation. 4b has not opened.",
      cohort: 12,
      window: "After 4b's window",
      entry: [
        "4b clean for the predefined window",
        "Complaint and adverse-event rate within target",
        "Counsel and clinician re-affirmation",
      ],
    },
  ];
}

/** The five conditions that stop a stage immediately. Any one of them disables;
 *  they are not weighed against each other. */
export const HARD_STOPS = [
  "A dissociation- or orientation-stop bypass.",
  "A session that ends without mandatory closure.",
  "An AI-generated crisis or during-set clinical instruction.",
  "A symptom-worsening or adverse-event rate above the pre-registered threshold.",
  "Any unresolved critical red-team finding.",
] as const;

/** Thresholds set by clinicians before entry. Recorded so the console shows the
 *  number that was pre-registered, not the number a stage is currently hitting
 *  — the protocol's own instruction is "set them, don't fit them". */
export const PRE_REGISTERED = [
  ["4a monitored cohort", "12 members"],
  ["Window before 4b", "14 days plus review"],
  ["Symptom-worsening stop trigger", "Any protocol-related clinically meaningful worsening — a single case stops the stage"],
  ["4b / 4c cohorts", "6 / 12"],
  ["Adverse-event ceiling", "Zero serious. Any serious adverse event pauses the rollout"],
] as const;

export interface RunningConfig {
  killSwitchOn: boolean;
  resourcingFlagOn: boolean;
  desensitizationEnabled: boolean;
  visualStimulationEnabled: boolean;
  /** Resourcing parameters actually in force. */
  hz: number;
  passesPerSet: number;
  maxSets: number;
  cueWordRequired: boolean;
  /** Every kill switch, so an oversight view shows the whole panel rather than
   *  the one switch this page is about. */
  switches: ReturnType<typeof killSwitches>;
}

export function runningConfig(): RunningConfig {
  return {
    killSwitchOn: blsDisabled(),
    resourcingFlagOn: blsResourcingEnabled(),
    desensitizationEnabled: BETA_CONFIG.autonomousStimulationEnabled,
    visualStimulationEnabled: BETA_CONFIG.visualStimulationEnabled,
    hz: BLS_RESOURCING.hz,
    passesPerSet: BLS_RESOURCING.passesPerSet,
    maxSets: BLS_RESOURCING.maxSets,
    cueWordRequired: BLS_RESOURCING.cueWordRequired,
    switches: killSwitches(),
  };
}

export interface OversightStatus {
  /** Can any bilateral stimulation happen in this environment right now? */
  anyBlsPossible: boolean;
  gatesMet: number;
  gatesTotal: number;
  blockedGates: Part6Gate[];
  openGates: Part6Gate[];
  /** One sentence a clinician can act on. */
  headline: string;
}

export function oversightStatus(): OversightStatus {
  const cfg = runningConfig();
  const stages = rolloutStages();
  const anyBlsPossible = stages.some((s) => s.enabled);
  const blockedGates = PART6_GATES.filter((g) => g.state === "blocked");
  const openGates = PART6_GATES.filter((g) => g.state === "open");
  const gatesMet = PART6_GATES.filter((g) => g.state === "met").length;

  const headline = cfg.killSwitchOn
    ? "All bilateral stimulation is disabled by the kill switch."
    : anyBlsPossible
      ? "Resourcing BLS is enabled in this environment. Desensitization remains disabled in the safety configuration."
      : "No bilateral stimulation is enabled in this environment.";

  return {
    anyBlsPossible,
    gatesMet,
    gatesTotal: PART6_GATES.length,
    blockedGates,
    openGates,
    headline,
  };
}

/** Whether this environment may run Part 6 against real people. It may not, and
 *  the answer does not depend on configuration — no environment is approved. */
export const REAL_USE_APPROVED = false;

export const REAL_USE_NOTE =
  "Part 6 is not approved for real-person use in any environment. The protocol is signed, " +
  "two gates are open, and the self-administration policy question is unresolved. What this " +
  "console shows is the configuration of a fabricated demonstration.";
