// Safety findings that were open and are now closed, with the date and the
// test that fails if each reopens. Read by /review/status (Handoff 10 P0 asks
// for its finding to be listed there as resolved, with the date; the Expansion
// Handoff's Phase 0 findings belong on the same list for the same reason).
//
// A finding is on this list only with a test. "Fixed" without one is a claim.

export interface ResolvedFinding {
  id: string;
  /** What was wrong, in words a reviewer can check against the product. */
  finding: string;
  /** What is true now. */
  now: string;
  resolvedOn: string;
  /** The test that fails if it reopens. */
  test: string;
  /** Where it was raised. */
  source: string;
  /** Set while a clinician still has to confirm the fix's wording. */
  awaitingConfirmation?: string;
}

export const RESOLVED_FINDINGS: ResolvedFinding[] = [
  {
    id: "kb.butterfly-hug-was-self-administered-bls",
    finding:
      "The companion could offer the Butterfly Hug — arms crossed, slow alternating taps — to members as activated as 8 out of 10. That is self-administered bilateral stimulation, which v1 does not do.",
    now:
      "Replaced by a still self-hold with no tapping or rhythm, and a check fails if any knowledge-base entry, practice or lesson grows a bilateral shape back.",
    resolvedOn: "2026-09-24",
    test: "tests/kb-no-bls-shape.test.ts",
    source: "Handoff 10, P0",
    awaitingConfirmation: "KB_SELF_HOLD_REPLACES_BUTTERFLY",
  },
  {
    id: "phase0.companion-write-access",
    finding: "The companion's tools could write a person's trigger map, including lowering how intense a trigger was rated.",
    now: "The companion suggests; the person accepts, with a rating they give it themselves.",
    resolvedOn: "2026-09-24",
    test: "tests/companion-boundary.test.ts",
    source: "Expansion Handoff, Phase 0",
  },
  {
    id: "phase0.session-termination",
    finding: "An ended session could be ended again as something calmer, the browser decided whether it was a hard stop, and sessions nobody closed stayed open forever.",
    now: "The first close wins, the server reads the ending off the ratings, and anything left open is closed when the next session starts.",
    resolvedOn: "2026-09-24",
    test: "tests/session-termination.test.ts",
    source: "Expansion Handoff, Phase 0",
  },
  {
    id: "phase0.screener-retake",
    finding: "The program-fit questions could be answered again during a pause, or a day later, to lift stops only a person may lift; questionnaires could be retaken any number of times.",
    now: "Answers in force are not replaced, some stops wait for a documented review, and no questionnaire is given again inside the time it asks about.",
    resolvedOn: "2026-09-24",
    test: "tests/fitness-retake.test.ts",
    source: "Expansion Handoff, Phase 0",
  },
  {
    id: "phase0.choice-at-high-distress",
    finding: "After a distress pause, 'continue' was offered without asking how the member was now.",
    now: "Continue waits for a fresh rating the in-session rule lets through.",
    resolvedOn: "2026-09-24",
    test: "tests/distress-choice.test.ts",
    source: "Expansion Handoff, Phase 0",
  },
  {
    id: "phase0.clinical-labels",
    finding: "Members saw questionnaire names, a path called 'PTSD & Trauma', and — on the referral page — their scores.",
    now: "Members read plain names; a rendered walk of every member screen fails on a clinical label.",
    resolvedOn: "2026-09-24",
    test: "tests/member-boundary.test.ts",
    source: "Expansion Handoff, Phase 0",
  },
];
