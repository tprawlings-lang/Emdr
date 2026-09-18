// What happens to something a clinician says, and where it is at each point
// (17 September handoff, P4).
//
//   "Thoughts — separate capture, review, approved memory, and Ask. User knows
//   what is private, proposed, approved, or filed."
//
// The four SURFACES were already separate: a recorder, a transcript list, kept
// items, themes, and Ask each have their own panel with its own footnote. What
// the page never said in one place is the thing those footnotes each say a
// corner of — which of the four STATES a given piece of thinking is in, and
// what that means for who can read it.
//
// A clinician had to assemble the answer from five footnotes spread down a long
// page: "a thought is not a formal note", "this is the record, not the
// transcript", "nothing here is shown to the patient", "a draft built from it
// still needs you to review and sign it". Each is true. Together they are a
// state machine nobody wrote down.
//
// AND THE FOURTH STATE IS ONE THIS PRODUCT CANNOT OBSERVE. "Filed" means the
// words reached a signed clinical note — and the note bridge assembles a draft,
// stores it nowhere, and hands it over as text for the clinician to paste into
// the record system of truth. Nothing comes back. So an item that was filed
// last week and one that has never left this page look identical here, and they
// always will until something links the two.
//
// SAYING THAT IS THE POINT. The alternative is a badge that means "we think
// so", which is the kind of claim the rest of this codebase spends its length
// refusing. A state the product cannot see is named, marked as unobservable,
// and left to the clinician — rather than guessed at, or quietly dropped from
// the list so nobody notices it is missing.

export type ThoughtState = "private" | "proposed" | "approved" | "filed";

export const THOUGHT_STATES: ThoughtState[] = ["private", "proposed", "approved", "filed"];

export interface ThoughtStateMeaning {
  state: ThoughtState;
  /** What it is called on screen. */
  label: string;
  /** What it means, in one sentence. */
  means: string;
  /** Who can read it. The question a clinician is actually asking. */
  readableBy: string;
  /** Where it is on this page, or elsewhere. */
  where: string;
  /**
   * Whether Steady can tell you an item is in this state.
   *
   * False for `filed`, and the reason is structural rather than a gap in the
   * screen: the draft leaves as text and nothing reports back.
   */
  observable: boolean;
}

export const THOUGHT_LIFECYCLE: readonly ThoughtStateMeaning[] = [
  {
    state: "private",
    label: "Private",
    means:
      "A working note you recorded or typed. It is yours, and nothing has been decided from it yet.",
    readableBy:
      "People with access to this patient's record. Not the patient, and not part of the clinical record.",
    where: "Recorded thoughts, on this page.",
    observable: true,
  },
  {
    state: "proposed",
    label: "Proposed",
    means:
      "Something Steady pulled out of a working note and is asking you about. A proposal is not evidence until you answer it.",
    readableBy: "You, until you accept or reject it.",
    where: "In the review of a thought, before it is kept.",
    observable: true,
  },
  {
    state: "approved",
    label: "Approved",
    means:
      "An item you decided was true, kept in the form you kept it, with the thought it came from still attached.",
    readableBy: "People with access to this patient's record. Still not the patient.",
    where: "Kept items, on this page.",
    observable: true,
  },
  {
    state: "filed",
    label: "Filed",
    means:
      "The words reached a signed clinical note. A signature is yours to give, and this product cannot give it.",
    readableBy: "Whoever can read the record system it was filed in.",
    // THE HONEST ANSWER, not a badge. The note draft is assembled on the way to
    // a screen, stored nowhere, and copied out as text — so nothing reports
    // back that it landed, and an item filed last week looks exactly like one
    // that never left this page.
    where:
      "Outside Steady. Nothing here can tell you whether an item was filed: a draft leaves as text and nothing comes back.",
    observable: false,
  },
] as const;

export function meaningOf(state: ThoughtState): ThoughtStateMeaning {
  return THOUGHT_LIFECYCLE.find((m) => m.state === state)!;
}

/** The states this product can actually report on. */
export function observableStates(): ThoughtState[] {
  return THOUGHT_LIFECYCLE.filter((m) => m.observable).map((m) => m.state);
}

/** How a stored memory status maps onto the states above.
 *
 *  `rejected` and `superseded` are real statuses and are deliberately NOT
 *  states in this list: a rejected item is a question that was answered no, and
 *  a superseded one is an earlier version of an approved item. Neither is a
 *  place a piece of thinking sits — they are things that happened to it — and
 *  folding them in would turn a four-state lifecycle into a six-row table
 *  nobody reads. */
export function stateOfMemoryStatus(status: string): ThoughtState | null {
  if (status === "candidate") return "proposed";
  if (status === "approved") return "approved";
  return null;
}
