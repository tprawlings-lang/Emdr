// Configurable clinical policy modes (Demo-First handoff §6).
//
// Six policy questions determine how the clinical surface behaves. Three of
// them — companion-content visibility, caseload ownership, and out-of-hours
// coverage — are the highest-impact open decisions in the programme, and none
// has a reviewer answer yet.
//
// The handoff's insight is that this need not block anything: implement the
// decisions as *versioned configuration* rather than hard-coded behaviour, ship
// the T0/T1 defaults as explicit demonstration assumptions, and let reviewers
// compare alternatives against a working system instead of a document. A
// reviewer who can switch a mode and watch the product change will give a
// better answer than one asked to imagine it.
//
// THE RULE THIS FILE EXISTS TO ENFORCE
//
// A default is not an approval. Every mode below carries `approved: false`
// until a named reviewer ratifies it in a signed packet, and any surface that
// depends on one must be able to say which mode is active and that it is
// provisional. `beta-clinrev-2026-07` ratified the CONSUMER product and does
// not extend to any of this.
//
// Modes are read-only at runtime and selected by environment, so a demo cannot
// drift into a configuration nobody chose. Changing one is a deploy, and the
// active version is visible in the product.

/** Bump when a default changes or a mode is added. Recorded on every clinical
 *  event so a decision can be reconstructed against the policy that produced
 *  it (handoff §7: "which policy was active"). */
export const CLINICAL_POLICY_VERSION = "clinical-policy-2026-08-t1";

// ---------------------------------------------------------------------------
// The six policies
// ---------------------------------------------------------------------------

/** How much of a member's companion conversation a clinician may see.
 *
 *  The highest-stakes question in the clinical design: companion transcripts
 *  are trauma narratives in the member's own words. Too little and a clinician
 *  cannot act on what they are told; too much and members learn the "private"
 *  companion is read by their clinician, which changes what they say to it. */
export type CompanionVisibility =
  | "never"              // clinicians never see conversation content
  | "escalation_excerpt" // only the excerpt that triggered an escalation
  | "member_shared"      // only what the member explicitly shares
  | "always";            // full transcripts within the caseload

/** Who owns a member's care within a tenant. */
export type CaseloadModel =
  | "owned"   // one named clinician; nobody else may act
  | "pooled"  // any clinician in the tenant may act
  | "hybrid"; // a primary owner, with a coverage pool for absence

/** What the member is promised, and what the alert deadlines can assume. */
export type CoverageModel =
  | "none"           // no clinician review commitment
  | "business_hours"
  | "extended"
  | "24_hour";

/** What an Immediate-band alert does to the member's experience, beyond
 *  notifying a clinician. */
export type AlertConsequence =
  | "notify_only"     // human signal only; nothing changes for the member
  | "pause_processing" // processing/BLS pauses; check-ins, grounding, crisis stay open
  | "lock_workflow"   // everything but crisis and grounding closes
  | "emergency_path"; // route directly to crisis resources

/** How a member returns after a hard stop, escalation, or long absence. */
export type ReEntryModel =
  | "automatic"          // resume freely
  | "timed"              // resume after a cooldown
  | "clinician_decision"; // requires a documented decision

/** How much authority the deterministic safety engine has. */
export type AutonomousMode =
  | "off"       // not consulted
  | "shadow"    // computes and logs; governs nothing
  | "recommend" // surfaces a recommendation to a clinician
  | "active";   // governs access

export interface ClinicalPolicy {
  version: string;
  companionVisibility: CompanionVisibility;
  caseload: CaseloadModel;
  coverage: CoverageModel;
  alertConsequence: AlertConsequence;
  reEntry: ReEntryModel;
  autonomous: AutonomousMode;
  /** False until a named reviewer ratifies these in a signed packet. */
  approved: boolean;
  /** Which packet ratified it, once one has. */
  approvedBy: string | null;
}

/** T0/T1 defaults from handoff §6. Demonstration assumptions, not approvals. */
export const T1_DEFAULT_POLICY: ClinicalPolicy = {
  version: CLINICAL_POLICY_VERSION,
  // Minimum necessary: enough to act on a risk signal, not a reading habit.
  companionVisibility: "escalation_excerpt",
  // A named owner for accountability, a pool so absence does not mean silence.
  caseload: "hybrid",
  // Honest about what can actually be staffed. Steady is available at 3am; a
  // clinician is not, and the member-facing language must match this exactly.
  coverage: "business_hours",
  // Pause the activating work, keep everything regulating. Crisis, SOS,
  // grounding, and check-ins are never gated on an alert.
  alertConsequence: "pause_processing",
  // Returning after a stop is a clinical decision, never an automatic one.
  reEntry: "clinician_decision",
  // Shadow: the engine computes and logs; the deterministic human-authored gate
  // chain still governs. Promotion needs its own evidence and rollback
  // authority (README §14.7).
  autonomous: "shadow",
  approved: false,
  approvedBy: null,
};

