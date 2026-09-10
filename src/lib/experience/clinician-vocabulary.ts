// The clinician action vocabulary, split out so a client component can read it.
//
// The fourth split of its kind in this codebase, and always for the same
// reason: a client component importing a module that reaches a store pulls
// better-sqlite3 into the browser bundle and the build stops. Words that appear
// on a screen belong on the client side of that line; the rules that use them
// stay on the server side.
//
// §5's four separated actions live here, and the SEPARATION is the content:
//
//   "Distinguish Open, Record contact, Assign, and Complete review. Opening is
//    not acknowledgement. Recording that an attempted contact occurred is not
//    proof of delivery."
//
// The row this replaces had one action whose label changed — "Review",
// "Contact", "Open" — and all three navigated to the same place. A clinician
// who pressed "Contact" had not contacted anybody. Each of these is now a
// distinct thing with a distinct effect, and only `open` navigates.

export const CLINICIAN_ACTIONS = ["open", "record_contact", "assign", "complete_review"] as const;
export type ClinicianAction = (typeof CLINICIAN_ACTIONS)[number];

export const ACTION_LABEL: Record<ClinicianAction, string> = {
  open: "Open",
  // Not "Contact". §5: "Recording that an attempted contact occurred is not
  // proof of delivery" — and a button labelled "Contact" implies the product
  // did the contacting.
  record_contact: "Record contact",
  assign: "Assign",
  complete_review: "Complete review",
};

/** What each one does, and — the part that matters — what it does not.
 *
 *  A clinician who has just pressed something should not have to wonder
 *  whether it reached anybody. There is no delivery path in this build, and
 *  every note here says so rather than leaving it to be discovered. */
export const ACTION_NOTE: Record<ClinicianAction, string> = {
  open: "Opens the record. Opening is not acknowledgement and changes nothing.",
  record_contact:
    "Records that you attempted contact, and what happened. It is not proof that anything was delivered.",
  assign: "Records who owns this. It does not notify them — there is no delivery path in this build.",
  complete_review: "Records that you have reviewed this and what you decided.",
};
