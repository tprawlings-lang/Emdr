// Feature flags for the clinician thinking layer (§22).
//
// Phase 0's definition of done asks only that these NAMES EXIST, and that is
// deliberate: §22 says a disabled downstream surface must not appear merely
// because data for it exists, which is a property you can only hold if the
// surface checks a flag from the day it is written rather than acquiring one
// later.
//
// TENANT-AWARENESS IS NOT HERE, AND THE SPEC ALLOWS THAT. §22 asks for flags
// "tenant-aware where the current feature-flag system allows it". This
// repository has no feature-flag system — it has environment variables — so
// these are environment-scoped and the functions take no tenant. That is stated
// rather than smoothed over: a `tenantId` parameter this ignored would read as
// tenant-aware to the next person, and a lie in a security surface is worse
// than a stated limit.
//
// §22's last rule shapes the schema rather than this file: "a flag change must
// not delete or rewrite previously stored patient history." Nothing here
// writes, and nothing downstream may treat a disabled flag as permission to
// clean up.

const FLAGS = {
  /** Recording, upload, transcription and the Thoughts history. Phase 1. */
  CLINICIAN_THOUGHTS_CAPTURE: "CLINICIAN_THOUGHTS_CAPTURE",
  /** Turning a transcript into candidate memory items. Phase 2. */
  CLINICIAN_THOUGHTS_EXTRACTION: "CLINICIAN_THOUGHTS_EXTRACTION",
  /** Longitudinal threads and their membership decisions. Phase 3. */
  CLINICIAN_THREADS: "CLINICIAN_THREADS",
  /** The evidence-bound pre-session brief. Phase 4. */
  CLINICIAN_SESSION_PREP: "CLINICIAN_SESSION_PREP",
  /** Patient-scoped retrieval and answers. Phase 5. */
  CLINICIAN_PATIENT_ASK: "CLINICIAN_PATIENT_ASK",
  /** Approved items feeding a formal note draft. Phase 6. */
  CLINICIAN_NOTE_BRIDGE: "CLINICIAN_NOTE_BRIDGE",
} as const;

export type ThoughtsFlag = keyof typeof FLAGS;
export const THOUGHTS_FLAGS = Object.keys(FLAGS) as ThoughtsFlag[];

/** Flags that are ON in demo without being set.
 *
 *  CAPTURE ONLY, and the reason is the one that turned on resourcing BLS in
 *  demo: a reviewer who cannot run the workflow cannot give feedback on it, and
 *  unusable-by-default is not a safety property when the data is fabricated.
 *  Phase 1 shipped a recorder, a transcript and a review screen; leaving it dark
 *  in the one environment built for clinical review would make the flagship
 *  workstream the single thing a clinical reviewer cannot exercise.
 *
 *  EXTRACTION JOINED IT WHEN IT WAS BUILT, not before. The rule this list
 *  follows is that a flag opens a surface with something behind it: a flag over
 *  an unbuilt phase reads as "this is broken" rather than "this is not finished
 *  yet", which is the worse of the two messages to send a reviewer. Phase 2 now
 *  has an extractor, a contract that refuses what §9.2 forbids, candidate items
 *  and an atomic save, so the surface has something to show.
 *
 *  The phases after it are still absent, for the same reason they always were.
 *
 *  `EMDR_..._CAPTURE=0` forces it off even in demo, which is how the refusal
 *  path gets demonstrated — and turning EXTRACTION off while CAPTURE stays on
 *  is how the transcript-only path gets demonstrated, which is a real state
 *  (§8.1's review_transcript_only) and not merely a switch. */
const DEMO_ENABLED: ReadonlySet<ThoughtsFlag> = new Set([
  "CLINICIAN_THOUGHTS_CAPTURE",
  "CLINICIAN_THOUGHTS_EXTRACTION",
]);

/** Off unless explicitly set to "1", except where demo enables it above.
 *
 *  Read at call time, never captured into a module-level constant. A flag read
 *  at module load cannot be turned off without a redeploy, and this codebase
 *  has already shipped that bug once. */
export function thoughtsFlagEnabled(flag: ThoughtsFlag): boolean {
  const set = process.env[FLAGS[flag]];
  if (set === "0") return false;
  if (set === "1") return true;
  return process.env.EMDR_DEMO === "1" && DEMO_ENABLED.has(flag);
}

/** The phase order §24 requires be worked in. A later phase's surface must not
 *  open while an earlier one is closed: Session Prep over memory nobody has
 *  approved, or a thread over thoughts nobody can record, is a screen with
 *  nothing behind it. Checked rather than trusted, because a rollout is exactly
 *  the moment somebody enables the interesting flag first. */
const REQUIRES: Partial<Record<ThoughtsFlag, ThoughtsFlag>> = {
  CLINICIAN_THOUGHTS_EXTRACTION: "CLINICIAN_THOUGHTS_CAPTURE",
  CLINICIAN_THREADS: "CLINICIAN_THOUGHTS_EXTRACTION",
  CLINICIAN_SESSION_PREP: "CLINICIAN_THOUGHTS_EXTRACTION",
  CLINICIAN_PATIENT_ASK: "CLINICIAN_THOUGHTS_EXTRACTION",
  CLINICIAN_NOTE_BRIDGE: "CLINICIAN_THOUGHTS_EXTRACTION",
};

/** Whether a surface may render: its own flag AND everything it rests on. */
export function thoughtsSurfaceAvailable(flag: ThoughtsFlag): boolean {
  let current: ThoughtsFlag | undefined = flag;
  while (current) {
    if (!thoughtsFlagEnabled(current)) return false;
    current = REQUIRES[current];
  }
  return true;
}

/** What a flag rests on, for the screen that reports rollout state. */
export function thoughtsFlagRequires(flag: ThoughtsFlag): ThoughtsFlag | null {
  return REQUIRES[flag] ?? null;
}

// ── Audio retention (Phase 0: "decide audio retention defaults") ────────────
//
// THE DEFAULT IS DELETION, in demo and in production alike, and the reasoning
// is worth stating because the schema column's own default (`org_default`) is a
// pointer rather than a policy.
//
// A recording of a clinician talking about a patient after a session is the
// most sensitive artifact this product would hold: unstructured, containing
// whatever they happened to say, and — unlike a transcript — reviewed by nobody.
// §13 requires retention to be an org policy and deletion to be recorded rather
// than claimed. What it does not say is what happens when an org has not
// chosen, and "keep it" is the wrong answer to that question: it means an
// organization acquires an audio archive by never making a decision.
//
// So the default keeps audio until a transcript is verified, then deletes it
// and records the deletion. An org that wants retention has to say so.
export type AudioRetention =
  /** Delete once a verified transcript exists. The default. */
  | "delete_after_verified_transcript"
  /** Keep for a stated number of days, then delete. */
  | "bounded"
  /** Keep until an authorized process removes it. Never a default. */
  | "retain";

export const DEFAULT_AUDIO_RETENTION: AudioRetention = "delete_after_verified_transcript";

/** Demo holds no real recordings, and its default is the same rather than
 *  looser — a demo whose retention differs from production teaches a reviewer
 *  the wrong thing about the product they are reviewing. */
export const DEMO_AUDIO_RETENTION: AudioRetention = "delete_after_verified_transcript";
