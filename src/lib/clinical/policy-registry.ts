// The clinical-intelligence policy registry (expansion handoff 03, Phase 6).
//
// Phase 6 asks for "tenant-aware flags and policy registry", and the registry's
// job is one that nothing else in the stack does: make the complete set of
// versioned rules ENUMERABLE.
//
// By the end of this series a single Command Center row can rest on six
// independently versioned policies — the clinical policy, the retrieval policy,
// the goal projection, the response fingerprint, the engagement threshold, the
// command-context assembly — and a clinician asking "under what rules was this
// decided?" currently has to be told six separate answers by six separate
// screens, if anyone thought to print them.
//
// §3 asks for "policy version in a low-emphasis status affordance"; §13 of
// handoff 02 asks for summaries "reproducible from evidence + policy version";
// §12 asks acknowledgement to record the version it was made under. All three
// are easier to keep true when the set is one list.
//
// WHAT THIS IS NOT. It is not a place to change a policy, and there is no
// setter here. Each entry POINTS AT the module that owns its rule, and the
// version string is that module's own constant — a registry that held its own
// copy would be a seventh version to keep in sync, and the first one to go
// stale.
//
// AND IT IS A TEST SURFACE. A policy that appears on a screen and not in this
// list is a rule nobody can enumerate; `tests/command-center-contract.test.ts`
// checks that every versioned policy in the stack is registered, so adding a
// seventh rule without listing it fails the build rather than quietly making
// the status line incomplete.

import { CLINICAL_POLICY_VERSION } from "../clinical-policy";
import { RETRIEVAL_POLICY_VERSION } from "./retrieval-policy";
import { SESSION_PREP_VERSION } from "./session-prep";
import { GOAL_PROJECTION_VERSION } from "./return-goal-projection";
import { RESPONSE_POLICY } from "./response-fingerprint-policy";
import { COMMAND_CONTEXT_VERSION } from "./command-context";
import { COMMAND_SUMMARY_VERSION } from "./command-summary";
import { CASELOAD_STATE_VERSION } from "./caseload-state";
import { ACTIVITY_VERSION } from "./recent-activity";
import { ENGAGEMENT_POLICY_VERSION } from "./attention-providers/providers";
import { TRAJECTORY_POLICY } from "./trajectory-policy";

export interface RegisteredPolicy {
  /** Stable key, for a screen that wants to name one. */
  id: string;
  /** What a clinician would call it. */
  label: string;
  version: string;
  /** What it decides, in one line. The registry is read by people, not only by
   *  the status line. */
  decides: string;
  /** Where the rule lives, so "which file do I change" has one answer. */
  module: string;
}

export const POLICY_REGISTRY: RegisteredPolicy[] = [
  {
    id: "clinical",
    label: "Clinical policy",
    version: CLINICAL_POLICY_VERSION,
    decides: "Coverage schedule, alert deadlines, caseload model, and whether Companion content is visible.",
    module: "src/lib/clinical-policy.ts",
  },
  {
    id: "retrieval",
    label: "Retrieval policy",
    version: RETRIEVAL_POLICY_VERSION,
    decides: "What may be read into a brief or an answer, and what is excluded.",
    module: "src/lib/clinical/retrieval-policy.ts",
  },
  {
    id: "session_prep",
    label: "Session prep",
    version: SESSION_PREP_VERSION,
    decides: "Which sections a pre-session brief has, and that every claim cites authorized evidence.",
    module: "src/lib/clinical/session-prep.ts",
  },
  {
    id: "goal_projection",
    label: "Life-goal projection",
    version: GOAL_PROJECTION_VERSION,
    decides: "What counts as a stall, a reversal, and evidence waiting on review.",
    module: "src/lib/clinical/return-goal-projection.ts",
  },
  {
    id: "response_fingerprint",
    label: "Response fingerprint",
    version: RESPONSE_POLICY.version,
    decides: "How many comparable exposures a pattern needs, and how strata and limitations are computed.",
    module: "src/lib/clinical/response-fingerprint-policy.ts",
  },
  {
    id: "recovery_trajectory",
    label: "Recovery trajectory",
    version: TRAJECTORY_POLICY.version,
    decides:
      "What counts as meaningful movement in each domain, on that domain's own scale, and how many observations a window needs before Steady compares it with anything.",
    module: "src/lib/clinical/trajectory-policy.ts",
  },
  {
    id: "engagement_gap",
    label: "Engagement gap",
    version: ENGAGEMENT_POLICY_VERSION,
    decides: "How long an observed gap in check-ins runs before it is worth a clinician's notice.",
    module: "src/lib/clinical/attention-providers/providers.ts",
  },
  {
    id: "command_context",
    label: "Command context",
    version: COMMAND_CONTEXT_VERSION,
    decides: "Which sections the review drawer assembles and how absence is reported.",
    module: "src/lib/clinical/command-context.ts",
  },
  {
    id: "command_summary",
    label: "Cross-system summary",
    version: COMMAND_SUMMARY_VERSION,
    decides: "What a generated sentence may say, and when it is withheld.",
    module: "src/lib/clinical/command-summary.ts",
  },
  {
    id: "caseload_state",
    label: "Caseload state",
    version: CASELOAD_STATE_VERSION,
    decides: "How each caseload column is derived, and its calculation window.",
    module: "src/lib/clinical/caseload-state.ts",
  },
  {
    id: "recent_activity",
    label: "Recent activity",
    version: ACTIVITY_VERSION,
    decides: "Which events are clinically relevant enough to appear, and which collapse.",
    module: "src/lib/clinical/recent-activity.ts",
  },
];

export function policyById(id: string): RegisteredPolicy | undefined {
  return POLICY_REGISTRY.find((p) => p.id === id);
}

/** One line for a status affordance (§3). Short enough to sit under a header
 *  strip without becoming the thing the eye lands on. */
export function policySummaryLine(): string {
  return `${POLICY_REGISTRY.length} versioned policies in force · clinical ${CLINICAL_POLICY_VERSION}`;
}
