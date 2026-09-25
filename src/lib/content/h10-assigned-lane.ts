// Handoff 10 Phase 3: the clinician-assigned lane's containers (§6), in
// Handoff 03's ModuleDefinition shape (future-platform-intelligence/03 §3).
//
// BUILT AHEAD OF ITS GATE, on the product owner's instruction of 25 September:
// "this is for a team to review and test". §6 parks the lane behind four
// things none of which exist yet — Handoff 03's activation gate, a signed
// provider partner, licensed protocol content, and the HIPAA / BAA / Postgres
// work. The code is here; the lane is not live. Its rows (CV10_E01 to E05)
// are for a partner's clinical lead and are unsigned, so outside the demo it
// is absent everywhere, and every definition below is `state: "draft"`.
//
// NO PROTOCOL CONTENT. §6: "This handoff contains no protocol content for
// WET, CPT, or IRT and none should be written from memory." `content` is what
// a partner supplies under licence; it is null here. The demo carries
// PLACEHOLDER steps so a review team can walk the container end to end, and
// every one of them says, in its own words, that it is a placeholder — never
// an instruction a member could mistake for the real thing.
//
// Member-facing titles name no modality (CV10_F02): "Written exposure
// (clinician-assigned)" is the handoff's own; the other two are drafts for the
// partner's lead to confirm (E03, E04), listed on the review worksheet.

import { AccessTier } from "../safety/types";

/** One step of a container, as a partner would supply it. */
export type LaneStep =
  | { kind: "read"; id: string; body: string }
  /** Free writing: a narrative (WET, IRT). Encrypted; member and assigning clinician only. */
  | { kind: "write"; id: string; prompt: string }
  /** A worksheet: several labelled boxes (CPT). Same handling as `write`. */
  | { kind: "fields"; id: string; prompt: string; fields: ReadonlyArray<{ id: string; label: string }> };

/** Handoff 03 §3, as written, plus the sign-off rows this app's content
 *  gate reads and the partner-supplied steps. */
export interface ModuleDefinition {
  moduleId: string;
  version: string;
  title: string;
  category: string;
  clinicalLane: "wellness" | "clinician_assigned";
  expectedMinutes: number;
  requiredGates: readonly string[];
  contraindicationRuleIds: readonly string[];
  inputSchemaVersion: string;
  responseSchemaVersion: string;
  outcomeMeasureIds: readonly string[];
  contentOwner: string;
  clinicalReviewId: string;
  state: "draft" | "approved" | "retired";
}

export interface LaneModule extends ModuleDefinition {
  clinicalLane: "clinician_assigned";
  /** Every row that must be agreed before this is live: the lane rules (E01),
   *  its own row, and protocol source and fidelity (E05). */
  signoffRowIds: readonly string[];
  /** The partner's licensed steps. Null until supplied. */
  content: readonly LaneStep[] | null;
  /** Demo only, and labelled as such on every step. */
  demoPlaceholder: readonly LaneStep[];
}

/** The lane's gates (§6 stubs), by the codes the stubs use. */
export const LANE_REQUIRED_GATES = ["active_assignment", "tier>=STEADY", "no_crisis_today"] as const;
export const LANE_CONTRAINDICATIONS = ["active_crisis", "high_dissociation"] as const;
export const LANE_MIN_TIER = AccessTier.STEADY;

/** E01: "If after exceeds before by 3 or more, or exceeds 7". */
export const DISTRESS_RISE_FLAG = 3;
export const DISTRESS_CEILING_FLAG = 7;

const PARTNER = "<partner>";

const placeholder = (what: string): LaneStep[] => [
  { kind: "read", id: "intro", body: `Placeholder for testing. The partner's licensed instructions for ${what} go here. Nothing on this step is clinical content.` },
];

