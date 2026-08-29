// What a reviewer can actually exercise in this environment (Phase 4 testing).
//
// The posture this file encodes, stated plainly:
//
//   IN A DEMO ENVIRONMENT, EVERYTHING THAT IS ONLY GATED BY DEPLOYMENT CAUTION
//   IS ON. The data is fabricated. A reviewer who cannot run a workflow cannot
//   give feedback on it, and "off by default" is not a safety property when
//   there is no one to protect — it is just a reviewer staring at a locked door
//   and concluding the feature does not exist.
//
// Three things stay off, and none of them is caution:
//
//   Autonomous desensitization is disabled in the safety configuration, which
//   two licensed psychologists signed. Flipping it is a clinical decision for
//   the people who signed it, not a deployment setting — and there is no
//   desensitization session implementation to walk even if it were flipped.
//
//   The autonomous engine still computes in shadow rather than governing. That
//   is the reviewers' own condition, and the whole point of the review is to
//   judge its decisions against the human-authored chain — which requires the
//   two to run side by side.
//
//   Event-authoritative writes are held for their gated migration window.
//
// Everything else a reviewer might expect to try, they can try.

import { blsResourcingEnabled, autonomousSafetyEnabled, liveSessionEnabled, voiceInputEnabled, BETA_CONFIG } from "../safety/config";
import { blsDisabled, killSwitches } from "../safety/governance";
import { testOpenGated } from "../gating";

export interface ExerciseRow {
  id: string;
  name: string;
  available: boolean;
  href: string | null;
  note: string;
}

const demo = () => process.env.EMDR_DEMO === "1";

/** Live reading of what can be exercised. Never a description of what should
 *  be reachable — that would be wrong the first time a flag changed. */
export function exerciseMatrix(): ExerciseRow[] {
  const openGated = testOpenGated();
  const bls = blsResourcingEnabled() && !blsDisabled();

  return [
    {
      id: "caseload",
      name: "Caseload, timeline, summaries, review actions",
      available: true,
      href: "/clinician/caseload",
      note: "Approve, correct, and override all write real events against fabricated records.",
    },
    {
      id: "alerts",
      name: "Alerts and closure with a documented action",
      available: true,
      href: "/clinician/caseload",
      note: "Immediate and high bands refuse an acknowledgement-only closure. Try it — the refusal is the behaviour under review.",
    },
    {
      id: "audit",
      name: "Audit history and alert trails",
      available: true,
      href: "/review/audit",
      note: "Tenant-scoped, free text withheld, hash chain verified and displayed.",
    },
    {
      id: "policy",
      name: "Switching clinical policy modes",
      available: true,
      href: "/clinician/caseload",
      note: "Six policy questions are versioned configuration. Switch one and compare — the defaults are assumptions, not approvals.",
    },
    {
      id: "gated-modules",
      name: "The full guided module set",
      available: openGated,
      href: "/app/paths",
      note: openGated
        ? "Open without a per-member unlock so the whole set can be walked. Set EMDR_OPEN_GATED=0 to review the request-and-approve workflow instead."
        : "Gated. Unlock per member from the clinical console — this is the setting for reviewing the unlock workflow itself.",
    },
    {
      id: "bls-resourcing",
      name: "Resourcing BLS session (Part 6, stage 4a)",
      available: bls,
      href: bls ? "/app/session/resourcing" : null,
      note: bls
        ? "Runnable. Still requires the member's processing-session consent, which is seeded for Alex and deliberately not for Sam so the refusal path is visible too."
        : blsDisabled()
          ? "EMDR_KILL_BLS is engaged — the kill switch disables all bilateral stimulation."
          : "Off. Set EMDR_BLS_RESOURCING=1, or run with EMDR_DEMO=1.",
    },
    {
      id: "desensitization",
      name: "Autonomous desensitization (stage 4b)",
      available: false,
      href: null,
      note:
        "Disabled in the safety configuration signed by two licensed psychologists, and not implemented. This is not a deployment setting and no environment variable reaches it — changing it is a clinical decision by the people who signed it.",
    },
    {
      id: "companion",
      name: "Companion, with the output guard enforcing",
      available: true,
      href: "/app/companion",
      note: "In demo the guard blocks a violating response rather than only logging it. Without an API key the deterministic fallback runs, which is a complete path.",
    },
    {
      id: "voice",
      name: "Voice input and live spoken sessions",
      available: liveSessionEnabled() && voiceInputEnabled(),
      href: "/app/session/resourcing",
      note: "On in demo so the highest-risk surface can be experienced and judged. Typing is always available and never required.",
    },
    {
      id: "autonomous-engine",
      name: "Autonomous safety engine",
      available: true,
      href: "/review/autonomous",
      note: autonomousSafetyEnabled()
        ? "Master flag on. Simulate any scenario and compare the engine against the human-authored chain."
        : "Runs in shadow: it computes and logs a parallel decision and governs nothing. Comparing the two is the review, so both run side by side by design.",
    },
    {
      id: "bls-oversight",
      name: "BLS Part 6 oversight",
      available: true,
      href: "/review/bls",
      note: "Gates, rollout ladder, pre-registered thresholds, and hard stops read against live configuration.",
    },
    {
      id: "member-walk",
      name: "The member experience end to end",
      available: true,
      href: "/app/today",
      note: "Sign in as a fabricated member from the review gateway. Check-in, grounding, practices, learn, SOS, and the crisis route are all reachable.",
    },
    {
      id: "population",
      name: "Organization and payer population views",
      available: false,
      href: null,
      note: "Not built. Phase 6 — there is nothing behind this and no claim that there is.",
    },
  ];
}

/** One sentence describing the posture, for the top of the testing page. */
export function postureNote(): string {
  if (!demo()) {
    return (
      "This is not a demonstration environment. Capabilities gated for real deployments are " +
      "off, and this page reports that rather than the demo posture."
    );
  }
  const ks = killSwitches();
  const engaged = Object.entries(ks).filter(([, v]) => v).map(([k]) => k);
  const base =
    "Fabricated data, so everything gated only by deployment caution is on — the full module " +
    "set, resourcing BLS, voice, and the enforcing companion guard. What stays off stays off " +
    "for a stated reason, not for safety theatre.";
  return engaged.length > 0
    ? `${base} Kill switches engaged: ${engaged.join(", ")}.`
    : base;
}

/** The things that are off and why, for anyone asking "can you turn this on?".
 *  Each answer is either "yes, here is the flag" or a reason that is not fear. */
export const HELD_BACK: Array<{ what: string; why: string; whoDecides: string }> = [
  {
    what: "Autonomous desensitization (BLS stage 4b)",
    why: "Disabled in the signed safety configuration, and not implemented. Professional-body policy opposes self-administered desensitization, and that question is unresolved.",
    whoDecides: "The two licensed psychologists who signed the configuration, with counsel.",
  },
  {
    what: "The autonomous engine governing access",
    why: "It computes and logs a parallel decision while the human-authored chain decides. Running both side by side is what makes the comparison reviewable; promoting it early would remove the thing under review.",
    whoDecides: "Clinical reviewers, against their stated deployment-evidence conditions.",
  },
  {
    what: "Event-authoritative writes",
    why: "Specified in ADR 0013 and held for its gated migration window rather than switched on mid-review.",
    whoDecides: "Founder, at the Postgres cutover.",
  },
];

export const BETA_CONFIG_VERSION_NOTE =
  `Desensitization flag in the safety configuration: ${BETA_CONFIG.autonomousStimulationEnabled}. ` +
  "It is a constant, not an environment variable.";
