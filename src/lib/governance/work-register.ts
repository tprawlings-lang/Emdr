// One list of what is built, and what that claim rests on.
//
// THE PROBLEM IS DRIFT, NOT MEMORY. Old handoffs carry useful decisions and
// stale status sections, and the failure they produce is specific: somebody
// rebuilds a feature because an older paragraph says it is missing, or trusts
// one because an older paragraph says it landed. Four instances turned up in a
// single week —
//
//   - `requestUnlock` and `decideUnlock` existed, fully built, with tests, and
//     NO CALLER. Recorded as done, unreachable from any screen, found by
//     accident.
//   - A README section written days earlier made two claims about enrollment
//     that were false by the time anyone read them.
//   - A senior engineering handoff was 27 commits stale and its first listed
//     defect already looked fixed.
//   - Four dependabot pull requests still pointed at a branch that no longer
//     existed.
//
// SIX FIELDS, NOT FIFTEEN. A register with an owner, a dependency graph, a
// superseded-by chain and eight distinct states is a spreadsheet about the
// work rather than the work. What is needed is the smallest thing that can be
// checked mechanically: what it is, where its code is, where its test is, and
// how far the claim has actually been taken.
//
// THE POINT IS THE VERIFICATION, NOT THE LIST. A hand-maintained list drifts
// exactly like the paragraphs it replaces. `scripts/gen-work-register.ts`
// checks every entry against the source — the symbol exists, a test names it,
// and for anything claiming to be `reachable`, something other than its own
// module and its own tests refers to it. That last check is the one that would
// have caught the unlock gap, and it is the reason this file is worth having.

export type WorkState =
  /** Decided, not built. */
  | "proposed"
  /** Code exists. Nothing has demonstrated it works. */
  | "built"
  /** Code exists and a test exercises it. */
  | "tested"
  /** Tested AND referenced from outside its own module — a user can get to it.
   *  The strongest claim this register makes, and the only one that would have
   *  caught a fully built feature with no caller. */
  | "reachable"
  /** Deliberately not finished, with the reason on the entry. */
  | "held"
  /** Replaced. Kept so the next reader does not rebuild it. */
  | "superseded";

export interface WorkEntry {
  id: string;
  title: string;
  state: WorkState;
  /** `path/to/file.ts#exportedSymbol`. The symbol is what makes the
   *  reachability check possible: a path alone cannot tell you whether the
   *  thing at the end of it is used. */
  code: string | null;
  /** The test file that exercises it. */
  test: string | null;
  /** Why, for `held` and `superseded`; ignored otherwise. */
  note?: string;
}

/**
 * The register.
 *
 * Seeded with the work of the last week rather than back-filled across every
 * historical handoff: an entry nobody can verify is the drift this exists to
 * end, reproduced in a new file. It grows as work lands.
 */
