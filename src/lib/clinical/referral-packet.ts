// The referral packet: what leaves, what does not, and what has to be true
// first (handoff 09 §11's referral-export decision).
//
// §11 asked whether a referral export is assembled by the system or curated by
// the member, and the answer recorded on 2026-09-09 was PASSIVE COMPILATION:
// the system assembles the referral from what it already holds and tells the
// member what it contains, rather than asking them to curate at the moment of
// referral — which is usually the worst moment to ask somebody to curate.
//
// So this file is the compiler and, more importantly, the two limits on it.
//
// LIMIT ONE: A PACKET CARRIES NO PROSE. Every field is a code, a number, a date
// or a short label from a fixed vocabulary. Not because free text is untidy —
// because a referral packet is the one artefact in this product that leaves it,
// and the things a member wrote are the things they wrote to Steady. A
// companion message, a saved thought, a clinician's note and a session
// transcript are all excluded BY CONSTRUCTION and named on the screen, so the
// member reads what is in it and what is not.
//
// LIMIT TWO: NOTHING IS DISCLOSABLE YET, and that is a fact about consent
// rather than about plumbing. Three consent scopes exist in this product —
// care_program_full, measurement and processing_session — and not one of them
// authorises sending a person's record to somebody outside it. A packet can
// therefore be compiled and shown TO THE MEMBER, whose own record it is, and
// cannot be disclosed to anybody. `mayDisclose` says so and returns false, and
// the refusal names the scope that would have to exist.
//
// The decision unblocked this work. It did not make the consent exist.

export type SectionKind = "consent" | "measures" | "safety" | "engagement" | "program";

/** The value kinds a packet field may hold. A sentence matches none of them. */
export type FieldShape = "code" | "count" | "score" | "date" | "label";

export interface PacketField {
  label: string;
  shape: FieldShape;
  value: string;
  /** Where this came from, in words the member can check. */
  source: string;
}

export interface PacketSection {
  kind: SectionKind;
  title: string;
  /** Why a receiving clinician would need this. A section that cannot say why
   *  it is in a disclosure does not belong in one. */
  why: string;
  fields: PacketField[];
  /** Set when the section has nothing in it, saying why. An empty section that
   *  says nothing reads as "this person has none of this", which is a claim. */
  absent: string | null;
}

/** What never enters a packet, whatever else changes. Named on the screen, so
 *  "we do not send your conversations" is checkable rather than reassuring. */
export interface ExcludedKind {
  what: string;
  why: string;
}

export const NEVER_INCLUDED: ExcludedKind[] = [
  {
    what: "Anything the member wrote to Steady",
    why:
      "Companion messages, saved thoughts and journal entries were written to this product, " +
      "not to a stranger. A packet that carried them would disclose the one place somebody " +
      "was candid because it was not going anywhere.",
  },
  {
    what: "Session content",
    why:
      "What came up during processing is the material of the work, not a summary of it. A " +
      "receiving clinician needs to know a session happened and how it closed; the content " +
      "is between the member and whoever they choose to tell.",
  },
  {
    what: "Clinician notes and review rationales",
    why:
      "Written by a clinician about a member, for a record the member did not compose. They " +
      "belong to the chart and travel by a different route, with the member's knowledge.",
  },
  {
    what: "The reasons behind a safety decision",
    why:
      "The packet reports the state the safety engine is in, not the rules that got it " +
      "there. A rule id in a disclosure invites a reader to re-derive a judgement they " +
      "cannot see the inputs for.",
  },
  {
    what: "Any free text at all",
    why:
      "Enforced by shape rather than by review: every field is a code, a count, a score, a " +
      "date or a label from a fixed vocabulary, and `assertShape` refuses anything else " +
      "before the packet is assembled.",
  },
];

/** The consent scope a disclosure would need. It does not exist in this
 *  product, which is the point — naming it is what makes its absence legible. */
export const DISCLOSURE_SCOPE = "referral_disclosure";

/** The scopes that DO exist, and what each one authorises. None of them covers
 *  sending a person's record outside this product. */
export const EXISTING_SCOPES: Array<{ scope: string; authorises: string }> = [
  { scope: "care_program_full", authorises: "Running the care program inside Steady." },
  { scope: "measurement", authorises: "Recording and reading validated measures inside Steady." },
  { scope: "processing_session", authorises: "Running a self-administered processing session." },
];

export class PacketRefused extends Error {}

const CODE = /^[a-z0-9_]{1,48}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9 .,'()/–-]{0,60}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function shapeAllowed(shape: FieldShape, value: string): boolean {
  switch (shape) {
    case "code": return CODE.test(value);
    case "count": return /^\d{1,6}$/.test(value);
    case "score": return /^\d{1,3}(\/\d{1,3})?$/.test(value);
    case "date": return DATE.test(value);
    // The loosest shape, and still not prose: one line, no sentence-ending
    // punctuation, capped short enough that a paragraph cannot fit.
    case "label": return LABEL.test(value) && !/[.!?]\s/.test(value);
  }
}

/** Refuses a field whose value does not fit its shape. Throws rather than
 *  trimming: a truncated sentence in a disclosure is still a sentence that
 *  left, and it looks like it worked. */
export function assertShape(field: PacketField): void {
  if (!shapeAllowed(field.shape, field.value)) {
    throw new PacketRefused(
      `${field.label} must be a ${field.shape}. A value of that shape can carry text a ` +
      "referral packet may not disclose."
    );
  }
}

/**
 * Assemble a packet from sections that were built elsewhere.
 *
 * PASSIVE, which is §11's answer: nothing here asks the member to choose, and
 * there is no parameter by which they could. What they get instead is the whole
 * contents, before anything is sent, in a form they can read.
 */
export function compile(args: {
  personId: string;
  sections: PacketSection[];
  compiledAt: string;
  /** The consent scopes on file for this person. */
  scopes: string[];
}): ReferralPacket {
  for (const section of args.sections) {
    if (!section.why.trim()) {
      throw new PacketRefused(`the ${section.kind} section does not say why it is in a disclosure`);
    }
    if (section.fields.length === 0 && !section.absent) {
      throw new PacketRefused(`the ${section.kind} section is empty and does not say why`);
    }
    for (const f of section.fields) assertShape(f);
  }
  const disclosable = mayDisclose(args.scopes);
  return {
    personId: args.personId,
    compiledAt: args.compiledAt,
    sections: args.sections,
    excluded: NEVER_INCLUDED,
    disclosable,
    refusal: disclosable ? null : refusalText(),
  };
}

export interface ReferralPacket {
  personId: string;
  compiledAt: string;
  sections: PacketSection[];
  excluded: ExcludedKind[];
  disclosable: boolean;
  refusal: string | null;
}

/** Whether this packet may leave. It may not, and the reason is the consent
 *  record rather than the code: no scope on file authorises a disclosure. */
export function mayDisclose(scopes: string[]): boolean {
  return scopes.includes(DISCLOSURE_SCOPE);
}

export function refusalText(): string {
  return (
    "This packet cannot be sent. Disclosing a record outside Steady would need a consent " +
    `recorded under the scope “${DISCLOSURE_SCOPE}”, and no such scope exists in this ` +
    "product — the three that do authorise running the care program, recording measures, " +
    "and running a session, none of which is a disclosure. There is also no destination to " +
    "send it to. Both are absences, and neither is worked around here."
  );
}
