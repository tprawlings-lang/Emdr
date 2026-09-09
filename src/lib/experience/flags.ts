// Role-level experience flags (handoff 09 §10.1, Package 2).
//
// §10.1: "Keep new work behind role-level flags and prove the current
// experience is unchanged with each flag off."
//
// PER ROLE, NOT PER FEATURE, and that is the difference from the Command
// Center flags in command-center-flags.ts. Those gate individual surfaces
// within one workspace. These gate the SHELL — the sidebar, the row shape, the
// panel, the action separation — for one audience at a time, because §10's
// sequence rebuilds one role per package and each has to be able to ship
// without waiting for the others.
//
// WHAT A FLAG HERE DOES NOT GATE. No flag in this file changes what a person
// may see, what the queue's order is, or what a command does. §10's Package 2
// exit evidence includes "authorization and queue authority unchanged", and the
// way to keep that true is for the flag to reach only the presentation: the
// same projection, the same server-side ordering, the same guards, rendered
// differently.
//
// Read at call time, never captured into a module constant — the same rule the
// Command Center flags follow, and for the same reason: a flag read at module
// load cannot be turned off without a redeploy, and this codebase has shipped
// that bug once already.

export const EXPERIENCE_FLAGS = {
  /** Package 2: the clinician shell. Navigation from the manifest, scannable
   *  rows, the evidence panel, and separated actions. */
  EXPERIENCE_CLINICIAN_SHELL: "EXPERIENCE_CLINICIAN_SHELL",
  /** Package 3: the member activity shell, the support dock and the paced
   *  gate. Declared here so the sequence is visible; not built. */
  EXPERIENCE_MEMBER_SHELL: "EXPERIENCE_MEMBER_SHELL",
  /** Package 5: the aggregate scope strip and evidence flow. Not built. */
  EXPERIENCE_AGGREGATE_SHELL: "EXPERIENCE_AGGREGATE_SHELL",
  /** Package 6: the reviewer decision flow. Not built. */
  EXPERIENCE_REVIEWER_SHELL: "EXPERIENCE_REVIEWER_SHELL",
} as const;

export type ExperienceFlag = keyof typeof EXPERIENCE_FLAGS;
export const ALL_EXPERIENCE_FLAGS = Object.keys(EXPERIENCE_FLAGS) as ExperienceFlag[];

/**
 * Flags that are ON in a demonstration environment without being set.
 *
 * The rule the other flag modules follow: a flag joins this set when its
 * package LANDS, and not before. A flag over an unbuilt shell reads as "this is
 * broken" rather than "this is not finished yet", which is the worse of the two
 * messages to send a clinical reviewer.
 */
const DEMO_ENABLED = new Set<ExperienceFlag>([
  // Package 2 landed. The other three are declared above and deliberately
  // absent from this set.
  "EXPERIENCE_CLINICIAN_SHELL",
]);

function demoMode(): boolean {
  return process.env.EMDR_DEMO === "1";
}

/**
 * Whether one shell is on.
 *
 * An explicit environment variable wins over the demo default in both
 * directions, so a reviewer can turn the new clinician shell OFF in a demo
 * environment and see the old one — which is how §10's "prove the current
 * experience is unchanged with each flag off" gets checked by a person rather
 * than only by a test.
 */
export function experienceFlagEnabled(flag: ExperienceFlag): boolean {
  const explicit = process.env[`EMDR_${flag}`];
  if (explicit === "1" || explicit === "true") return true;
  if (explicit === "0" || explicit === "false") return false;
  return demoMode() && DEMO_ENABLED.has(flag);
}

/** The clinician shell, asked by name so a call site reads as what it means. */
export function clinicianShellEnabled(): boolean {
  return experienceFlagEnabled("EXPERIENCE_CLINICIAN_SHELL");
}