export const WORK_REGISTER: WorkEntry[] = [
  {
    id: "auth.lockout",
    title: "Sign-in lockout counted once, consulted by both doors",
    state: "reachable",
    code: "src/lib/auth-lockout.ts#isLockedOut",
    test: "tests/auth-lockout.test.ts",
  },
  {
    id: "auth.pilot-password-reset",
    title: "An operator can set a pilot participant's password",
    state: "reachable",
    code: "src/lib/enrollment/pilot-access.ts#resetParticipantPassword",
    test: "tests/auth-lockout.test.ts",
  },
  {
    id: "ops.version-endpoint",
    title: "The deployment can say which build is answering",
    state: "reachable",
    code: "src/lib/version.ts#versionReport",
    test: "tests/version-endpoint.test.ts",
  },
  {
    id: "pilot.terms-versioning",
    title: "Permission follows the notice each participant accepted",
    state: "reachable",
    code: "src/lib/enrollment/pilot-terms.ts#pilotHandling",
    test: "tests/pilot-terms.test.ts",
  },
  {
    id: "pilot.re-consent",
    title: "Participants on the earlier notice are asked again",
    state: "reachable",
    code: "src/lib/enrollment/pilot-terms.ts#termsState",
    test: "tests/pilot-terms.test.ts",
  },
  {
    id: "clinical.notes",
    title: "A clinician can write, sign and amend a note",
    state: "reachable",
    code: "src/lib/clinical/notes.ts#signNote",
    test: "tests/clinical-notes.test.ts",
  },
  {
    id: "clinical.module-unlocks",
    title: "A member asks for a module; a clinician decides with a reason",
    // THE REGISTER FOUND THIS ONE ON ITS FIRST RUN: both screens called
    // `decideUnlock` and no test named it, so its two rules — a real decision,
    // and a reason the member can read — sat behind requireClinician where
    // nothing could reach them. They are `unlockDecisionRefusal` now.
    state: "reachable",
    code: "src/lib/clinical/unlock-rules.ts#unlockDecisionRefusal",
    test: "tests/concept-separation.test.ts",
  },
  {
    id: "experience.person-workspace",
    title: "A person record keeps the console's navigation and adds six local sections",
    // UX 002 in the 17 September handoff: "Patient pages replace global
    // navigation with abstract information layers." The manifest already
    // declared the local region and nothing rendered it, which is the state
    // this register exists to make visible — declared, tested, and not wired.
    state: "reachable",
    code: "src/lib/experience/navigation.ts#sectionFor",
    test: "tests/experience-contracts.test.ts",
    note: "Assigned support is the sixth section's fourth item and is not built; the Care screen says so in place rather than offering a control.",
  },
  {
    id: "experience.return-state",
    title: "A person record returns to the view the reader came from",
    state: "reachable",
    code: "src/lib/experience/return-to.ts#parseReturn",
    test: "tests/return-to.test.ts",
    note: "Origin and closed-set view filters are preserved; a free-text patient search and the selected person id deliberately are not.",
  },
  {
    id: "experience.legibility-floor",
    title: "Metadata on a clinical or member surface is readable, and versions are disclosed rather than printed",
    state: "reachable",
    code: "src/components/experience/EvidenceDetails.tsx#EvidenceDetails",
    test: "tests/evidence-details.test.tsx",
    note: "The reviewer console is out of scope and carries most of the remaining sub-12px and faded text; see experience.review-console-legibility.",
  },
  {
    id: "experience.review-console-legibility",
    title: "The reviewer console meets the same legibility floor as the clinical surfaces",
    state: "proposed",
    note: "About 30 sub-12px and faded uses across /review. A different audience and a different job, so it was scoped out of the first pass rather than swept blind.",
  },
  {
    id: "clinical.contact-vs-activity",
    title: "Contact and member activity are separate facts",
    state: "reachable",
    code: "src/lib/clinical/caseload.ts#buildCaseload",
    test: "tests/command-center-caseload.test.ts",
  },
  {
    id: "demo.daily-checkin-stability",
    title: "The demo's daily check-in does not re-date the dataset",
    state: "reachable",
    code: "src/lib/db.ts#refreshDemoDaily",
    test: "tests/demo-daily-checkin.test.ts",
  },
  {
    id: "demo.seeded-contact-notes",
    title: "The fabricated population has a contact history",
    // FOUND BY DRIVING THE FIX. Now that the contact column reads a signed
    // contact note rather than the member's own check-ins, every one of the
    // 240 fabricated profiles correctly reads "None recorded" — nobody has
    // ever contacted them, because the seed writes no contact notes. That is
    // true and it looks sparse, and a presenter could reasonably read the
    // empty column as a bug rather than as the honest answer.
    //
    // Seeding contact notes would make the demonstration both rich and true.
    // Filed rather than done: it is seed work, not a correctness fix, and the
    // column is right either way.
    state: "proposed",
    code: null,
    test: null,
  },
  {
    id: "governance.work-register-screen",
    title: "The work register, readable on a review screen",
    // The register's own unfinished business, in the register. Its consumer
    // today is the build; nobody can read it without opening a source file,
    // which is most of what makes a handoff paragraph go stale in the first
    // place.
    state: "proposed",
    code: null,
    test: null,
  },
  {
    id: "ops.backups",
    title: "Nightly encrypted off-site backups",
    state: "held",
    code: "src/lib/backup.ts#runBackup",
    test: null,
    note:
      "Built, unconfigured and UNTESTED — no test names `runBackup`, which the register found " +
      "on its first run. R2_* and BACKUP_AGE_RECIPIENT are unset, so nothing runs. A " +
      "whole-database snapshot cannot honour per-participant terms (README §15.6c).",
  },
  {
    id: "companion.model-backed-replies",
    title: "Companion replies from a model rather than the rules engine",
    state: "held",
    code: "src/lib/ai-gateway/index.ts#invoke",
    test: "tests/ai-gateway.test.ts",
    note: "ANTHROPIC_API_KEY is unset by decision; the deterministic rules engine answers instead.",
  },
];
