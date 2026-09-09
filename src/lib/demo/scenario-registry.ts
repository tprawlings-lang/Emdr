// The named scenarios (handoff 09 §7.2, §10 Package 4).
//
// Package 4's exit evidence: "Named scenarios complete from the published
// baseline." Named is the operative word. A launcher over an empty registry is
// a launcher; what makes this package done is that specific stories, written
// down, run end to end on the dataset the reset rebuilds.
//
// §7.2 SPECIFIES THE INVESTOR STORY'S SHAPE, in order: "the between-visit
// problem, the member action, the clinician review, the aggregate evidence,
// and a bounded next step." Five beats. The scenario below is those five, and
// the order is not a suggestion — it is the argument. The aggregate chart
// means nothing to somebody who has not just watched one member act and one
// clinician review it, which is why `transition` refuses a jump forward.
//
// EVERY STEP OPENS A REAL SCREEN. §7.2: "Real working screens with clearly
// labeled simulations." The hrefs below are routes in this application, and
// the guard checks every one against Package 0's route register — so a
// scenario cannot survive a route being renamed, and cannot point at a screen
// the register marks as not working.
//
// AND NO SCENARIO GRANTS ANYTHING. Each is passed through
// `assertGrantsNothing` at module load, so a scenario carrying a role, a
// capability or a tenant fails the import rather than the review.

import {
  assertGrantsNothing,
  type Scenario,
} from "../experience/scenario";

// ---------------------------------------------------------------------------
// The stories
// ---------------------------------------------------------------------------

const INVESTOR: Scenario = {
  id: "between-visit",
  title: "What happens between visits",
  audience: "investor",
  version: "between-visit.1.0.0",
  purpose:
    "The five minutes that show the problem Steady is for, one member acting on it, " +
    "one clinician reviewing it, and what the evidence does and does not say.",
  minutes: 5,
  requires: ["last_reset", "data_quality", "safety_replay", "demo_accounts"],
  steps: [
    {
      id: "problem",
      title: "The gap between appointments",
      say:
        "Care happens in the hour somebody is in the room. The other 167 hours are where " +
        "the deterioration happens, and nobody sees them. This is the queue a clinician " +
        "opens on Monday.",
      href: "/clinician/today",
      simulated: false,
      minutes: 1,
      essential: true,
    },
    {
      id: "member",
      title: "What the member actually does",
      say:
        "One orienting sentence, one recommended activity, a duration and a promise they " +
        "can stop. No score, no streak, no percentage — the member surface structurally " +
        "cannot receive a score.",
      href: "/app/today",
      simulated: false,
      minutes: 1,
      essential: true,
    },
    {
      id: "clinician",
      title: "The clinician's review",
      say:
        "Every row says who, what changed, when, and what it is waiting on. Opening a " +
        "person is not acknowledgement — the actions are separate on purpose.",
      href: "/clinician/today",
      simulated: false,
      minutes: 1,
      essential: true,
    },
    {
      id: "aggregate",
      title: "What the evidence says",
      say:
        "Aggregate outcomes with a visible denominator and a method drawer. Modelled " +
        "figures are labelled as modelled. This is a fabricated population, and the " +
        "screen says so on every page.",
      href: "/organization/outcomes",
      simulated: true,
      minutes: 1,
      essential: true,
    },
    {
      id: "limits",
      title: "What this does not do",
      say:
        "Two ratifying psychologists, thirty deterministic rules, a fourteen-step gate, " +
        "and a member surface that cannot display a score. It is not therapy, not a " +
        "medical device, and not cleared for clinical use. Here is the register of what " +
        "works and what does not.",
      href: "/review/status",
      simulated: false,
      minutes: 1,
      essential: true,
    },
  ],
  claims: [
    "The safety gate is deterministic and runs the same rules in the demonstration as in the product.",
    "The member surface cannot receive a score field, at any depth, by construction.",
    "Every aggregate figure on screen carries its denominator and its method.",
  ],
  limitations: [
    "Every person, record and clinician in this environment is invented.",
    "No clinical validation has been performed. Thresholds are reviewed, not validated.",
    "Therapeutic Load states have not had their own clinical review and are not shown outside this environment.",
  ],
  closeout: {
    exists: [
      "A working safety gate, a member surface with a structural score boundary, a clinician queue, and an aggregate console.",
      "A dated register of every route, saying which are working and which are not.",
    ],
    unfinished: [
      "Clinical validation of the thresholds, which needs a study rather than a sprint.",
      "Therapeutic Load's own clinical review before those states go anywhere.",
      "The reviewer decision flow and the governed export, which are the next two packages.",
    ],
    decision:
      "Whether to fund the clinical validation programme that turns reviewed thresholds into validated ones.",
  },
};

const CLINICAL: Scenario = {
  id: "clinical-walkthrough",
  title: "One person, end to end",
  audience: "clinical",
  version: "clinical-walkthrough.1.0.0",
  purpose:
    "The clinical path a reviewer needs to judge: what the gate decided, what the member saw, " +
    "what the clinician was told, and what evidence sits behind each.",
  minutes: 8,
  requires: ["last_reset", "data_quality", "safety_replay", "demo_accounts"],
  steps: [
    {
      id: "queue",
      title: "The attention queue",
      say:
        "Server-ranked, never re-sorted in the browser. The bucket a person is in is a " +
        "clinical judgement made by rules, not by a model.",
      href: "/clinician/today",
      simulated: false,
      minutes: 2,
      essential: true,
    },
    {
      id: "gate",
      title: "The gate, replayed",
      say:
        "Ten fixed scenarios through the live engine. A green row proves this build runs " +
        "the production rules; it is not evidence the thresholds are clinically correct.",
      href: "/review/safety",
      simulated: false,
      minutes: 2,
      essential: true,
    },
    {
      id: "member-day",
      title: "What the member was shown",
      say:
        "The same decision, from the other side. Narrowing never explains itself as a " +
        "failure — shame drives disengagement in this population.",
      href: "/app/today",
      simulated: false,
      minutes: 2,
      essential: true,
    },
    {
      id: "record",
      title: "The record behind it",
      say: "Every claim on a clinical surface cites the event it came from.",
      href: "/review/audit",
      simulated: false,
      minutes: 2,
      essential: false,
    },
  ],
  claims: [
    "The gate engine on this build matches its fixed scenarios.",
    "No clinical surface states a conclusion it cannot cite.",
  ],
  limitations: [
    "Fabricated data only. No real person, no real health information.",
    "A replay proves the rules are the same, not that they are right.",
  ],
  closeout: {
    exists: [
      "A deterministic gate with a replayable scenario set and a hash-chained audit trail.",
      "A member boundary enforced by an allow-list rather than by review.",
    ],
    unfinished: [
      "Clinical validation of every threshold.",
      "Therapeutic Load's ratifying review.",
    ],
    decision: "Whether the rules as written are safe enough to take to a validation study.",
  },
};

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/** Checked at module load. A scenario carrying a role, a capability or a
 *  tenant fails the import — before it reaches a review, and before anybody
 *  can demonstrate it. */
export const SCENARIOS: readonly Scenario[] = [INVESTOR, CLINICAL].map((s) =>
  assertGrantsNothing(s, `scenario "${s.id}"`)
);

export function scenario(id: string): Scenario | null {
  return SCENARIOS.find((s) => s.id === id) ?? null;
}

export function scenariosFor(audience: Scenario["audience"]): Scenario[] {
  return SCENARIOS.filter((s) => s.audience === audience);
}