export const LANE_MODULES: readonly LaneModule[] = [
  {
    moduleId: "wet-v1", version: "0-draft", title: "Written exposure (clinician-assigned)",
    category: "trauma_processing", clinicalLane: "clinician_assigned", expectedMinutes: 30,
    requiredGates: LANE_REQUIRED_GATES, contraindicationRuleIds: LANE_CONTRAINDICATIONS,
    inputSchemaVersion: "lane-steps-v1", responseSchemaVersion: "lane-response-v1",
    outcomeMeasureIds: ["pcl-5"], contentOwner: PARTNER, clinicalReviewId: "CV10_E02", state: "draft",
    signoffRowIds: ["CV10_E01", "CV10_E02", "CV10_E05"],
    content: null,
    demoPlaceholder: [
      ...placeholder("this writing session"),
      { kind: "write", id: "narrative", prompt: "Placeholder writing box for testing. The partner's writing prompt goes here." },
    ],
  },
  {
    moduleId: "cpt-worksheets-v1", version: "0-draft", title: "Worksheets (clinician-assigned)",
    category: "trauma_processing", clinicalLane: "clinician_assigned", expectedMinutes: 20,
    requiredGates: LANE_REQUIRED_GATES, contraindicationRuleIds: LANE_CONTRAINDICATIONS,
    inputSchemaVersion: "lane-steps-v1", responseSchemaVersion: "lane-response-v1",
    outcomeMeasureIds: ["pcl-5"], contentOwner: PARTNER, clinicalReviewId: "CV10_E03", state: "draft",
    signoffRowIds: ["CV10_E01", "CV10_E03", "CV10_E05"],
    content: null,
    demoPlaceholder: [
      ...placeholder("this worksheet"),
      {
        kind: "fields", id: "worksheet", prompt: "Placeholder worksheet for testing. The partner's worksheet goes here.",
        fields: [
          { id: "a", label: "Placeholder box A" },
          { id: "b", label: "Placeholder box B" },
          { id: "c", label: "Placeholder box C" },
        ],
      },
    ],
  },
  {
    moduleId: "irt-nightmares-v1", version: "0-draft", title: "Nightmare rehearsal (clinician-assigned)",
    category: "trauma_processing", clinicalLane: "clinician_assigned", expectedMinutes: 20,
    requiredGates: LANE_REQUIRED_GATES, contraindicationRuleIds: LANE_CONTRAINDICATIONS,
    inputSchemaVersion: "lane-steps-v1", responseSchemaVersion: "lane-response-v1",
    outcomeMeasureIds: ["pcl-5"], contentOwner: PARTNER, clinicalReviewId: "CV10_E04", state: "draft",
    signoffRowIds: ["CV10_E01", "CV10_E04", "CV10_E05"],
    content: null,
    demoPlaceholder: [
      ...placeholder("this rehearsal"),
      { kind: "write", id: "narrative", prompt: "Placeholder writing box for testing. The partner's rehearsal prompt goes here." },
    ],
  },
];

export function getLaneModule(id: string): LaneModule | undefined {
  return LANE_MODULES.find((m) => m.moduleId === id);
}

/** Member-facing words for the lane. Handoff 03 §5's patient mock-ups (the
 *  product team's, not clinical content), without its "Before: distress 6/10"
 *  line: a rating a member entered is never shown back outside Progress
 *  (Handoff 10 §2.2, CV10_B03). */
export const LANE_COPY = {
  aboutMinutes: (n: number) => `About ${n} minutes`,
  assignedBy: (name: string) => `Assigned by ${name}`,
  reviewDate: (d: string) => `Review date ${d}`,
  start: "Start practice",
  notNow: "Not now",
  canStop: "You can stop at any time.",
  stepOf: (i: number, n: number) => `Step ${i} of ${n}`,
  back: "Back",
  continue: "Continue",
  stop: "Stop practice",
  before: "Before you start: how much distress are you feeling right now, from 0 to 10?",
  after: "Right now: how much distress are you feeling, from 0 to 10?",
  complete: "Practice complete",
  useful: "Did this feel useful?",
  usefulChoices: ["Yes", "Not sure", "No"] as const,
  note: "Anything you want your clinician to know? Optional",
  finish: "Finish",
  stopped: "You stopped. That's always okay.",
  steady: "Let's steady things first.",
  steadyBody: "Your clinician will see that this was a hard one. Grounding is one tap away, and so is SOS.",
  unavailable: "This isn't available right now.",
  notToday: "Today is set up a little differently, so this isn't the right thing to do right now. Nothing is lost.",
} as const;
