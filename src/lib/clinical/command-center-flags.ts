// Command Center feature flags (expansion handoff 03, Appendix B).
//
// Six flags, and the rule Appendix B states about all of them: "turning off
// presentation does not delete signal, action, or evidence history." So every
// flag here gates a SURFACE or a computation, and none of them gates a write
// path that history depends on. A tenant that switches the Command Center off
// and on again finds the same signals, the same acknowledgements and the same
// care actions, because none of it was ever conditional on being visible.
//
// PHASE 1'S DEFINITION OF DONE IS THE REASON THESE EXIST AT ALL: "existing
// queue unchanged when feature is off." A flag that only hid a section would
// not satisfy that — the queue's ORDER, its counts and its grouping all have to
// be byte-identical with the flag off, which means the merge itself is behind
// the flag and not just the rendering of what it produced.
//
// Read at call time, never captured into a module constant. A flag read at
// module load cannot be turned off without a redeploy, and this codebase has
// already shipped that bug once.

export const COMMAND_CENTER_FLAGS = {
  /** The Today surface as the Command Center: four buckets, counts, filters. */
  CLINICAL_COMMAND_CENTER: "CLINICAL_COMMAND_CENTER",
  /** Durable non-safety attention signals: providers run and merge into the
   *  queue. Off means the queue is exactly what it was. */
  CLINICAL_ATTENTION_SIGNALS: "CLINICAL_ATTENTION_SIGNALS",
  /** The quick review drawer (Phase 3). */
  CLINICAL_COMMAND_CENTER_DRAWER: "CLINICAL_COMMAND_CENTER_DRAWER",
  /** The caseload clinical state table (Phase 4). */
  CLINICAL_COMMAND_CENTER_CASELOAD: "CLINICAL_COMMAND_CENTER_CASELOAD",
  /** The recent activity feed (Phase 4). */
  CLINICAL_COMMAND_CENTER_ACTIVITY: "CLINICAL_COMMAND_CENTER_ACTIVITY",
  /** The optional cross-system synthesis sentence (Phase 5). */
  CLINICAL_COMMAND_CENTER_AI_SUMMARY: "CLINICAL_COMMAND_CENTER_AI_SUMMARY",
} as const;

export type CommandCenterFlag = keyof typeof COMMAND_CENTER_FLAGS;
export const ALL_COMMAND_CENTER_FLAGS = Object.keys(COMMAND_CENTER_FLAGS) as CommandCenterFlag[];

/**
 * Flags that are ON in demo without being set.
 *
 * The rule this list follows is the one the Thoughts flags follow: a flag opens
 * a surface with something behind it. A flag over an unbuilt phase reads as
 * "this is broken" rather than "this is not finished yet", which is the worse
 * of the two messages to send a clinical reviewer.
 *
 * So a flag joins this set when its phase lands, and not before.
 */
const DEMO_ENABLED = new Set<CommandCenterFlag>([
  "CLINICAL_ATTENTION_SIGNALS",
  "CLINICAL_COMMAND_CENTER",
  // Joined when Phase 3 landed, on the same terms: the drawer now has a
  // command-context service behind it and six sections that either show
  // something or say why they cannot.
  "CLINICAL_COMMAND_CENTER_DRAWER",
]);

/**
 * What a later phase rests on.
 *
 * A drawer over signals nobody generates is a drawer with nothing in it, and
 * the AI summary over a row that does not exist is a sentence about nothing.
 * Checked rather than trusted, because a rollout is exactly the moment somebody
 * enables the interesting flag first.
 */
const REQUIRES: Partial<Record<CommandCenterFlag, CommandCenterFlag>> = {
  CLINICAL_COMMAND_CENTER: "CLINICAL_ATTENTION_SIGNALS",
  CLINICAL_COMMAND_CENTER_DRAWER: "CLINICAL_COMMAND_CENTER",
  CLINICAL_COMMAND_CENTER_CASELOAD: "CLINICAL_COMMAND_CENTER",
  CLINICAL_COMMAND_CENTER_ACTIVITY: "CLINICAL_COMMAND_CENTER",
  CLINICAL_COMMAND_CENTER_AI_SUMMARY: "CLINICAL_COMMAND_CENTER",
};

/** Off unless explicitly "1", except where demo enables it above. */
export function commandCenterFlagEnabled(flag: CommandCenterFlag): boolean {
  const set = process.env[COMMAND_CENTER_FLAGS[flag]];
  if (set === "0") return false;
  if (set === "1") return true;
  return process.env.EMDR_DEMO === "1" && DEMO_ENABLED.has(flag);
}

/** Whether a surface may render: its own flag AND everything it rests on. */
export function commandCenterSurfaceAvailable(flag: CommandCenterFlag): boolean {
  let current: CommandCenterFlag | undefined = flag;
  while (current) {
    if (!commandCenterFlagEnabled(current)) return false;
    current = REQUIRES[current];
  }
  return true;
}

/** What a flag rests on, for the screen that reports rollout state. */
export function commandCenterFlagRequires(flag: CommandCenterFlag): CommandCenterFlag | null {
  return REQUIRES[flag] ?? null;
}