// ---------------------------------------------------------------------------
// Alternatives a reviewer can switch to
// ---------------------------------------------------------------------------

/** Named alternative configurations, so a reviewer can compare rather than
 *  imagine. These are demonstration variants; none is approved. */
export const POLICY_PRESETS: Record<string, Partial<ClinicalPolicy>> = {
  /** The T0/T1 default. */
  default: {},

  /** Maximum member privacy: the clinician never reads companion content, and
   *  acts only on coded signals. Tests whether the surface is still usable. */
  privacy_maximal: {
    companionVisibility: "never",
  },

  /** Full visibility within the caseload — what a clinician might ask for, and
   *  the configuration whose member-consent implications are heaviest. */
  clinician_maximal: {
    companionVisibility: "always",
    caseload: "pooled",
  },

  /** A staffed service: 24-hour coverage with automatic re-entry after a
   *  cooldown. Demonstrates what changes if the coverage promise changes. */
  staffed_24h: {
    coverage: "24_hour",
    reEntry: "timed",
  },

  /** The engine recommending rather than only logging. Still not governing —
   *  `active` is deliberately not offered as a preset. */
  engine_recommend: {
    autonomous: "recommend",
  },
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** The policy in force.
 *
 *  Selected by environment (`EMDR_CLINICAL_POLICY`), never by a request, a
 *  user, or a query string — a demonstration must not be able to drift into a
 *  configuration nobody chose, and a member must never be able to change the
 *  rules that govern their own care.
 *
 *  `active` autonomy is refused here regardless of configuration: promoting the
 *  engine to govern is gated on clinician sign-off conditions that have not been
 *  met (README §14.7), and a configuration file is not the place that decision
 *  gets made. */
export function activePolicy(): ClinicalPolicy {
  const name = process.env.EMDR_CLINICAL_POLICY ?? "default";
  const preset = POLICY_PRESETS[name];
  if (!preset) {
    throw new Error(
      `Unknown EMDR_CLINICAL_POLICY "${name}". Known presets: ${Object.keys(POLICY_PRESETS).join(", ")}`
    );
  }
  const resolved: ClinicalPolicy = { ...T1_DEFAULT_POLICY, ...preset };

  if (resolved.autonomous === "active") {
    throw new Error(
      "Clinical policy refused: autonomous mode 'active' cannot be selected by " +
      "configuration. Promoting the deterministic engine to govern member access " +
      "requires the clinician sign-off conditions in README §14.7 and a staged, " +
      "reversible flag flip — not an environment variable."
    );
  }
  return resolved;
}

/** One-line description of the policy in force, for display on any surface that
 *  depends on it. Handoff §2: a demo screen must not imply approval. */
export function policyBanner(p: ClinicalPolicy = activePolicy()): string {
  return (
    `Policy ${p.version} — companion: ${p.companionVisibility}, caseload: ${p.caseload}, ` +
    `coverage: ${p.coverage}, alert: ${p.alertConsequence}, re-entry: ${p.reEntry}, ` +
    `engine: ${p.autonomous}` +
    (p.approved ? ` (approved: ${p.approvedBy})` : " — PROVISIONAL, not clinically approved")
  );
}

/** The member-facing coverage sentence.
 *
 *  Derived from the policy rather than written separately, because the failure
 *  mode is a product that promises 24-hour monitoring while the rota is
 *  business hours. Handoff §6: "the member-facing coverage statement must match
 *  the configured operating schedule." */
export function coverageStatement(p: ClinicalPolicy = activePolicy()): string {
  switch (p.coverage) {
    case "none":
      return "No one reviews your entries in real time. Steady is not monitored, and it is not an emergency service. If you need help now, call or text 988, or call 911.";
    case "business_hours":
      return "A clinician reviews flagged entries during business hours. Steady is not monitored around the clock and is not an emergency service. If you need help now, call or text 988, or call 911.";
    case "extended":
      return "A clinician reviews flagged entries during extended hours. Steady is not monitored around the clock and is not an emergency service. If you need help now, call or text 988, or call 911.";
    case "24_hour":
      return "A clinician reviews flagged entries at any hour. Steady is still not an emergency service. If you are in immediate danger, call or text 988, or call 911.";
  }
}

/** Whether a clinician may see companion conversation content in this context. */
export function companionContentAllowed(
  context: "escalation" | "member_shared" | "routine",
  p: ClinicalPolicy = activePolicy()
): boolean {
  switch (p.companionVisibility) {
    case "never": return false;
    case "escalation_excerpt": return context === "escalation";
    case "member_shared": return context === "escalation" || context === "member_shared";
    case "always": return true;
  }
}
