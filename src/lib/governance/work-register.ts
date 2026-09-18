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
    // Stated as null rather than omitted: the type makes both keys required
    // and nullable, so "there is no code yet" is something an author writes
    // down rather than something a reader infers from a missing field.
    code: null,
    test: null,
    note: "About 30 sub-12px and faded uses across /review. A different audience and a different job, so it was scoped out of the first pass rather than swept blind.",
  },
  {
    id: "experience.page-templates",
    title: "The handoff's three page templates, with the layout rules in the types",
    // The rules were already written down and were being broken by people who
    // had read them, which is what UX 010 reports. One primary action is one
    // optional object; a due date carries the policy that created it;
    // limitations will not compile away; the evidence slot must be answered
    // rather than omitted; prose is measured and work is not.
    state: "reachable",
    code: "src/components/experience/templates.tsx#AnalysisReview",
    test: "tests/page-templates.test.tsx",
    note: "Applied to Care (PersonSummary), Recovery trajectory (AnalysisReview) and Module requests (WorkList). Command Center still renders its own work-list shape; see experience.command-center-template.",
  },
  {
    id: "experience.command-center-template",
    title: "Command Center renders through the work-list template",
    state: "proposed",
    code: null,
    test: null,
    note: "ClinicianHomeView carries its own scope strip, rows, evidence panel and result. Moving it onto WorkList is a real refactor of the busiest clinician screen rather than a wrapper, so it was not folded into the template's first pass.",
  },
  {
    id: "clinical.display-vocabulary",
    title: "Clinician-facing words replace raw event keys, with the raw key retained",
    // UX 009. The audit column rendered `e.type.replace(/_/g, " ")`, which is
    // the identifier with its punctuation changed — it reads as English and
    // means nothing a clinician would say.
    state: "reachable",
    code: "src/lib/clinical/event-vocabulary.ts#displayTermFor",
    test: "tests/clinical-approval.test.ts",
    note: "86 terms, approved as written on 2026-09-17 by Rebecca Altschuler, PhD (AZ PSY-005804) and John Allen, PhD (AZ PSY-002055), with no conditions. The signature is bound to content hash 853445054e58…; the signed form is in docs/approvals and the record names it by its own SHA-256. One reworded note and checkApproval() fails rather than the approval following the words.",
  },
  {
    id: "governance.clinical-approval-binding",
    title: "A clinical approval is bound to a hash of the exact words it was given for",
    state: "reachable",
    code: "src/lib/governance/clinical-approval.ts#checkApproval",
    test: "tests/clinical-approval.test.ts",
    note: "Changing one word or one note invalidates the sign-off rather than inheriting it. The stored document at docs/approvals/ is generated from the same source, so the document and the product cannot disagree.",
  },
  {
    id: "experience.progressive-disclosure",
    title: "The technical essays on console screens fold; the claims they carry stay visible",
    // UX 010: "Large explanation blocks and narrow columns bury working
    // content." Measured rather than guessed — the first version of the
    // measurement read container rects and reported 1215 words above an
    // element at y=193, which is impossible; measured on the text nodes the
    // offenders were the console screens, not the person record.
    // Stated as `tested` rather than `reachable`: the RULE is a module with a
    // test, and what a clinician reaches is the screens it governs. Claiming
    // reachable would need something outside this module and the tests to call
    // it, and nothing does — the screens obey the rule, they do not import it.
    state: "tested",
    code: "src/lib/experience/disclosure.ts#essaysInFrontOfWork",
    test: "tests/design-consistency.test.ts",
    note: "Handoffs 813px to 602px before the first action, unlocks 559 to 465, caseload 628 to 599. The summary of each disclosure keeps the sentence that must not be missed.",
  },
  {
    id: "experience.queue-paging",
    title: "The control offering the rest of the queue shows the rest of the queue",
    // UX 001. The projection was right all along — it capped the page and
    // reported the whole total. The control built its own href, and the cap
    // applies only when no bucket is showing, so both its branches resolved to
    // the page the reader was already on.
    state: "reachable",
    code: "src/lib/experience/return-to.ts#rememberable",
    test: "tests/clinician-shell.test.ts",
    note: "An explicit full-list state rather than cursor paging: ?rows=all, same server order, total unchanged, and a way back. The wire between the link and the page is covered end to end, because a unit mutation that made the page ignore the parameter survived every unit test.",
  },
  {
    id: "clinical.measures-separated-and-dated",
    title: "Validated instruments and house observations are separate figures, and each series says how current it is",
    // 17 September handoff, P4: "Separate validated instruments from custom
    // function observations. Scale, direction, window, and missingness are
    // explicit." Scale, direction and window already were; the other two were
    // not.
    state: "reachable",
    code: "src/lib/measures/coverage.ts#seriesCoverage",
    test: "tests/measure-coverage.test.tsx",
    note: "The house measure was drawn inside a figure titled 'Validated measures over time' while carrying a panel note saying it had no validation to borrow — the panel disclaiming the authority its own frame granted it. Two figures now, on one shared window so the dates still line up. Missingness is the end gap only: the panel already prints the count and the first and latest reading, and the first version of the coverage list repeated all of it, which was obvious on the rendered screen and invisible in the source. What no panel can show is the distance from the last reading to today — a series that stopped in March and one that stopped last week are drawn identically from their own edge.",
  },
  {
    id: "buyer.opening-questions",
    title: "The organization and payer consoles open with the questions they are for, each answer tracing to its denominator",
    // 17 September handoff, P5: "These pages should begin with decisions and
    // work, not a collection of charts." Acceptance: "users can answer each
    // opening question and trace figures to denominator, window, missingness,
    // and definition."
    state: "reachable",
    code: "src/lib/buyer/opening-questions.ts#assertTraceable",
    test: "tests/opening-questions.test.tsx",
    note: "The consoles were not wrong; they were unasked. The organization overview already carried a denominator on every figure and a funnel with its largest drop marked, and a reader wanting to know where access is delayed still had to open three charts on three tabs and do the joining. Each answer is a record now — the sentence, the figure with its denominator, and the four things that must be traceable from it — and `assertTraceable` refuses one missing any of them, so a console cannot ship a confident sentence over a number nobody can take apart. A question nobody can answer keeps its place in the same shape, because a console that drops one looks like a console that was never asked it. And the reason comes from the projection: my first version told the reader that no site had enough waiting people to report without identifying them, which is a plausible sentence about small-cell suppression and was wrong — the projection returns partial with demand for four sites and no supply at all, because the scheduling system has no slot record. A console that invents why it cannot answer is worse than one that does not answer, because the invented reason is what somebody acts on. The payer's four are ordered as they depend on each other — eligibility fixes the denominator, participation is counted against it, measurement says which contract terms could be computed at all, and maturity says whether any of it should be quoted yet. Two more things the rendered page showed: a fall reported AT the stage it had just counted (\"68% started care, and the largest fall is at started care\"), which names a transition now; and a contract row id printed at a plan executive, which is the buyer-side version of the policy version the member's Today was showing.",
  },
  {
    id: "governance.evidence-registry",
    title: "Every public claim comes from one governed registry, and an expired one stops rendering",
    // 17 September handoff, P5: "Generate every public claim and count from one
    // governed evidence registry. Do not maintain separate numbers in page
    // copy." The finding it answers is somebody else's — public counts varying
    // between pages — and it lands squarely here.
    state: "reachable",
    code: "src/lib/governance/evidence-registry.ts#resolveClaim",
    test: "tests/evidence-registry.test.ts",
    note: "The public evidence page carried claims as three fields — claim, support, runnable — with counts written into the prose: \"eighteen isolation cases and twelve transaction cases\", right when typed and checked by nobody, wrong the moment somebody adds a test. A claim is a record now: what product and version it is about, which population, what kind of evidence, what it cannot support, which surfaces may show it, who approved it and when that lapses. Resolution fails closed on every branch — unapproved, expired, wrong surface, no limitation stated — because rendering a lapsed claim is the harm and a missing sentence is an inconvenience. A count lives in a field with the file it comes from, and a guard counts the file. Two types were added to the handoff's four and both say why: software_verification, because calling a passing suite \"product telemetry\" would describe a test run as operational data about real use; and absence_of_evidence, because the page rendered \"Published research · about Steady\" over the sentence \"that evidence does not transfer to Steady\". EVIDENCE_NEEDED stayed ungoverned on purpose: an approval that can expire would, on expiry, remove a gap from a public page.",
  },
  {
    id: "member.today-work-contract",
    title: "The member's Today says what is asked of them, by whom, and what doing it shares",
    // 17 September handoff, P5: the Today contract's eight states, each with a
    // required presentation and exactly one primary action.
    state: "reachable",
    code: "src/lib/member/today-work.ts#todayWorkState",
    test: "tests/today-work.test.tsx",
    note: "The day already had a state — open, narrow, stabilizing, paused, crisis, interrupted, service_unavailable — answering how much can be done today. The handoff asks a different question: what is the next thing, where did it come from, and what does doing it share. The two states that matter most were indistinguishable: a module a clinician asked for and a module the day shape surfaced were the same card, in the same place, with the same words. Four of the five facts required beside an assigned item are about trust rather than the activity — who asked, why, what it shares, until when — and none was on the screen. Three things the rendered page then showed: the sharing rule printed as \"clinical-policy-2026-08-t1\", a policy identifier where a person expected a sentence and one the handoff rules out by name; the same activity offered twice with two framings and two start buttons, the weaker framing louder; and two durations for one activity, because two catalogues disagree about how long several modules take. `write_uncertain` is modelled and unreachable — nothing stores an unreconciled command — and PENDING_WRITE_TRACKED is the one line to change.",
  },
  {
    id: "clinical.thought-lifecycle",
    title: "The Thoughts page says which of the four states a piece of thinking is in, and who can read it",
    // 17 September handoff, P4: "Thoughts — separate capture, review, approved
    // memory, and Ask. User knows what is private, proposed, approved, or
    // filed."
    state: "reachable",
    code: "src/lib/clinical/thought-lifecycle.ts#THOUGHT_LIFECYCLE",
    test: "tests/thought-lifecycle.test.tsx",
    note: "The surfaces were already separate — a recorder, a transcript list, kept items, themes and Ask each in their own panel. What the page never said in one place is which STATE a given piece of thinking is in and who can read it: that answer was spread across five footnotes down a long page, each true about its own corner, together a state machine nobody had written down. The fourth state is one this product cannot observe — a note draft is assembled on the way to a screen, stored nowhere, and copied out as text, so nothing reports back that it was filed and an item filed last week looks exactly like one that never left the page. It is listed and marked \"Steady cannot tell you this\" rather than dropped (which would let a reader assume three states are all there are) or badged (which would be a claim nobody checked). Rejected and superseded are deliberately not states: they are things that happened to an item, not places it sits.",
  },
  {
    id: "clinical.draft-note-source-availability",
    title: "The note draft says where items come from, separately from what was ticked",
    // 17 September handoff, P4: "Draft note — model source availability and
    // user selection separately. Empty copy states the actual cause."
    state: "reachable",
    code: "src/lib/clinical/note-bridge.ts#draftSource",
    test: "tests/note-bridge.test.ts",
    note: "The selection half landed with UX 006: the assembler computes whether nothing existed, nothing was ticked, or everything ticked was refused, because one sentence for all three was false in two of them. The SOURCE half was still one sentence — with nothing approved the screen said \"approve items on Thoughts and they become selectable here\", which is advice nobody can follow in three environments. With capture off there is nothing to record; with extraction off a recording produces a transcript and no candidate items; with no model configured neither runs. In each of those a clinician goes to Thoughts, finds no way to approve anything, and concludes the product is broken — when what is true is that this deployment does not have the source switched on. The four states say four different things, and only the working one offers a next step.",
  },
  {
    id: "clinical.plan-review-beside-the-plan",
    title: "The care plan carries the one review action it permits, bound to the version on screen",
    // 17 September handoff, P4: "Care plan — place the permitted review action
    // beside the plan. User does not hunt through the full record."
    state: "reachable",
    code: "src/lib/clinical/plan-review.ts#planReviewStanding",
    test: "tests/plan-review.test.tsx",
    note: "The screen ended with \"approve or correct it on the full record, where the action is audited\" — the hunt, written down — and it pointed at the wrong control: the approval on the record page is about the generated SUMMARY, a different artefact resting on different evidence, so a clinician who followed the instruction would have attested to something they were not looking at. The plan's own review is its own subject, recorded beside the plan, with the three things it does not do printed next to it rather than inferred from the absence of other buttons. The plan's generated-at travels with the approval and runs through the same currency policy the queue uses, so a plan regenerated afterwards makes the review out of date instead of silently inheriting it. `approve` gained an optional evidence version for this: the completion semantics ask for \"the reviewed evidence version\", and event ids cannot carry it for something regenerated rather than appended.",
  },
  {
    id: "clinical.session-sequence-provenance",
    title: "A session's events carry the time they happened and the record they came from",
    // 17 September handoff, P4: "Session detail — order events and connect
    // notes to their sources. Timeline and provenance are understandable."
    state: "reachable",
    code: "src/lib/clinical/session-detail.ts#sessionEvents",
    test: "tests/session-detail.test.ts",
    note: "Three of the sequence's lines had no recorded time of their own and borrowed the session's start, rendered in a monospace clock column beside lines that really did happen then — so a reader counting down that column saw the highest reading occurring in the first minute. They are undated now, and the gap is stated rather than filled. The check written after the session was not on the page at all, though it is a separate row with a real timestamp and, on a screen called Session response, arguably the response. And every line names its source: a reading somebody typed, a check written hours later and a fixed safety rule are three kinds of fact that read identically as sentences. The notes already attached to this session are listed on it — the page offered a recorder and then linked to \"all notes for this person\", which is the hunt through the record this screen exists to end.",
  },
  {
    id: "clinical.overview-goals-and-last-session",
    title: "The person overview answers goals and the last session, and the sessions list carries the outcome",
    // 17 September handoff, P4: "Patient overview — summarize changes,
    // restrictions, work, goals, and recent session. Next work is clear
    // without opening many pages."
    state: "reachable",
    code: "src/lib/clinical/recent-session.ts#recentSession",
    test: "tests/recent-session.test.tsx",
    note: "Four of the five were on it. The goals card was gated on having goals, so a person with none got no goals section at all — which reads as \"this product does not track goals\" rather than \"nobody has set one\", and the card's empty state, which offers to add one, had never been reachable. The last session was on no card: the engagement strip counts session DAYS (\"0 carry a session\"), a different fact that reads as the same one on a page where every other panel covers three weeks. The card names the module, how long ago, and how it ended — a stop is \"stopped early\" with its reason, never \"incomplete\", because a session that ended when somebody decided to end it is the safety system working. A missing close reading is unknown rather than no change, and a session with no readings at all is not 0 to 0. The same three functions now describe a session on the list, the detail and the card, so the three cannot word the same fact differently — and the caveat about what a pair of readings is not moved out of the per-row line into a constant a surface prints once, because twenty copies down a list is how a sentence worth reading becomes one nobody sees.",
  },
  {
    id: "clinical.note-signing-confirmed",
    title: "Signing a note is confirmed against the words on screen, and no draft is written over silently",
    // 17 September handoff, P4: "Signed notes — clarify draft, signing, and
    // amendment. No silent overwrite; signing has explicit confirmation."
    state: "reachable",
    code: "src/lib/clinical/notes.ts#draftVersion",
    test: "tests/clinical-notes.test.ts",
    note: "\"Sign and file\" saved and signed in one post, so the only irreversible act on the screen — a signed note is immutable by trigger, and the only remedy is an amendment that stays in the record for ever — was the only one that happened without being confirmed. It now saves first (nothing typed is at risk) and shows the exact words, the kind, the person and the signatory before the signature. A draft save was an unconditional UPDATE, so a second tab replaced whatever had been written with no trace: a stale save now forks into a separate draft rather than overwriting or refusing, because a refusal costs the clinician what they typed and an overwrite costs somebody else what they typed. The version is a hash of the words rather than updated_at — the stamp has one-second granularity, so two saves in the same second carried the same version and sailed through the check. And the editor no longer opens a drafted amendment as \"your draft\", which used to let an unrelated note replace a correction while still pointing at the note it claimed to correct.",
  },
  {
    id: "clinical.trajectory-findings-first",
    title: "The trajectory page leads with which domain reached which state, and explains below",
    // 17 September handoff, P4: "Trajectory — put findings first and technical
    // explanation later. Descriptive status cannot be mistaken for a forecast."
    state: "reachable",
    code: "src/components/clinical/RecoveryTrajectoryCard.tsx#RecoveryTrajectoryCard",
    test: "tests/trajectory-findings-first.test.tsx",
    note: "It put both first: the card listed every domain with its state, the reading it was judged on and the reconstruction caveat, and each domain's own panel twenty lines below printed the same sentence again beside the threshold and the windows. The card now takes an `explanation` flag — false on the page that carries the detail, true on the overview and Session Prep where the card is the only thing there and a state with no reading behind it would be an unexplained verdict. And the summary sentence stopped contradicting the badge under it: a stalled domain is a deviation worth attention and is not a change, so \"Recovery trajectory changed in Activation\" sat directly above \"Within a narrow band\". Stalls are named in their own clause now; the handoff's wording survives for the domains it was written about.",
  },
  {
    id: "clinical.response-standing",
    title: "An exposure says its standing on one line, and missing follow-up is its own row",
    // 17 September handoff, P4: "Responses — summarize patterns and allow
    // exposure details to expand. Pattern, evidence, and missing follow-up are
    // distinct."
    state: "reachable",
    code: "src/lib/clinical/response-standing.ts#exposureStanding",
    test: "tests/response-standing.test.ts",
    note: "All three were on the screen and none was distinct from the others. Every exposure printed its context, its observations and its missing windows all the time, so a person with forty of them produced several hundred lines of extra-small text in one scroll — and the list stopped at twelve with \"and N earlier — the count above includes them\", a sentence telling the reader that records exist and they cannot see them. The scan line now carries the standing (mixed, followed up, partly, not followed up) and the rest opens; the earlier ones open too. Mixed outranks incomplete, because an exposure that settled someone in the room and left them worse the next day is the finding and not a bookkeeping fact. And missing follow-up moved out of the fingerprint's limitations into its own row, computed from the exposures rather than from the pattern — inside the pattern block it read as part of what we had found about the person, and because that block only renders above the display threshold, an intervention with one or two exposures showed no missingness at all.",
  },
  {
    id: "clinical.goal-standing",
    title: "A goal says what the next observable step is, when it was last observed, and when it is next reviewed",
    // 17 September handoff, P4: "Goals — show patient wording, observable
    // milestone, last observation, and next review. Empty state supports goal
    // creation without implying failure."
    state: "reachable",
    code: "src/lib/clinical/goal-standing.ts#goalStanding",
    test: "tests/goal-standing.test.tsx",
    note: "The wording was already first on the panel. The next rung was somewhere in a list of five, the last observation was the top row of an evidence list nobody had aged, and the review date was not on the screen at all — target_review_date has been a column since goals shipped, createGoal accepted it, no form offered it and nothing rendered it, so every goal in the product carried null. Setting one is now a control, clearing it is its own control, and both doors validate the day rather than its shape: a regex alone accepts 2026-13-02, which the store took until a test asked it to. The last observation is the last ACCEPTED one — a model candidate is a question waiting on a clinician, and letting the newest proposal answer \"last observed\" would report a suggestion as evidence.",
  },
  {
    id: "clinical.course-landing-reports-the-record",
    title: "The Course landing says what is in this person's record, not what the four screens are for",
    // 17 September handoff, P4: "Course — show actual status beside measures,
    // goals, responses, and trajectory. The landing page informs and links."
    state: "reachable",
    code: "src/lib/clinical/course-status.ts#courseReadings",
    test: "tests/course-status.test.ts",
    note: "It linked and it did not inform: each link carried a description of the destination screen, identical for every person on the caseload, so the only way to find out which was worth opening was to open all four. Each line now carries a count and a date from the same tables the destination reads — instruments and how long since the last one, goals and what is waiting on a decision, exposures and the windows nobody filled in, domains read and domains held. None of them reports a direction or a state: a landing that summarised the findings would be the composite the four separate screens exist to refuse, assembled one line at a time. Absence is a sentence rather than a zero, because \"0 goals\" and \"no goal has been set with this person\" read differently to somebody deciding where to spend four minutes.",
  },
  {
    id: "clinical.module-request-on-the-record",
    title: "What a person asked to open is readable from their record, beside what was assigned to them",
    // 17 September handoff, P3: "Replace the isolated feel of Module requests
    // with an Assign support action inside Care and relevant clinical
    // contexts." The isolation was the defect, not the screen.
    state: "reachable",
    code: "src/lib/clinical/module-requests.ts#moduleRequestsFor",
    test: "tests/assigned-support.test.ts",
    note: "/clinician/unlocks answers a request properly and is not in navigation, so the two halves of one conversation lived on screens that never mentioned each other: the clinician assigns support in Care, and the person's request sat elsewhere. Care now shows the request in the person's own words beside the assignment, and links to the screen that owns the decision rather than growing a second answer path — the reason a member reads back is required there and would be easy to forget in a second one.",
  },
  {
    id: "experience.queue-concurrency-armed",
    title: "A consequential queue action is revalidated against current server state",
    // The check was written with the feature and disarmed by the surface:
    // expectedVersion={null} at both call sites, against a comparison reading
    // `if (command.expectedVersion && …)`. It short-circuited on every request
    // ever made, and nothing failed — a guard that is never armed passes every
    // test written about the code around it.
    state: "reachable",
    code: "src/lib/clinical/row-version.ts#signalRowVersion",
    test: "tests/queue-stability.test.ts",
    note: "The version is built in one module because the surface sends it and the action recomputes it: `evidenceAt` and `lastDetectedAt` are both on a signal, and a version written from one at each end would compile and reject every review. The alert path now revalidates too — the rows carrying safety authority were the ones with no check at all — over the person's open alerts rather than the collapsed row, because that is the set the action closes. Caseload rows carry no version and CASELOAD_ROW_HAS_NO_VERSION says why. Verified in a browser both ways: a normal review still confirms, and a real collision between two signed-in readers is reported with what the server now holds.",
  },
  {
    id: "clinical.review-currency",
    title: "A review is bound to the evidence it was made against, and says when the record has moved",
    // 17 September handoff, completion semantics: "If material evidence
    // changes later, the interface should identify the earlier review as out
    // of date under an approved policy."
    state: "reachable",
    code: "src/lib/clinical/review-currency.ts#reviewCurrency",
    test: "tests/review-currency.test.ts",
    note: "careActionsForPerson had no caller anywhere in the product — reviews were written and never read back — so the rule had nowhere to identify anything. Three states, because a row written before this carries no evidence version and calling it current is a claim nobody checked. Computed on read, so a review that went stale overnight reads as stale on the next screen rather than the next job. A policy version change is deliberately excluded: it would mark every review on a caseload stale on the same morning and train people to dismiss the label.",
  },
  {
    id: "experience.evidence-panel-responsive",
    title: "The evidence panel stops squeezing the queue, and gives the keyboard back",
    // UX 011, all three parts measured on the running app before anything was
    // written: 678px rows became 262px at 1024px; the panel opened 2,360px
    // below the fold on a phone; focus landed on <body> at every width.
    state: "reachable",
    code: "src/components/experience/RestoreFocus.tsx#RestoreFocus",
    test: "tests/queue-evidence-panel.test.tsx",
    note: "The panel asserted it named a focus-return control and the assertion passed on a non-empty string while no element carried that id. Two later fixes also read correctly and changed nothing: order-first on a container that was only flex at xl, and querySelector on an id containing colons. Each was caught by measuring rather than by reading. Row widths, panel position and focus are now asserted in a browser in tests/e2e/queue-evidence-panel.spec.ts.",
  },
  {
    id: "clinical.shared-between-visit-plan",
    title: "One plan, read from the existing domain, rendered two ways from the same evidence",
    // 17 September handoff, P3: "one read model assembled from current
    // care-plan, goal, assignment, session, and safety facts… Patient and
    // clinician views may use different language, but they must resolve to the
    // same source versions."
    state: "reachable",
    code: "src/lib/clinical/between-visit-plan.ts#buildBetweenVisitPlan",
    test: "tests/between-visit-plan.test.ts",
    note: "No plan table: every fact is read from where it already lives. Sources sit on the FIELD rather than on either rendering, so a view cannot cite evidence the other lacks — there is nothing to cite from. Completion has three states because two make 'we do not know' indistinguishable from 'they did not'. The clinician view is on the care-plan screen; the patient rendering exists as a selection over the same object and lands with the member shell in P5.",
  },
  {
    id: "clinical.assigned-support",
    title: "A clinician can assign support inside Care, and assigning grants nothing",
    // 17 September handoff, P3: "Replace the isolated feel of Module requests
    // with an Assign support action inside Care and relevant clinical
    // contexts… It must not create a second access engine."
    state: "reachable",
    code: "src/lib/clinical/assigned-support.ts#assignSupport",
    test: "tests/assigned-support.test.ts",
    note: "module_unlocks is a member asking and a clinician answering; this is a clinician asking and the person answering by doing it. Separate tables, because collapsing them loses which of the two happened. The gate's answer is asserted byte-identical before and after an assignment exists — not merely 'still refused', which a second engine would also satisfy. Expiry is derived on read. The patient wording and sharing rule are stored with the assignment; the clinical definition is referenced.",
  },
  {
    id: "platform.client-bundle-boundary",
    title: "No client component reaches the database through its value imports",
    // Found by a build, not by a test: a client component's TYPE import of the
    // gate decider became a value import, which put pg in the browser bundle
    // and failed next build with a module-not-found. No type error, no lint
    // error, no failing unit test — and a real build is the slowest thing here.
    state: "reachable",
    code: "tests/client-bundle-boundary.test.ts#reaches",
    test: "tests/client-bundle-boundary.test.ts",
    note: "Follows each client component's runtime imports through the source, stopping at \"use server\" modules — eight components reach the database that way and every one is correct, so a guard that flagged them would be turned off within a week. The erasure rule is tested rather than trusted, and the guard is shown failing on the exact import that broke the build.",
  },
  {
    id: "clinical.handoff-delivery-truth",
    title: "Proposal, delivery, receipt and decision are four answers, and a proposal reaches the receiver's queue",
    // UX 007. The screen was honest and unreadable in one sentence — "nobody
    // has been notified, there is no delivery path in this build, so tell
    // them" — which answered four questions at once, and then relied on the
    // receiver opening a screen they had no reason to open.
    state: "reachable",
    code: "src/lib/clinical/handoff.ts#handoffProgress",
    test: "tests/handoff-delivery.test.tsx",
    note: "Two of the four are permanently negative and that is the content: nothing was sent because there is no channel, and whether it was read is unknown because nothing records a read. The queue rows carry both directions — a decision the receiver owes, actionable whatever the caseload model says, and the sender's own proposal still waiting — with the SENDER as owner, because reading the destination of an unanswered proposal is the inference the handoff model exists to refuse.",
  },
  {
    id: "clinical.capability-claims-are-derived",
    title: "What a screen says it can do is read from the switch that decides whether it renders",
    // UX 005. The Thoughts page said session preparation and patient-scoped
    // questions were "built in later phases" with the question box rendered
    // above the sentence and session prep one click away. Both had shipped.
    state: "reachable",
    code: "src/lib/clinical/thoughts-flags.ts#thoughtsCapabilities",
    test: "tests/thoughts-capability-claims.test.tsx",
    note: "Six capabilities, each with a clinician's name for it and where to find it — no phase numbers, no flag names. A switched-off one says so rather than vanishing, because a missing row reads as never built. A guard fails if the page claims a capability in prose again.",
  },
  {
    id: "clinical.empty-draft-cause",
    title: "A note draft says why it is empty, from the assembler that knows",
    // UX 006. One sentence covered three states — "this is empty because you
    // have not chosen anything, not because there was nothing to choose" — and
    // was false in two of them.
    state: "reachable",
    code: "src/lib/clinical/note-bridge.ts#assembleDraft",
    test: "tests/note-bridge.test.ts",
    note: "Three causes: nothing approved to choose from, nothing ticked, everything ticked refused. The third was previously reported as the second, above a panel listing what the clinician had in fact chosen and why each was rejected.",
  },
  {
    id: "clinical.restrictions-vs-events",
    title: "A restriction in force and an unresolved safety event are separate, named things",
    // UX 004. Therapeutic Load stops when a gate holds a module and sends the
    // clinician to "the safety screen, where access is actually decided" — a
    // screen that only listed alerts and answered "nothing is awaiting a
    // documented response". Two truths about different things, under one word.
    state: "reachable",
    code: "src/components/clinical/SafetyRestrictions.tsx#SafetyRestrictions",
    test: "tests/safety-restrictions.test.tsx",
    note: "The holding states are one list in gate-states.ts, which both screens read, so they cannot disagree about whether anything is held. Each restriction carries the gate's own next step — an incomplete screener reads 'Complete the program-fit questions' — and links to the drawer rather than re-rendering the decision. The two empty states say different things, because they are different facts.",
  },
  {
    id: "platform.clock-contract",
    title: "One clock decides what 'now' means for a read, and cannot reach a write",
    // UX 003. The demo clock moved the badge in the shell and almost nothing
    // underneath it: twenty-seven read functions defaulted to `const now =
    // args.now ?? new Date()`, which answers with real time in a product whose
    // data is read through a moved frame. Nothing failed; the ages were simply
    // wrong, and plausible.
    state: "reachable",
    code: "src/lib/clock.ts#readingFrame",
    test: "tests/clock-contract.test.ts",
    note: "The default is inverted rather than the parameter removed, so forgetting is the harmless failure. buildWorkQueue was passing no clock to buildCaseload, so one projection carried two. closeAlert and beginThought lost their injectable clocks: reviewed_at and recorded_at are records, and a record is written on real time.",
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
