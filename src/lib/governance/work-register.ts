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
// exactly like the paragraphs it replaces. `work-register-verify.ts` checks
// every entry against the source — the symbol exists, a test names it, and for
// anything claiming to be `reachable`, something other than its own module and
// its own tests refers to it. That last check is the one that would have caught
// the unlock gap, and it is the reason this file is worth having.
// `scripts/gen-work-register.ts` commits the result of that walk so
// /review/work can render it without reading a filesystem that a deployed
// build does not have.
//
// THIS PARAGRAPH NAMED THE SCRIPT BEFORE THE SCRIPT EXISTED. The check was
// real and lived somewhere else; the first sentence of the file about drift
// pointed at a path nobody could open. Found by going to write the script.

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
    state: "reachable",
    code: "src/lib/experience/quality.ts#opacityFloorFor",
    test: "tests/design-consistency.test.ts",
    note:
      "Done, and the estimate was low. Pointing an automated accessibility scan at the signed-in " +
      "product returned 179 serious contrast violations across five reviewer screens — the faded " +
      "ink was not a legibility preference, it was a conformance failure. Both design rules now " +
      "cover /review rather than excluding it, and the opacity rule gained a per-token floor: " +
      "olive is already the secondary ink, and text-olive/80 computes to 4.09:1 on ivory.",
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
    id: "experience.one-duration-per-activity",
    title: "An activity takes one length, and a clinician can see it",
    state: "proposed",
    code: null,
    test: null,
    note:
      "TWO LISTS DISAGREE AND BOTH ARE MEMBER-FACING, which is not what it looked like. " +
      "`modules.ts` carries `durationLabel` (\"15\u201320 min\") and `member/view.ts` carries a " +
      "`MINUTES` map (10); six of eleven activities conflict. The framing that these were the " +
      "clinician's figure and the member's was WRONG: `durationLabel` renders on /app/modules, " +
      "/app/activities, session prep, the session player and the mobile service, so a member sees " +
      "\"15\u201320 min\" for Calm place on one screen and \"About 10 minutes\" for the same " +
      "activity on another. There is no clinician-facing duration at all. DECIDED 19 SEPTEMBER: a " +
      "clinician-facing one should exist. What each number MEANS, and which is right where they " +
      "conflict, is `clinical.activity-durations` in the decision register and is not a thing a " +
      "codebase may settle by picking one. HELD 23 SEPTEMBER: shelved deliberately, because the " +
      "set of activities may change — modules added — and settling eleven numbers now would be " +
      "settling a list that is about to move. A member can still see two figures for the same " +
      "activity on different screens; that is a known cost of waiting rather than an oversight, " +
      "which is the difference between held and forgotten.",
  },
  {
    id: "experience.command-center-template",
    title: "Command Center renders through the work-list template",
    state: "proposed",
    code: null,
    test: null,
    note:
      "ClinicianHomeView carries its own scope strip, rows, evidence panel and result. Moving it " +
      "onto WorkList is a real refactor of the busiest clinician screen rather than a wrapper, so " +
      "it was not folded into the template's first pass. LOOKED AT PROPERLY SINCE, and it is two " +
      "decisions rather than one job. First, the template's `evidence` slot and the Command " +
      "Center's evidence panel are DIFFERENT THINGS WITH THE SAME NAME: `EvidenceSlot` is a " +
      "projection disclosure or a sentence saying where evidence lives, rendered below the rows, " +
      "and QueueEvidencePanel is a per-row non-modal aside beside them — §1.4's ruling, and UX " +
      "011's fix. Passing one as the other would put the row detail under the list and undo both. " +
      "Second, WorkList renders `purpose` ABOVE everything, and §5 answers its operating question " +
      "in a fixed order — the counts, then coverage, then the rows — with the orienting sentence " +
      "after the scope strip. Adopting the template moves that sentence to the top of the busiest " +
      "clinician screen. Both are defensible and they produce visibly different screens, so this " +
      "DECIDED 23 SEPTEMBER: the row's detail moves BELOW the list, which is the handoff's own " +
      "second answer to UX 011 — \"open a dedicated detail view or accessible sheet instead of " +
      "squeezing the list\". The orienting sentence stays under the counts: that was a separate " +
      "option and was not chosen. ABOVE THE LIST ON A PHONE IS KEPT, because stacking it under the " +
      "queue there was measured at y=3204 on a 390x844 screen — 2,360px below the fold — and that " +
      "history was put to the author before the decision was confirmed. What remains of this entry " +
      "is the rest of the template: the scope strip, the rows and the result are still the Command " +
      "Center's own rather than WorkList's.",
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
    title: "The organization, payer and reviewer consoles open with the questions they are for, each answer tracing to its denominator",
    // 17 September handoff, P5: "These pages should begin with decisions and
    // work, not a collection of charts." Acceptance: "users can answer each
    // opening question and trace figures to denominator, window, missingness,
    // and definition."
    state: "reachable",
    code: "src/lib/buyer/opening-questions.ts#assertTraceable",
    test: "tests/opening-questions.test.tsx",
    note: "The consoles were not wrong; they were unasked. The organization overview already carried a denominator on every figure and a funnel with its largest drop marked, and a reader wanting to know where access is delayed still had to open three charts on three tabs and do the joining. Each answer is a record now — the sentence, the figure with its denominator, and the four things that must be traceable from it — and `assertTraceable` refuses one missing any of them, so a console cannot ship a confident sentence over a number nobody can take apart. A question nobody can answer keeps its place in the same shape, because a console that drops one looks like a console that was never asked it. And the reason comes from the projection: my first version told the reader that no site had enough waiting people to report without identifying them, which is a plausible sentence about small-cell suppression and was wrong — the projection returns partial with demand for four sites and no supply at all, because the scheduling system has no slot record. A console that invents why it cannot answer is worse than one that does not answer, because the invented reason is what somebody acts on. The payer's four are ordered as they depend on each other — eligibility fixes the denominator, participation is counted against it, measurement says which contract terms could be computed at all, and maturity says whether any of it should be quoted yet. Two more things the rendered page showed: a fall reported AT the stage it had just counted (\"68% started care, and the largest fall is at started care\"), which names a transition now; and a contract row id printed at a plan executive, which is the buyer-side version of the policy version the member's Today was showing. The reviewer console had the handoff's order exactly backwards — thirteen screens to go and look at, with the queue of things waiting on a decision underneath — and could not answer its third question at all. Its landing declined to resolve the gates, on a note saying that needed an identity scan and a scenario replay; measured, the whole resolution is about 170ms, because the expensive check (projection parity) is the one `resolveEvidence` deliberately does not run. One loader now serves the landing and the release screen, so they cannot disagree about which gates are standing. And counting \"pass AND approved\" undercounted: three of the eight gates are attestations by nature, their evidence comes back unavailable because there is nothing for a machine to check, and a console reporting \"1 of 8 passed\" while more stood on a signature was describing its own evidence plumbing rather than the release.",
  },
  {
    id: "governance.member-copy-modality-names",
    title: "Modality names stay out of member copy, and the banned-vocabulary check reads src/lib content",
    // `tested`, not `reachable`: CI runs it (scripts/check-member-copy.ts) and
    // the @safety suite runs it; nothing in the app calls it, and nothing should.
    state: "tested",
    code: "src/lib/governance/member-copy.ts#modalityHits",
    test: "tests/member-copy-names.test.ts",
    note:
      "Handoff 10 \u00a78.1\u20138.2 (CV10_F03 and F02). The banned-vocabulary grep in the safety workflow " +
      "now covers practices.ts, lessons.ts, programs.ts and src/lib/content, and the test reads the grep " +
      "command out of the workflow so dropping a path fails. The modality check walks the loaded practices, " +
      "lessons and programs and reads only member-facing strings, so the review rows that name the rule are " +
      "not hits. It adds CBT and IPT to the handoff's list, under the pack's 'no modality names' rule. One " +
      "comment in lessons.ts was reworded so the grep, which reads comments, had nothing to excuse.",
  },
  {
    id: "governance.audio-mono-check",
    title: "Produced audio is mono or identical stereo before it can reach a member",
    state: "tested",
    code: "src/lib/governance/audio-mono.ts#checkAudioFile",
    test: "tests/audio-mono-check.test.ts",
    note:
      "Handoff 10 \u00a78.3 (CV10_F03), ahead of the recordings themselves (package 11, founder action F4). " +
      "The handoff's rule, left/right correlation of at least 0.99, plus two it cannot see: every one-second " +
      "stretch with sound must clear 0.99 too (a short panned passage averages away over a long file), and " +
      "the channels' levels must match within 1 dB (a steady pan correlates perfectly). Fails closed: only " +
      "WAV masters can be read, so anything else under assets/audio fails. The directory is empty today.",
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
    state: "reachable",
    code: "src/lib/demo-population-generator.ts#generatePopulationHistory",
    test: "tests/demo-population.test.ts",
    note:
      "Done, and it turned out to be two records rather than one. The generator has always " +
      "written `clinician.reviewed` events; nothing wrote the CARE ACTIONS those events describe, " +
      "so a person's record showed no between-visit work at all. They are written from the same " +
      "loop now, so the event log and the ledger agree by construction rather than by a second " +
      "pass. The caseload's contact column reads a DIFFERENT record — a signed contact note — and " +
      "the demo had none of any kind, so seeding care actions alone would have left that column " +
      "exactly as empty while filling the record below it. Signed notes are seeded only on the " +
      "demo clinician's own caseload, because eleven of the twelve fabricated clinicians are " +
      "persons rather than accounts, and a note signed by somebody who never held that person is " +
      "worse than an empty column.",
  },
  {
    id: "governance.decision-register",
    title: "The questions waiting on a person, written down",
    state: "reachable",
    code: "src/lib/governance/decision-register.ts#DECISION_REGISTER",
    test: "tests/decision-register.test.ts",
    note:
      "NEITHER REGISTER COULD SAY THIS. The work register has `proposed` and `held`; the failure " +
      "register has `gap`. All three describe the state of the WORK, and none says \"this is not " +
      "moving because nobody has answered a question\" — so a decision waiting on somebody looked " +
      "exactly like work nobody had got to, and that difference is the only thing telling a reader " +
      "whether building harder would help. Each entry carries the question in words somebody " +
      "outside the codebase can answer, what it blocks (checked against all three registers), and " +
      "WHAT HAPPENS MEANWHILE — the field usually missing from a list of open questions, and the " +
      "one that says whether the wait is costing anything, because an unanswered question always " +
      "has a current behaviour and leaving it unsaid is how a default becomes a decision nobody " +
      "took. Answered ones stay, with the answer and its date, so the code is not left carrying a " +
      "rationale nobody can find. THE STALENESS CHECK CAUGHT ITS OWN AUTHOR on the first run: " +
      "`gates.who-signs` was filed as blocking `governance.gate-owners`, which had shipped — the " +
      "mechanism was built and only three names were missing, which is configuration rather than " +
      "work anybody is waiting to do. " +
      "ONE SIGNABLE SHEET PER OPEN QUESTION is generated from it into docs/decisions, because a " +
      "register that lives in TypeScript is exactly the wrong shape for the person who has to " +
      "answer it: a clinical lead does not open a source file. One sheet each, since seven " +
      "questions on a page get skimmed and signed as a block. Each carries the choices in ordinary " +
      "words with what would actually change, tick boxes, and a name, signature and date — a tick " +
      "with no name is an anonymous decision. The sheets are held to the register by a test, " +
      "because a hand-edited one drifts the moment either moves and then there are two accounts of " +
      "what is open; a sheet for a question since answered is deleted rather than left. A jargon " +
      "check refuses an option naming a file, a symbol or a table, and caught three options that " +
      "were too terse to weigh.",
  },
  {
    id: "governance.work-register-screen",
    title: "The work register, readable on a review screen",
    state: "reachable",
    code: "src/lib/review/work-register-view.ts#registerRows",
    test: "tests/work-register.test.ts",
    note:
      "/review/work, in the audit layer. The evidence is on each row rather than behind the state " +
      "word: a screen that printed \"reachable\" and nothing else would be a prettier copy of the " +
      "handoff paragraph this register replaced, and the reader has to be able to disbelieve the " +
      "word. Held and proposed entries are lifted to the top, because that is the half a stale " +
      "document gets wrong in the expensive direction. The walk is COMMITTED rather than run on " +
      "the screen — `verifyRegister` reads `src` and `tests` off disk and neither is present in a " +
      "deployed build — and tests/work-register.test.ts fails when the committed findings drift " +
      "from a fresh walk.",
  },
  {
    id: "clinical.caseload-assignment",
    title: "A person is assigned to a clinician, and it stays that way",
    state: "reachable",
    code: "src/lib/clinical/caseload-assignment.ts#assignToCaseload",
    test: "tests/caseload-assignment.test.ts",
    note:
      "THERE WAS NO WAY TO SAY IT. The caseload carried `primaryClinicianId` and derived it from " +
      "`module_unlocks.clinician_id` — whoever last approved or refused a request to open a gated " +
      "module. A clinician who answered one unlock for somebody else's patient became that " +
      "patient's primary clinician, and a person who had never requested one had nobody, which was " +
      "all 250 members. So every queue row read Unassigned, the `hybrid` model's promise that 'a " +
      "named owner carries accountability' was inert, and \"Dr Chen's caseload\" was not a thing " +
      "the system knew. A PERSON ID, NOT A USER ID: eleven of the twelve fabricated clinicians are " +
      "persons with a role and no login, and keying this to accounts would have made them " +
      "unassignable — the same constraint that limits who can sign a clinical note. Where a " +
      "clinician does hold an account the two ids are the same value, so the access comparison " +
      "still works. HISTORY IS KEPT, because a transfer is a clinical fact and updating one row in " +
      "place answers 'who looks after them' while losing 'who did, in March' — which is the " +
      "question asked after something goes wrong. It is accountability, NOT access: the active " +
      "hybrid model still lets anyone in the tenant act, deliberately, so a member in an Immediate " +
      "band does not wait for one person to come back from leave; what changes is that covering " +
      "somebody else's patient is now visible as coverage, which it never could be because nobody " +
      "had a patient. The demonstration seeds all 240 fabricated people from the manifest's own " +
      "clinician column, so unclaimed work on the Command Center fell from 34 of 39 to 3 — the " +
      "three being demo-seed members the population generator does not cover, which leaves the " +
      "unassigned state visible rather than theoretical.",
  },
  {
    id: "clinical.unclaimed-work-is-counted",
    title: "Unclaimed work is counted where somebody will see it",
    state: "reachable",
    code: "src/lib/clinical/ownership-debt.ts#ownershipDebt",
    test: "tests/ownership-debt.test.ts",
    note:
      "The failure register's scenario is that work nobody owns builds up UNNOTICED, and the " +
      "noticing is what a queue cannot do by itself: ownership is on every row, so a clinician " +
      "can read twenty owners and still not know that nine of them say nobody. Counted over the " +
      "WHOLE queue rather than the bucket showing — pressing a count must not change how much " +
      "unclaimed work exists — and keyed on the owner NAME rather than the id, because a row " +
      "whose id resolves to no name renders as Unassigned, which is how a panel could have " +
      "reported zero debt over a list that said Unassigned throughout. IT DOES NOT ESCALATE, and " +
      "a test reads the module's code with comments and string literals stripped to keep it that " +
      "way: who unclaimed work falls to, and after how long, is an operational decision this " +
      "codebase must not invent, so the screen carries the absence of the rule in words instead " +
      "of a caution colour that would imply one.",
  },
  {
    id: "governance.environment-policy",
    title: "One policy governs entry, storage, display and export",
    state: "reachable",
    code: "src/lib/governance/environment-policy.ts#readTier",
    test: "tests/environment-policy.test.ts",
    note:
      "UX 008. Every screen says DEMO — FABRICATED DATA — NOT CLINICAL CARE, and the product also " +
      "has a pilot: an enrollment code, a consent and terms flow, a place limit, and a tenant of " +
      "its own so no metric spans real and fabricated people. BOTH STATEMENTS ARE TRUE OF " +
      "DIFFERENT STATES, and nothing said which state a deployment was in — a reader inferred it " +
      "from a banner, and a banner is not a policy. DECIDED 19 SEPTEMBER: real consented " +
      "participants are what the pilot is FOR, and no environment takes one until the gates that " +
      "protect them pass. Two tiers, each naming what it permits per data class for each of UX " +
      "008's four verbs; the current tier is READ from live facts rather than declared, so an " +
      "environment cannot be in the pilot tier because somebody set a variable. `enrollmentState` " +
      "now separates CONFIGURED from OPEN, which is the state nothing could previously describe. " +
      "Every failure direction lands on fabricated-only: an unresolved gate is not a passing one, " +
      "an unreadable gate table is not a passing one, and a data class nobody listed permits " +
      "nothing. No tier permits a real participant's record to leave in a file — admitting " +
      "somebody and exporting their record are two decisions, and granting the second with the " +
      "first is how a consent scope quietly widens. " +
      "REPORTED AND NOT ENFORCED, WHICH IS THE HALF THAT IS NOT DONE. " +
      "`open: configured && permittedByTier` was written, tested and taken back out: " +
      "`resolveEvidence` returns `unavailable` for every attested gate unconditionally and " +
      "nothing anywhere records an attestation, so that one line does not mean gates-first — it " +
      "means enrollment is closed permanently, in every deployment, with no configuration that " +
      "reopens it, and it takes the enrollment suite down with it (a wrong access code, an " +
      "unticked acknowledgement and a minor at account creation are each proven by driving a flow " +
      "that would no longer run). A one-way door that also deletes the evidence for three safety " +
      "refusals is not a check. `permittedByTier` is computed and tested so wiring it is one word, " +
      "and what it waits on is `governance.attestation-record`.",
  },
  {
    id: "governance.attestation-record",
    title: "A signed gate reads as signed",
    state: "reachable",
    code: "src/lib/governance/attestation.ts#allAttestations",
    test: "tests/attestation.test.ts",
    note:
      "THE FILING WAS WRONG AND THE FIX WAS SMALLER THAN THE FINDING. This was recorded as 'nothing " +
      "records an attestation — there is no store, no form and no owner field'. There is all three. " +
      "`signOffGate` requires a reviewer, computes the gate's fingerprint, REFUSES a sign-off made " +
      "against a stale one, records the decision with its evidence reference and audits it, from a " +
      "form that has been on the release console the whole time. `resolveEvidence` never read it " +
      "back, so a reviewer could sign a gate and the gate would go on saying nobody had. " +
      "THE THIRD WRITE-WITH-NO-READER IN A WEEK, after requestUnlock/decideUnlock and after " +
      "assignWork, and the one that mattered most: these gates decide whether a deployment may " +
      "hold real people. A FIRST ATTEMPT BUILT A SECOND TABLE — `gate_attestations`, with every " +
      "column `review_decisions` already had including the fingerprint binding — and it was " +
      "deleted; a test asserts it is not there, because two records of one fact disagree the first " +
      "time either moves. A refusal is now distinguishable from an absence, which it was not: " +
      "'nobody has reviewed this' and 'a reviewer blocked it' rendered as the same grey cell.",
  },
  {
    id: "governance.signoff-does-not-invalidate-itself",
    title: "Signing a gate does not invalidate the signature",
    state: "reachable",
    code: "src/lib/review/gates.ts#resolveEvidence",
    test: "tests/attestation.test.ts",
    note:
      "FOUND BY SIGNING A GATE IN A BROWSER AND WATCHING IT STAY GREY. The sign-off's own state was " +
      "briefly added to the gate's `facts` so a reader could see it — and `currentFingerprint` " +
      "hashes exactly that map. So recording an approval flipped the state from unsigned to " +
      "current, which changed the fingerprint, which meant the approval had been made against a " +
      "version that no longer existed, so the gate read unsigned again and the fingerprint flipped " +
      "back. A signature invalidated by its own existence. Nothing in the type system or the suite " +
      "objected, and the screen said 'Not resolved' both before and after — which is the same " +
      "answer for 'nobody signed it' and 'you just signed it and it did not take'. The facts are " +
      "what was attested TO and nothing else.",
  },
  {
    id: "governance.gate-owners",
    title: "A named individual signs each attested gate",
    state: "reachable",
    code: "src/lib/governance/gate-owners.ts#signerFor",
    test: "tests/gate-owners.test.ts",
    note:
      "DECIDED 19 SEPTEMBER: a named individual, not any reviewer. p99 gives every gate an owner — " +
      "\"Security\", \"Product and QA\" — and a team is not a signature: \"somebody in Security " +
      "approved it\" is not a thing anybody can follow up, and these gates decide whether a " +
      "deployment may hold real people. THE UNNAMED CASE IS ITSELF A DECISION (23 September): a " +
      "gate with nobody named keeps today's behaviour and the console says so, rather than " +
      "refusing every sign-off until three names exist — which would be the one-way door this " +
      "codebase has now walked into twice. A rule that was never set must not look identical to a " +
      "rule that was; that is exactly how the sign-off gap survived. NO NAME IS FILLED IN, and a " +
      "test asserts it: writing a plausible one would be this codebase deciding who is accountable " +
      "for whether a keyboard path is blocked. Checked in the action rather than only on the form, " +
      "because a form that hides a control is a suggestion and the action is the door.",
  },
  {
    id: "governance.resolved-gate-results",
    title: "A gate's last resolved result is recorded",
    state: "reachable",
    code: "src/lib/governance/gate-results.ts#currentGateResults",
    test: "tests/gate-results.test.ts",
    note:
      "FOUND BY WIRING THE ENVIRONMENT POLICY'S ENFORCEMENT. `clinical_language` and " +
      "`projection_parity` resolve to `unavailable` in every deployment — not because they fail, " +
      "but because `resolveEvidence` does not compute either unless the caller hands it in: one " +
      "needs the copy-review tally the review screen holds, the other a ledger rebuild that is " +
      "deliberately not run on a page load. The environment tier is read on the signup page, so " +
      "asking for either there would be free and wrong or correct and unaffordable. Requiring them " +
      "anyway would have been the same one-way door as before, dressed as diligence: a gate that " +
      "cannot pass closes enrollment permanently. They are named in " +
      "`T1_GATES_NOT_YET_RESOLVABLE` rather than dropped, because a requirement quietly removed " +
      "from a list is how a list stops meaning anything. What they need is somewhere to record a " +
      "resolved result with the time it was resolved — the same shape as a sign-off, and for the " +
      "same reason. BUILT 23 SEPTEMBER, and both gates are required again. EXPIRES ON CHANGE, NOT " +
      "ON A CLOCK: a result carries the BASIS it was resolved against and counts only while that " +
      "matches. A time cap was offered and declined — a result expiring on a timer closes the " +
      "pilot tier overnight with nothing having changed, which teaches an operator to re-run a " +
      "check they have no reason to believe is stale, and a check somebody re-runs without reading " +
      "is worse than no check. The basis is EXACT for clinical language (the copy version those " +
      "decisions are recorded against) and WEAKER for projection parity (the deployed commit, " +
      "because nothing cheap identifies ledger state) — it expires when the code changes, not when " +
      "the data does, and a build reporting no commit records nothing rather than recording " +
      "something that would never expire. The console that can resolve them is the one that " +
      "records them, so the record is a by-product of somebody actually looking. " +
      "A THIRD ONE-WAY DOOR LIVED IN THE FIRST VERSION, found by the enrollment suite going red on " +
      "a fresh database. Parity's basis was the deployed commit and nothing else, and " +
      "`scripts/serve.sh` derives that from git while `npm run start` does not — so in any " +
      "deployment whose image forgot to bake a commit in, parity could never be recorded, the gate " +
      "could never pass and enrollment could never open, in exactly the deployments least likely " +
      "to work out why. It falls back to the ENVIRONMENT GENERATION, which is the better basis " +
      "anyway: parity asks whether a rebuild reproduces what the screens show, and the generation " +
      "changes precisely when the data underneath is rebuilt. With neither available it still " +
      "records nothing, because a constant would make every result look current forever.",
  },
  {
    id: "clinical.assignment-is-read-back",
    title: "Assigning work changes what the queue says",
    state: "reachable",
    code: "src/lib/clinical/work-queue.ts#buildWorkQueue",
    test: "tests/work-assignment.test.ts",
    note:
      "FOUND BY PRESSING THE BUTTON. A clinician chose an owner and was told \"Recorded Noor " +
      "Fontaine as the owner\"; the row went on saying Unassigned, through a reload and " +
      "permanently, and every one of 35 rows on the demo caseload read the same. THREE FAULTS " +
      "STACKED INTO ONE SYMPTOM, which is why reading any one of them made the code look right. " +
      "`assignWork` records the owner as a care action carrying `owner:<personId>` — a sound " +
      "decision, since the care vocabulary is closed — and the queue read no assignment at all, " +
      "while its own comment claimed it read the newest. An assigned owner is a PERSON and a " +
      "derived one is a USER, because `primaryClinicianId` comes off `module_unlocks.clinician_id`, " +
      "so the name map built from `users` alone resolved a person-id owner to nothing — and a row " +
      "with no owner NAME renders as Unassigned however right its id is, which would have made " +
      "the first fix look like no fix. Newest wins, tenant-scoped in the query rather than " +
      "filtered after, and a test holds the two ends of the `owner:` encoding together because " +
      "renaming the prefix on either side compiles and type-checks.",
  },
  {
    id: "clinical.unreachable-care-actions",
    title: "All eight care actions have a writer and a screen",
    state: "reachable",
    code: "src/lib/clinical/attention-vocabulary.ts#UNWRITTEN_CARE_ACTIONS",
    test: "tests/care-time.test.ts",
    note:
      "FOUND BY DRIVING THE SEED, not by reading the vocabulary. §13's care-action vocabulary is " +
      "closed — eight names — and the product writes four: `review`, `contact`, `add_followup` and " +
      "`resolve`. Nothing anywhere writes `record_thought`, `open_session_prep`, " +
      "`review_trajectory` or `adjust_plan_link`, and the first two would render on no screen even " +
      "if something did: the care ledger shows four action types and the review ledger shows one. " +
      "CLOSED IS NOT THE SAME AS BUILT, and a word in a closed vocabulary reads exactly like a " +
      "built feature — which is how the demo seed came to write 249 `record_thought` rows, a shape " +
      "no clinician can produce, displayed nowhere. The seed is fixed and the split is now named at " +
      "the vocabulary and checked against the source, so neither can go stale quietly. HELD ON " +
      "PURPOSE for the part that remains: whether each word should be DELETED or BUILT is a " +
      "clinical-vocabulary decision, and §13 calls the list closed because an action type nobody " +
      "defined is an action nobody can count or audit — removing four from it is exactly the kind " +
      "of change that list exists to make deliberate. DECIDED 19 SEPTEMBER to SHELF them until the " +
      "handoff was finished; REVERSED 23 SEPTEMBER to build all four, recorded rather than " +
      "overwritten so the next reader can see the question was asked twice. " +
      "THREE OF THE FOUR ARE BUILT. A captured thought records one by itself, because capturing a " +
      "thought is already a deliberate act by a named clinician at a known time; preparing for a " +
      "session and reading a trajectory are recorded by a CONTROL THE CLINICIAN PRESSES rather " +
      "than by the page rendering — both are named after opening a screen, which makes writing on " +
      "render the obvious build and the wrong one, since a prefetched link would record a clinical " +
      "fact invented by a mouse moving, and a reload or a back button would add another. The " +
      "ledger's inclusion list is DERIVED from the vocabulary now instead of hand-written: its own " +
      "docstring said \"everything that is not a review\" and the four names under it were not " +
      "that, which is how three actions came to be recordable and invisible at once. " +
      "THE FOURTH, `adjust_plan_link`, NEEDED A FEATURE RATHER THAN A WRITER, and that was the " +
      "finding: there was no PLAN LINK in this product — no model, no screen, no column, nothing " +
      "called a link on a plan anywhere — so nothing could write the word until somebody decided " +
      "what one IS. BUILT 24 SEPTEMBER as the connection between a piece of assigned support and " +
      "the goal it is meant to move. The gap it closes was visible in the between-visit plan " +
      "itself, which showed a person their focus in their own words and, underneath, a list of the " +
      "support they had been asked to do, with nothing saying which served which: a clinician held " +
      "the join in their head, so the next reader had to infer it and the person was never told. " +
      "A COLUMN ON THE ASSIGNMENT rather than a second plan table, because the handoff forbids a " +
      "second authoritative plan and the relationship is 0-or-1; the link's HISTORY is not lost by " +
      "that, because every change appends to the care ledger, which is where the history of " +
      "clinical decisions already lives. The link refuses another person's goal and refuses a " +
      "DRAFT goal — §12's rule, since a draft is wording nobody has confirmed with the person — " +
      "and a re-submitted link is refused rather than ignored, because a care-time record of an " +
      "adjustment that did not happen is the one thing this ledger cannot survive. Both views of " +
      "the plan render it from one set of sources, and the person sees it in their own words on " +
      "their own Today screen. UNWRITTEN_CARE_ACTIONS is empty now and is kept as the question " +
      "rather than the answer: the next action added to the closed list arrives without a writer " +
      "exactly as these four did.",
  },
  {
    id: "clinical.plan-link",
    title: "A plan link joins assigned support to the goal it is meant to move",
    state: "reachable",
    code: "src/lib/clinical/assigned-support.ts#linkAssignmentToGoal",
    test: "tests/plan-link.test.ts",
    note:
      "The feature `adjust_plan_link` was waiting on. A clinician says which of the person's own " +
      "goals a piece of assigned support is working towards, at the moment they assign it or " +
      "afterwards, and both sides of the between-visit plan render it from the same sources — the " +
      "clinical title with its state on one side, the person's own words on the other. Refuses a " +
      "goal belonging to somebody else, refuses a draft nobody has confirmed with them, refuses a " +
      "link that did not move, and refuses to rewrite what a finished assignment was for.",
  },
  {
    id: "demo.goals-and-assignments-unseeded",
    title: "The demonstration seeds goals, assigned support and the link between them",
    state: "reachable",
    code: "src/lib/demo-population-generator.ts#generatePopulationHistory",
    test: "tests/demo-population.test.ts",
    note:
      "FOUND BY DRIVING THE DEMONSTRATION, and only by driving it. After a full reset the "
      + "fabricated population holds 240 people, 20,057 events and 770 care actions — and ZERO "
      + "rows in return_to_life_goals and ZERO in support_assignments. Both features are built, "
      + "tested and reachable; nothing in the generator writes either table, so every goals screen "
      + "and every assigned-support panel in the demonstration shows its empty state. A reviewer "
      + "driving the demo would conclude neither feature exists, and the plan link now inherits "
      + "that: it joins the two, so it is invisible wherever they are. "
      + "BUILT 24 SEPTEMBER. 84 of the 240 hold a goal — a slice, because a caseload where "
      + "everybody has one is as false as one where nobody does, and it would make \"nothing has "
      + "been set with this person\" a state a reviewer never meets. Every refusal the product "
      + "makes has somebody it applies to: goals are left as drafts, which cannot be linked to; "
      + "assignments are left naming no goal, which is ordinary; and a few links have been moved, "
      + "so the care ledger carries an adjustment a clinician actually produces. Tests hold the "
      + "seeded rows to the rules the command enforces — no link to another person's goal, none "
      + "to a draft, no goal without its five rungs, no draft recorded as confirmed — because a "
      + "seed writes rows directly rather than through the command that keeps them honest. "
      + "AND IT WOKE A THIRD FEATURE NOBODY HAD SEEN. The attention queue has a provider that "
      + "raises a signal when a goal has had no accepted evidence for a long time; it had never "
      + "fired in the demonstration, because there were no goals for it to be quiet about. Two of "
      + "its signals now appear on the clinician's home, which is the visual baseline's only "
      + "change and the reason it was recaptured rather than refreshed.",
  },
  {
    id: "companion.tools-cannot-write-session-state",
    title: "The companion's tools cannot write session state, and a model cannot lower a protection",
    state: "reachable",
    code: "src/lib/companion-proposals.ts#proposeToMember",
    test: "tests/companion-boundary.test.ts",
    note:
      "Expansion Handoff non-negotiable 5 and \u00a75.3; Phase 0. The companion's record_trigger tool " +
      "wrote user_triggers directly, intensity included, through a COALESCE that took any new value. " +
      "That intensity is the only thing keeping a trigger out of SELF-GUIDED processing \u2014 " +
      "recent-trigger disables anything at 7 or above \u2014 so a model could move a trigger a person " +
      "rated 8 into work they could do alone. Reproduced before the fix: 8 in, 3 out. That is a model " +
      "LOWERING a protection, which non-negotiable 2 forbids outright. Not live in this deployment, " +
      "because model-backed replies need ANTHROPIC_API_KEY and it is unset by decision; reachable the " +
      "moment that changed. The tool runtime now lives in its own module with NO DATABASE HANDLE, " +
      "and a test pins the exact symbols it may import, because the modules it may import also " +
      "export writers it must not call. What the companion notices becomes a SUGGESTION the person " +
      "adds to their map with an intensity they give it themselves, or dismisses. Focus areas take " +
      "the same route, since four processing modules offer them back as targets. Two adjacent holes " +
      "closed with it: an unrated trigger was selectable for self-guided work, against \u00a70.3's " +
      "fail-closed rule, and now is not; and a duplicate check on an encrypted title could never " +
      "fire, because the IV is random, which the tests now catch. A model may still ADD protection \u2014 " +
      "a topic to avoid is written as before \u2014 because the asymmetry is the rule.",
  },
  {
    id: "clinical.sessions-terminate-cleanly",
    title: "A session ends once, as its own ratings say it ended, and nothing stays open",
    state: "reachable",
    code: "src/lib/session-close.ts#closeSession",
    test: "tests/session-termination.test.ts",
    note:
      "Expansion Handoff Phase 0, session termination. The web and mobile finish paths were copies " +
      "that overwrote any status, so a hard-stopped session could be finished again as completed " +
      "and its processing rest disappeared; the first close now wins and later ones change nothing. " +
      "The server re-runs the in-session distress rule over the trail, so a rating of 9 closes as a " +
      "hard stop whatever the request claimed, and before/after/peak come from the trail. Sessions " +
      "nobody closed stayed in_progress forever, and 'pick up where you left off' started a new " +
      "session beside them; starting a session now closes any left open (abandoned, at the cap, no " +
      "invented ratings) and one past the cap is never offered back. A hard stop rests processing " +
      "by its status as well as its rating. The after-session check now requires the member's own " +
      "ended session, refuses a missing rating instead of saving it as zero, and takes one check " +
      "per session. Closing that exposed a queueing gap in SQLite transactions, fixed and tested.",
  },
  {
    id: "clinical.program-fit-retake-bypass",
    title: "The program-fit questions cannot be answered again to lift a stop",
    state: "reachable",
    code: "src/lib/fitness-screener.ts#recordFitnessScreening",
    test: "tests/fitness-retake.test.ts",
    note:
      "Expansion Handoff Phase 0, screener retake bypass. During the 24-hour pause only the page was " +
      "hidden: the action and the mobile route saved a fresh set of answers and the pause ended at " +
      "once. And after the pause, re-answering lifted stops the safety core says only a person may " +
      "lift (a diagnosis, a hospital stay in the past year, relying on substances, being under 18). " +
      "The one writer now refuses while any answer is in force; those stops are held until a " +
      "clinician closes the stop's alert with a documented action. The mobile route skipped the " +
      "refund and the care-team alert entirely \u2014 both paths now share one response. Every reader " +
      "of the status opens on an allow-list, because the gate blocked by naming 'cooldown' and a " +
      "new status would have walked through it. How long the timed pause should be is open with " +
      "the clinical lead (clinical.program-fit-pause-length).",
  },
  {
    id: "clinical.recall-window-cadence",
    title: "No questionnaire is given again before the time it asks about has passed",
    state: "reachable",
    code: "src/lib/measures/cadence.ts#saveMeasureResponse",
    test: "tests/measure-cadence.test.ts",
    note:
      "Expansion Handoff Phase 0 and \u00a74. The weekly wait lived only in whether the Begin link " +
      "rendered; the page, the web action and the mobile route saved any questionnaire at any time. " +
      "All three now go through one writer that refuses inside the instrument's recall window, read " +
      "off its own instructions and checked against them. The weekly trauma measures asked about " +
      "the past month every seven days; the product owner chose weekly with past-week wording " +
      "(clinical.weekly-trauma-questionnaire-wording), built from the published past-week PCL-5 and " +
      "switched off until the psychologists sign it, so the approved past-month wording runs every " +
      "thirty days meanwhile. A rise is only compared against the same wording.",
  },
  {
    id: "clinical.kb-no-bls-shape",
    title: "No bilateral-stimulation shape in the companion's knowledge base, practices or lessons",
    state: "reachable",
    code: "src/lib/therapy-kb/catalog.ts#TECHNIQUES",
    test: "tests/kb-no-bls-shape.test.ts",
    note:
      "Handoff 10 P0. The knowledge base told the companion to offer the Butterfly Hug \u2014 slow " +
      "alternating taps \u2014 to members as activated as 8: self-administered BLS in a build with none. " +
      "Replaced by a still self-hold, same tier and ceiling, confirmation row " +
      "KB_SELF_HOLD_REPLACES_BUTTERFLY. The handoff's pattern then found two movement practices " +
      "moving 'side to side' and the calm-place lesson's invitation to pair it with bilateral " +
      "stimulation; all reworded. The lesson explaining how EMDR works is the one named exception, " +
      "held to explaining only.",
  },
  {
    id: "clinical.content-signoff-fails-closed",
    title: "New member content is absent until its sign-off row is agreed",
    state: "reachable",
    code: "src/lib/content-signoff.ts#visibleContent",
    test: "tests/content-signoff.test.ts",
    note:
      "Handoff 10 \u00a70.2 and \u00a73.3. Every list, deep link, phone response and the daily plan " +
      "reads practices and lessons through one filter: no row is live as before, a named row must be " +
      "agreed, an unknown row is never live, and in the demonstration an unsigned item shows marked " +
      "'Pending clinical review'. /review/content lists the rows and what each holds back. The " +
      "sign-off action now refuses a verdict for a row that does not exist, since an agreed row makes " +
      "content live. Only rows whose subject the handoff states are defined; the rest wait for the " +
      "worksheet.",
  },
  {
    id: "experience.skills-gated-in-listing",
    title: "Skills are gated where they are listed, with 'not today' on a deep link",
    state: "reachable",
    code: "src/lib/practices.ts#practiceAllowed",
    test: "tests/skills-gating.test.ts",
    note:
      "Handoff 10 \u00a73.1 and 1A. Practices gain an optional skill type and gate (tier, activation " +
      "ceiling, imagery). Unknown activation reads as 10 and an unreadable engine opens nothing " +
      "gated; the twenty existing practices carry no gate and behave as before. The library now " +
      "holds the eighteen signed skills (clinical.h10-content-signed).",
  },
  {
    id: "clinical.programs-self-paced",
    title: "Programs open in order, re-ask the gate each part, and keep what was done",
    state: "reachable",
    code: "src/lib/programs.ts#programView",
    test: "tests/programs.test.ts",
    note:
      "Handoff 10 \u00a73.2, with Moving Toward (CV10_B01, B02 as the proposal, F02). Unit N+1 opens " +
      "when unit N is done; each part re-asks today's gate and says 'not today' below its floor; " +
      "joining and leaving are one tap, and joining again returns to the same row with what was done. " +
      "The view carries words, not counts. Enrolments and completions are dual-written to the spine " +
      "and a rebuild reproduces them; member-written entries are not projected, since the spine never " +
      "holds the words. One departure: the pack says the menu shows items 'tagged to the member's " +
      "chosen areas' but tags none, so the menu shows its categories as written (Gentle only at the " +
      "stabilization tier) rather than an invented mapping.",
  },
  {
    id: "clinical.steadier-sleep",
    title: "Steadier Sleep: an entry screen that leaves out one part, and a getting-up time with no time-in-bed limit",
    state: "reachable",
    code: "src/lib/programs.ts#scoreEntryScreen",
    test: "tests/sleep-entry.test.ts",
    note:
      "Handoff 10 1C (CV10_C01 to C04, F02), every string matched whole against the pack. The entry " +
      "screen is asked on joining; any yes leaves out part two and only it, and the order skips it. " +
      "The answer is kept as a code (withheld or not, and which extra line to say); the spine and " +
      "audit log carry only whether it withheld. Leaving clears it, so joining again asks again " +
      "(decision clinical.sleep-entry-screen-retake, with its risk). Part two stores the getting-up " +
      "time and nothing else; no code computes a bedtime or a time-in-bed limit (C03). Gates are the " +
      "signed night-practice levels, open for the psychologists to confirm (clinical.steadier-sleep-gates). " +
      "No sleep measure until its licensed items are supplied (C05).",
  },
  {
    id: "clinical.feeling-and-relating",
    title: "Feeling and Relating: eight units on the trauma path, relationships now, never named for its source",
    state: "reachable",
    code: "src/lib/programs.ts#programAllowedOnPaths",
    test: "tests/feeling-and-relating.test.ts",
    note:
      "Handoff 10 2A (CV10_D01 to D03, F02), every string matched whole against the pack. Offered on the " +
      "trauma path. On the complex trauma readiness path it waits for that path's clinician review, which " +
      "nothing records yet, so it is not offered there, and a member on both paths is held by the one that " +
      "needs review (clinical.path-review-mark). Units 1 to 4 at the stabilization tier, ceiling 6; 5 to 8 " +
      "cautious, ceiling 5; no imagery. Units 5 to 7 open with the signed line about relationships now. " +
      "Unit 2's words are typed: the pack names a word list and gives none (product.feelings-word-list). " +
      "The written-reflection screen reuses the pack's signed line for member entries (D04), 'Only you can " +
      "see this. You can delete it any time.', which is true here too.",
  },
  {
    id: "clinical.member-thought-records",
    title: "A member's own thought records: gated, screened, private, and never shown back as numbers",
    state: "reachable",
    code: "src/lib/thought-records.ts#saveThoughtRecord",
    test: "tests/thought-records.test.ts",
    note:
      "Handoff 10 2B (CV10_D04), every string matched whole against the pack. A tool under Activities " +
      "rather than a program part, because no signed program has one. The cautious tier, ceiling 6, asked " +
      "on open and on save. A strength of 8 or more at step 2 offers 'Find the room' first. Every field " +
      "runs the crisis pre-filter. Private: its own encrypted table that no clinician screen, review screen " +
      "or companion file reads, and no spine event at all, not even the ratings, since the row says the " +
      "entries are the member's own. The feeling is typed until a word list is signed " +
      "(product.feelings-word-list). Web and mobile.",
  },
  {
    id: "clinical.riding-strong-feelings",
    title: "Riding Strong Feelings: four parts from live skills, each ending with the member's own SOS-plan choice",
    state: "reachable",
    code: "src/lib/program-activities.ts#answerSosQuestion",
    test: "tests/riding-strong-feelings.test.ts",
    note:
      "Handoff 10 2C (CV10_D05, F02), every string matched whole against the pack. Each part opens at the " +
      "loosest gate among its skills, derived and tested from the skills themselves, and each skill keeps " +
      "its own gate inside it (clinical.riding-strong-feelings-gates, open for the psychologists). 'Add' " +
      "writes the chosen skills' names to the member's own SOS plan through sos.ts#addSosGroundingTools, " +
      "which appends and never replaces, skips duplicates and keeps onboarding's cap of fifteen; 'Not now' " +
      "adds nothing; either completes the part. Only the part's practices can be added, never its lesson, " +
      "and no companion file names either function. Web and mobile.",
  },
  {
    id: "platform.evaluation-tenant",
    title: "An evaluation tenant: one config file, a banner on every screen, and PHI fields locked by the database",
    state: "reachable",
    code: "src/lib/tenants/phi.ts#phiLockTriggersSqlite",
    test: "tests/evaluation-tenant.test.ts",
    note:
      "Handoff 11 package 1. The partner's settings are one file under src/lib/tenants, and a test refuses " +
      "the partner's name anywhere else in src. tenants.mode mirrors the config so the database can read it. " +
      "The PHI lock is a trigger per field (date of birth, external record number, the safe person's name " +
      "and contact), generated from one list for SQLite and written for Postgres, created after the table " +
      "rebuilds that would drop it; test:rls proves it on a real Postgres cluster. The onboarding form and " +
      "the mobile API do not send those fields in an evaluation tenant. pcp_viewer is a partner role, kept " +
      "out of the public handoff-07 personas, with no grant but its own summary; its page says the summary " +
      "is not built yet. Care managers sign in as clinicians and hold care_manager on their patients: the " +
      "handoff maps them to care_manager, which in this codebase is a care relationship, not a login.",
  },
  {
    id: "platform.pg-role-constraints-stale",
    title: "The Postgres schema's role constraints predate the demo roles",
    state: "proposed",
    code: null,
    test: null,
    note:
      "Found in Handoff 11 package 1, not fixed in passing. scripts/pg-schema.sql still allows users.role " +
      "'member', 'clinician' and the retired 'admin', and role_assignments the same plus care_manager; SQLite " +
      "has organization, payer, reviewer, demo_admin and now pcp_viewer. Part of the Postgres cutover: until " +
      "then every account but a member or clinician would be refused there.",
  },
  {
    id: "clinical.assigned-lane",
    title: "The clinician-assigned lane: built ahead of its gate, absent outside the demo, no protocol content",
    state: "reachable",
    code: "src/lib/assigned-lane.ts#laneGate",
    test: "tests/assigned-lane.test.ts",
    note:
      "Handoff 10 \u00a76 (CV10_E01 to E05, unsigned; for a partner's clinical lead). Built on the product " +
      "owner's instruction of 25 September, for a team to review and test, although \u00a76 parks it behind " +
      "Handoff 03's activation gate, a signed partner, licensed protocol content and the HIPAA/BAA/Postgres " +
      "work, none of which exist. Not a second module platform: assignments are rows in support_assignments " +
      "through the existing Assign support form; the three containers are Handoff 03 ModuleDefinitions in " +
      "state draft with no protocol content (the demo shows labelled placeholders). Lane rules: never " +
      "listed without a live assignment, which must have an end date; each start asks the existing engine " +
      "(steady tier, no crisis, no dissociation hold) and stores its decision; distress before and after, " +
      "flagging the assigning clinician on a rise of 3 or more or above 7; stop on every step at no cost. " +
      "Writing is encrypted, readable by the member and the assigning clinician only, with each clinician " +
      "read audited, and unreachable from every model path (tests/companion-excludes-assigned.test.ts). " +
      "Not built from Handoff 03: reminders (its Handoff 02 scheduler does not exist), the Response " +
      "Fingerprint and Return-to-Life adapters, the Command Center provider and the content-library GUI.",
  },
  {
    id: "clinical.path-review-mark",
    title: "The care team can record that a path's clinician review is done",
    state: "proposed",
    code: null,
    test: null,
    note:
      "Handoff 10 2A (CV10_D02) opens Feeling and Relating on the complex trauma readiness path 'only " +
      "when that path's clinician review is satisfied', and nothing in the app records such a review. " +
      "Until it does, the program is not offered on that path (the product owner's choice, 25 September). " +
      "Needs: a care-team action on the person record, audited and on the spine, naming the path and the " +
      "reviewer; programs.ts reads it where reviewedPathsFor returns an empty set today.",
  },
  {
    id: "clinical.program-text-crisis-prefilter",
    title: "What a member writes in a program is screened for crisis language before it is saved",
    state: "reachable",
    code: "src/lib/program-activities.ts#saveActivityEntry",
    test: "tests/activity-free-text.test.ts",
    note:
      "Handoff 10 \u00a73.4 (CV10_A15). The companion's own check runs over every free-text field; a " +
      "match saves nothing, raises an urgent alert and a coded safety event with none of the words, and " +
      "routes to the crisis page. Saved entries are enc1: at rest; the spine carries the kind and any " +
      "0\u201310 ratings only; ratings are not shown back outside Progress (B03); 'not this time' keeps no " +
      "reason; delete overwrites the words. Error messages are fixed codes, not text from the address " +
      "bar, so a crafted link cannot put a sentence on a member's screen.",
  },
  {
    id: "companion.suggest-practice-read-only",
    title: "The companion can suggest a practice it is allowed to, and write nothing",
    state: "reachable",
    code: "src/lib/companion-tools.ts#companionTools",
    test: "tests/companion-program-readonly.test.ts",
    note:
      "Handoff 10 \u00a73.5 (CV10_A16). suggest_practice is a read-tier tool that answers through the " +
      "member's own gated view of the practice, so it cannot surface something the member could not " +
      "open. No companion file names a program table, writer or reader. The suggestion reaches the " +
      "model as text; a tappable card in the chat waits for model-backed replies, which are off by " +
      "decision.",
  },
  {
    id: "member.account-deletion-coverage",
    title: "Deleting an account removes every member table",
    state: "proposed",
    code: null,
    test: null,
    note:
      "Found while adding the program tables. deleteAccount removes sessions, messages, memory, " +
      "triggers, check-ins, questionnaires, unlocks and alerts \u2014 and now program records and the " +
      "companion's suggestions \u2014 but not practice completions, lesson reads, screening progress, " +
      "program plans, care tracks and their intake, autopilot records or upsell events. The spine is " +
      "append-only, so a rebuild would also bring projected rows back. Closing it needs a decision on " +
      "erasure against the ledger, not another line in the list.",
  },
  {
    id: "clinical.h10-content-signed",
    title: "Handoff 10's skills, lessons and night practices, word for word as two psychologists signed them",
    state: "reachable",
    code: "src/lib/content-approval.ts#CONTENT_V10_APPROVAL",
    test: "tests/content-approval.test.ts",
    note:
      "Review STEADY-CLINREV-2026-09-24-10: Rebecca Altschuler, PhD and John Allen, PhD signed " +
      "approve-all for Lanes A to D (32 rows) with no exceptions; the founder signed Lane F; Lane E is " +
      "not signed. The record binds the approval to the SHA-256 of the content pack, the spec and the " +
      "signed form. The eighteen skills, eight lessons and two night practices are GENERATED from the " +
      "pack, and a test matches every member-facing string whole against it \u2014 its first version " +
      "matched substrings and let a truncated step through. Every skill's gate equals its " +
      "knowledge-base source's. A later needs-change verdict in the app still withdraws a row. Three " +
      "readings of rows answered without a choice are written into the record (B02, A04, C05).",
  },
  {
    id: "clinical.no-continue-at-high-distress",
    title: "Continuing after a distress pause waits for a fresh rating that allows it",
    state: "reachable",
    code: "src/lib/session-safety.ts#choicesAfterGrounding",
    test: "tests/distress-choice.test.ts",
    note:
      "Expansion Handoff Phase 0, member choice offered at high distress. After a pause (a rating " +
      "of 8, or a rise of 3) the grounding steps ended in 'I'm steadier \u2014 continue gently', with " +
      "no rating asked, so continuing was offered at the distress that had just paused the session; " +
      "'Ground me' returned the same way. One rule now decides every return: continue only on a " +
      "fresh rating the in-session rule would let through with the whole trail behind it; still in " +
      "the pause band offers more grounding; the hard-stop band ends the session. Stopping and " +
      "getting help are always offered. No new thresholds \u2014 the rule reaches the existing ones, " +
      "and a test proves the two agree for every rating. The resourcing exercise is bilateral " +
      "stimulation and is untouched under the v1 no-BLS rule; its between-set choice stops on " +
      "'less pleasant'.",
  },
  {
    id: "experience.no-clinical-labels-for-members",
    title: "Members read plain names, not instrument names or diagnostic terms",
    state: "reachable",
    code: "src/lib/instruments.ts#INSTRUMENTS",
    test: "tests/member-boundary.test.ts",
    note:
      "Expansion Handoff non-negotiable 6; Phase 0. Every questionnaire page was titled with the " +
      "instrument's clinical name ('PCL-5 \u2014 PTSD Checklist for DSM-5'), a member path was called " +
      "'PTSD & Trauma', a module description ended 'common in complex PTSD', and the phone app's " +
      "questionnaire list carried cutoffs and which item raises a risk alert. Each instrument now " +
      "has a member name, the path and module read plainly, and the phone list is a member-safe " +
      "shape. The walk then found the referral page listing instrument names, scores and the " +
      "hidden track name; the member now reads it in plain words with every item still listed " +
      "(product.referral-page-plain-words). " +
      "One term list feeds a source guard and a walk of every rendered member screen. The " +
      "program-fit questions still ask about diagnoses \u2014 that is a question, not a label, and its " +
      "wording awaits clinical sign-off.",
  },
  {
    id: "clinical.maintenance-language-held",
    title: "Maintenance words are written down, guarded, and held for review",
    state: "held",
    code: "src/lib/clinical/maintenance.ts#monitoringLanguageProblems",
    test: "tests/maintenance.test.ts",
    note:
      "The five transitions, the facts each must state, and the sentences a person would read are " +
      "written and guarded against the monitoring phrases that would promise attention nobody is " +
      "paying. HELD ON PURPOSE: the handoff's decision list says to approve the operating and " +
      "monitoring language before exposing it to patients, so the copy is readable on the " +
      "clinical-language review screen and no patient-facing surface imports it — a test walks " +
      "the member routes to keep that true. The state write and the return-to-active path are " +
      "not built, because they would be built on words nobody has signed.",
  },
  {
    id: "governance.claim-usage-ledger",
    title: "Every export or publication version that used a claim",
    state: "reachable",
    code: "src/lib/governance/claim-usage.ts#recordClaimUse",
    test: "tests/claim-usage.test.ts",
  },
  {
    id: "governance.failure-register",
    title: "Which failures something actually injects, and which nobody has tried",
    state: "reachable",
    code: "src/lib/governance/failure-register.ts#FAILURE_REGISTER",
    test: "tests/failure-register.test.ts",
  },
  {
    id: "platform.one-write-per-press",
    title: "A retried command replays its result instead of writing twice",
    state: "reachable",
    code: "src/lib/command-log.ts#runOnce",
    test: "tests/command-idempotency.test.ts",
  },
  {
    id: "platform.environment-generation",
    title: "A tab that predates a rebuild is refused rather than trusted",
    state: "reachable",
    code: "src/lib/environment-generation.ts#currentGeneration",
    test: "tests/environment-generation.test.ts",
  },
  {
    id: "platform.as-of-is-one-format",
    title: "A point-in-time read compares two timestamps in the same spelling",
    state: "reachable",
    code: "src/lib/events.ts#asOfBound",
    test: "tests/stale-evidence.test.ts",
  },
  {
    id: "clinical.conflict-says-what-changed",
    title: "A stale decision is told which of the two things moved",
    state: "reachable",
    code: "src/lib/clinical/row-version.ts#explainVersionChange",
    test: "tests/stale-evidence.test.ts",
  },
  {
    id: "clinical.two-people-one-name",
    title: "A record mark, only on the rows a reader could confuse",
    state: "reachable",
    code: "src/lib/clinical/disambiguate.ts#disambiguate",
    test: "tests/safety-failures.test.ts",
  },
  {
    id: "clinical.draft-belongs-to-its-person",
    title: "A draft cannot be saved against somebody else's record",
    state: "reachable",
    code: "src/lib/clinical/notes.ts#saveDraft",
    test: "tests/safety-failures.test.ts",
  },
  {
    id: "governance.release-definition",
    title: "The release definition, answered from the product rather than ticked",
    state: "reachable",
    code: "src/lib/review/release-definition.ts#RELEASE_DEFINITION",
    test: "tests/release-definition.test.ts",
  },
  {
    id: "governance.page-coverage-matrix",
    title: "Per-route evidence, derived, with the empty columns named",
    state: "reachable",
    code: "src/lib/review/page-coverage.ts#pageCoverage",
    test: "tests/page-coverage.test.ts",
  },
  {
    id: "ops.performance-measures-named",
    title: "Which of the release's seven performance measures this run actually covers",
    state: "reachable",
    code: "src/lib/performance/budget.ts#measureCoverage",
    test: "tests/performance-measures.test.ts",
  },
  {
    id: "clinical.between-visit-work-is-readable",
    title: "Contact attempts and assignments appear on the record they were written to",
    state: "reachable",
    code: "src/lib/clinical/care-history.ts#careHistory",
    test: "tests/care-history.test.ts",
  },
  {
    id: "ops.backups",
    title: "Nightly encrypted off-site backups",
    state: "held",
    code: "src/lib/backup.ts#runBackup",
    test: "tests/backup.test.ts",
    note:
      "NOW TESTED, STILL UNCONFIGURED, AND THE SECOND HALF IS WHY THIS IS STILL HELD. R2_* and " +
      "BACKUP_AGE_RECIPIENT are unset, so nothing runs in this deployment, and a whole-database " +
      "snapshot cannot honour per-participant terms (README §15.6c). " +
      "The register found on its first run that `runBackup` was named by no test at all — the code " +
      "standing between a lost disk and everything a pilot participant has told this product, with " +
      "nothing checking it. WHAT A BACKUP TEST HAS TO PROVE IS THAT IT RESTORES: \"the function " +
      "returned a key\" passes while the bytes are garbage and nobody finds out until the day " +
      "somebody needs them. So the test takes a real snapshot, encrypts it to a real age key, " +
      "decrypts it with the matching identity, opens the result as a database and reads a row " +
      "back. AND THAT IT NEVER WRITES PLAINTEXT — a snapshot of this database in the clear is " +
      "worse than no backup, because no backup loses the data and a plaintext one hands it to " +
      "whoever finds the file, and this database holds answers about suicidal thoughts and harm " +
      "urges. Five mutations caught, including writing the snapshot unencrypted and writing an " +
      "empty one.",
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
