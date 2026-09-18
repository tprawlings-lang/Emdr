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
 *  Threads joined when Phase 3 landed, Session Prep when Phase 4 did, Ask
 *  Steady at Phase 5 and the note bridge at Phase 6, on the same terms each
 *  time. All six are built; none is a flag over an empty surface.
 *
 *  `EMDR_..._CAPTURE=0` forces it off even in demo, which is how the refusal
 *  path gets demonstrated — and turning EXTRACTION off while CAPTURE stays on
 *  is how the transcript-only path gets demonstrated, which is a real state
 *  (§8.1's review_transcript_only) and not merely a switch. */
const DEMO_ENABLED: ReadonlySet<ThoughtsFlag> = new Set([
  "CLINICIAN_THOUGHTS_CAPTURE",
  "CLINICIAN_THOUGHTS_EXTRACTION",
  "CLINICIAN_THREADS",
  "CLINICIAN_SESSION_PREP",
  // Ask Steady joined when Phase 5 landed, on the same terms as the four above:
  // the surface has retrieval, an answer with its sources, and the
  // conflicting-evidence behaviour §12 requires.
  "CLINICIAN_PATIENT_ASK",
  // The note bridge joined when Phase 6 landed. It has the three things that
  // phase's definition of done asks for: a draft that cannot sign itself,
  // nothing reaching it that a clinician did not select from approved items,
  // and no stored state at all — so switching this off removes a screen and
  // loses nothing, which is the "disabled per tenant without data loss" rule
  // answered rather than promised.
  "CLINICIAN_NOTE_BRIDGE",
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

/**
 * What each surface is, in a clinician's words, and where it appears.
 *
 * UX 005: "Thoughts contains stale future-phase copy beside working functions.
 * Remove implementation commentary and standardize product terms. Acceptance:
 * no contradictory capability claims remain."
 *
 * The defect was a paragraph at the foot of the Thoughts page reading "Session
 * preparation and patient-scoped questions are built in later phases" — with
 * the patient-scoped question box rendered four hundred pixels above it and
 * session preparation on the record overview one click away. Both had shipped;
 * the sentence had not been read since they did.
 *
 * SO THE CLAIM IS DERIVED RATHER THAN WRITTEN. What a screen says about a
 * capability now comes from the same function that decides whether to render
 * it, which makes the two impossible to disagree. Prose can go stale; a value
 * read from `thoughtsSurfaceAvailable` cannot.
 *
 * `where` is a route or a place on a screen, because "this exists" is not the
 * useful half of the sentence — a clinician reading that patient-scoped
 * questions are available wants to know they are in the box at the top of this
 * page.
 */
export interface ThoughtsSurface {
  /** What a clinician calls it. Never the flag, never the phase number. */
  name: string;
  /** What it does, in one line. */
  does: string;
  /** Where to find it. */
  where: string;
}

export const THOUGHTS_SURFACE: Record<ThoughtsFlag, ThoughtsSurface> = {
  CLINICIAN_THOUGHTS_CAPTURE: {
    name: "Recording and transcript",
    does: "Say what you noticed; check what Steady heard before anything is kept.",
    where: "On this page, above the recorded list.",
  },
  CLINICIAN_THOUGHTS_EXTRACTION: {
    name: "Kept items",
    does: "Turn what you said into items you decided were true, each keeping its source.",
    where: "On this page, under Kept items.",
  },
  CLINICIAN_THREADS: {
    name: "Themes",
    does: "Name something that keeps coming up and gather the entries under it.",
    where: "On this page, under Themes on this record.",
  },
  CLINICIAN_SESSION_PREP: {
    name: "Session preparation",
    does: "A brief before a session, every line tied to the evidence it came from.",
    where: "On the record overview.",
  },
  CLINICIAN_PATIENT_ASK: {
    name: "Patient-scoped questions",
    does: "Ask about this person's record and get an answer with its sources.",
    where: "On this page, in the box at the top.",
  },
  CLINICIAN_NOTE_BRIDGE: {
    name: "Note draft",
    does: "Build a draft from approved items you choose. Steady cannot sign it.",
    where: "Build a note draft, linked from this page.",
  },
};

/** Every surface with whether it is available here — one answer per capability,
 *  from the function that decides whether it renders. */
export function thoughtsCapabilities(): Array<ThoughtsSurface & {
  flag: ThoughtsFlag; available: boolean;
}> {
  return THOUGHTS_FLAGS.map((flag) => ({
    flag, ...THOUGHTS_SURFACE[flag], available: thoughtsSurfaceAvailable(flag),
  }));
}

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
