// Handoff 09 §11's open decisions, and what was decided (2026-09-09).
//
// §11 is a table of questions the handoff refuses to answer for itself, each
// with a recommendation and a due package. Four were outstanding after Package
// 7 and all four are answered here. This module exists so the answers are in
// the code that implements them rather than in a commit message nobody will
// find, and so a surface can say what is still open without a person
// maintaining a second list by hand.
//
// A DECISION IS NOT A DESIGN. Two of these turn straight into behaviour (the
// horizon is held; the paused day says when it lifts) and are implemented where
// they belong. The other two are positions: one keeps a feature where it is
// under a stated condition, and one settles a question about work that has not
// been built. Recording all four the same way is the point — the next person
// reads one list, not four archaeologies.
//
// NO IMPORTS. Read by a server component and by tests; it holds decisions, not
// data.

export type DecisionState = "decided" | "open";

export interface OpenDecision {
  /** §11's own name for it, so the table and this list can be compared. */
  id: string;
  question: string;
  state: DecisionState;
  /** What was decided, in the words that make the next question answerable. */
  answer: string;
  /** Where the decision lives as behaviour, or why it has no code yet. */
  where: string;
  /** The date the decision was taken. A decision with no date is a preference. */
  decidedOn: string | null;
}

export const SECTION_11_DECISIONS: ReadonlyArray<OpenDecision> = [
  {
    id: "horizon_indicator",
    question:
      "Does the horizon indicator read as a covert score? §11: take it to moderated clinical review; remove it if it does.",
    state: "decided",
    answer:
      "Held behind the review rather than shipped or deleted. It renders nothing to a member until a moderated clinical review is recorded with a name and an evidence location. The element and its position maths stay whole and tested, so clearing the review is a one-line change and so is removal.",
    where:
      "src/lib/clinical/clinical-review-gate.ts (HORIZON_REVIEW), enforced in src/components/member/DayCanvas.tsx; reported on /review/status.",
    decidedOn: "2026-09-09",
  },
  {
    id: "ai_companion_placement",
    question:
      "The companion has no position in the Vol 2 session state machine. Where does it sit until one is defined?",
    state: "decided",
    answer:
      "It stays where it is, and §11's interim condition is met properly rather than nominally: entry states it is AI and names its communication limits, above the conversation instead of below it. The structural question — its position relative to the routing engine — is NOT answered here; choosing one is the founder decision §11 reserves. What is settled is the negative §11 does assert: it is not a step inside a session, because the state machine that defines those steps does not contain it.",
    where:
      "src/lib/experience/companion-entry.ts, rendered by src/components/experience/CompanionEntryNotice.tsx at both companion entries.",
    decidedOn: "2026-09-09",
  },
  {
    id: "paused_state_retention",
    question:
      "A member under a long exclusion faces weeks with no practice available. What does that surface offer?",
    state: "decided",
    answer:
      "It says when the pause lifts and what happens then — the one thing it never said. Three answers and no fourth: a real time where one exists, 'a person reopens this' where nothing expires on a timer, and 'Steady could not check' where the gate did not answer. None of the three names a reason, a criterion, or a threshold, because the day model discards the gate's reasons on purpose.",
    where:
      "src/lib/experience/member-day.ts (REOPENS_COPY, reopensLine), supplied by src/lib/member/day-read.ts, rendered by src/components/experience/MemberTodayView.tsx.",
    decidedOn: "2026-09-09",
  },
  {
    id: "referral_export_assembly",
    question:
      "Referral export: passive compilation (the Wysa pattern) or member curation?",
    state: "decided",
    answer:
      "Passive compilation. The system assembles the referral from what it already holds and tells the member what it contains, rather than asking them to curate at the moment of referral — which is usually the worst moment to ask somebody to curate. Built on that basis, with the condition honoured: the member reads the whole packet before anything could go anywhere. It still cannot be sent, and that is a fact about consent rather than plumbing — no scope in this product authorises disclosing a record outside it, and there is no destination.",
    where:
      "src/lib/clinical/referral-packet.ts (the compiler and the two limits), compiled by src/lib/clinical/referral-packet-store.ts, shown to the member at /app/settings/referral and described to a clinician at /clinician/referrals.",
    decidedOn: "2026-09-09",
  },
];

/** What is still open. Empty is a real and reportable answer. */
export function stillOpen(): ReadonlyArray<OpenDecision> {
  return SECTION_11_DECISIONS.filter((d) => d.state === "open");
}

/** A decision recorded without a date is a preference somebody stated, which is
 *  the failure this catches. */
export function properlyRecorded(d: OpenDecision): boolean {
  if (d.state === "open") return true;
  return (
    d.decidedOn !== null &&
    d.decidedOn.trim().length > 0 &&
    d.answer.trim().length > 0 &&
    d.where.trim().length > 0
  );
}
