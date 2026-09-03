// A fabricated extraction service, for demonstration and for tests.
//
// The same argument as the transcription fixture beside it: Phase 2 is
// unreviewable without one. A clinician reviewer records a thought, reads the
// transcript, presses Organize, and is told no provider is configured — honest
// and useless. The workflow being reviewed is *read the candidates, keep the
// true ones, throw out the wrong ones, save*, and that workflow is exercised
// identically whether the candidates came from a model or from this file.
//
// IT DOES NOT EXTRACT. It recognises the fabricated transcripts by their text
// and returns candidates written for them by hand. Given anything else it
// returns nothing rather than guessing, because a fixture that invented items
// for real clinical text would be putting fabricated claims into a patient's
// record — the one outcome this whole feature is built to prevent.
//
// WHY THE CANDIDATES ARE NOT ALL CORRECT. Two of them are deliberately wrong in
// the way a real extractor is wrong: a hedge promoted a little too confidently,
// and a detail attributed to the wrong speaker. A reviewer who only ever sees
// candidates worth approving never exercises Reject, and never finds out
// whether the screen makes a bad candidate easy to spot. §17's whole posture is
// that the clinician is the decision-maker; a fixture that is always right
// quietly demonstrates the opposite.
//
// OFFSETS ARE FOUND, NOT WRITTEN DOWN. Each candidate names the phrase it comes
// from and the offsets are located in the transcript at call time. So the
// citations are genuinely correct rather than correct-looking — and if the
// clinician has corrected the transcript, the phrase is no longer found and the
// item honestly arrives without a citation, which is exactly what §9.2 asks a
// real extractor to do when it cannot guarantee offsets.

import { quoteHash, type ExtractionItem, type ItemType, type StatementClass, type ThoughtExtractionV1 } from "./extraction-contract";
import { FIXTURE_MARKER } from "./transcription-fixture";

interface FixtureItem {
  /** The exact phrase in the transcript this item comes from. */
  quote: string;
  itemType: ItemType;
  statementClass: StatementClass;
  displayText: string;
  normalizedLabel: string | null;
  numericFacts?: { name: string; value: number; unit?: string; approximate?: boolean }[];
}

/** Keyed by a distinctive phrase from each fabricated transcript. Matching on
 *  content rather than on an index means a reordering of the transcript list
 *  cannot silently attach one transcript's items to another.
 *
 *  THE MARKER MUST AVOID THE DELIBERATE MIS-HEARINGS. The transcripts carry
 *  "semed" and "sleap" precisely so a clinician has something to correct — so
 *  keying a fixture on a phrase containing one is keying it on the words most
 *  likely to change. The first version did exactly that, and the effect was a
 *  demo that dead-ended: fix the typo, press re-organize, and the fixture no
 *  longer recognised its own transcript, so organizing failed for what looked
 *  like no reason. Every marker below is a phrase with nothing wrong in it. */
const FIXTURES: Array<{ marker: string; items: FixtureItem[] }> = [
  {
    marker: "but she stayed in the room with it",
    items: [
      {
        quote: "she stayed in the room with it, which she has not managed before",
        itemType: "observation",
        statementClass: "clinician_observation",
        displayText: "Stayed present with the material; has not managed this before.",
        normalizedLabel: "tolerance of distress in session",
      },
      {
        quote: "\"I keep waiting for it to go wrong\"",
        itemType: "symptom",
        statementClass: "patient_report",
        displayText: "\"I keep waiting for it to go wrong\" — patient's own words.",
        normalizedLabel: "anticipatory dread",
      },
      {
        quote: "I think this might connect to the thing with her sister, but I am not sure yet",
        itemType: "clinician_hypothesis",
        statementClass: "clinician_hypothesis",
        displayText: "Possible connection to the material about her sister. Not established.",
        normalizedLabel: "sibling relationship",
      },
      {
        quote: "I do not want to lead her there",
        itemType: "clinician_uncertainty",
        statementClass: "clinician_uncertainty",
        displayText: "Holding back from naming the connection so as not to lead.",
        normalizedLabel: null,
      },
      {
        quote: "Sleep is still poor, maybe four hours",
        itemType: "symptom",
        statementClass: "clinician_observation",
        displayText: "Sleep remains poor — around four hours.",
        normalizedLabel: "sleep",
        // "maybe four hours" — approximate, and marked as such. An approximate
        // four recorded as an exact four is a number the clinician never gave.
        numericFacts: [{ name: "sleep_hours", value: 4, unit: "hours", approximate: true }],
      },
      {
        quote: "Follow up on the sleap next session",
        itemType: "follow_up",
        statementClass: "clinician_observation",
        displayText: "Follow up on sleep next session.",
        normalizedLabel: "sleep",
      },
    ],
  },
  {
    marker: "Difficult session. He did not want to talk about the accident",
    items: [
      {
        // The negation is the content. "Did not want to talk about the
        // accident" must not become "talked about the accident", and it must
        // not become "avoidant" either — one is a fact, the other a judgement.
        quote: "He did not want to talk about the accident and I did not push",
        itemType: "observation",
        statementClass: "clinician_observation",
        displayText: "Did not want to discuss the accident; not pushed.",
        normalizedLabel: "the accident",
      },
      {
        quote: "the cold water one, which he says works about half the time",
        itemType: "intervention_response",
        statementClass: "patient_report",
        displayText: "Reports the cold-water grounding technique works about half the time.",
        normalizedLabel: "grounding — cold water",
      },
      {
        quote: "his brother is staying with him now, which is new",
        itemType: "person_relationship",
        statementClass: "patient_report",
        displayText: "Brother is currently staying with him — new circumstance.",
        normalizedLabel: "brother",
      },
      {
        quote: "Might be part of why this week was harder, or might be helping. Too early to say",
        itemType: "clinician_uncertainty",
        statementClass: "clinician_uncertainty",
        displayText: "Unclear whether the brother staying is a stressor or a support.",
        normalizedLabel: "brother",
      },
    ],
  },
  {
    marker: "Third session in a row where she has arrived late",
    items: [
      {
        quote: "she has arrived late and apologised for it",
        itemType: "observation",
        statementClass: "clinician_observation",
        displayText: "Third consecutive session arriving late, with an apology each time.",
        normalizedLabel: "session attendance",
      },
      {
        // DELIBERATELY WRONG, and the reviewer should reject it. The transcript
        // says "not reading that as avoidance YET" — a hypothesis explicitly
        // withheld. Filed here as an observation, which is precisely the
        // promotion §4 warns about and the thing the review screen exists to
        // catch. The validator cannot refuse this one: the type and class are
        // coherent with each other, and only a reader who knows the transcript
        // can see it is wrong.
        quote: "Not reading that as avoidance yet",
        itemType: "observation",
        statementClass: "clinician_observation",
        displayText: "Lateness reflects avoidance.",
        normalizedLabel: "avoidance",
      },
      {
        quote: "Distress went from about a seven to a three during the set",
        itemType: "intervention_response",
        statementClass: "clinician_observation",
        displayText: "Distress fell from about 7 to about 3 across the set — largest shift so far.",
        normalizedLabel: "distress during processing",
        numericFacts: [
          { name: "distress_start", value: 7, approximate: true },
          { name: "distress_end", value: 3, approximate: true },
        ],
      },
      {
        quote: "She used the cue word without being prompted",
        itemType: "intervention_response",
        statementClass: "clinician_observation",
        displayText: "Used the cue word unprompted.",
        normalizedLabel: "cue word",
      },
      {
        quote: "I want to check whether the work thing is still active",
        itemType: "follow_up",
        statementClass: "clinician_observation",
        displayText: "Check whether the work situation is still active before going further.",
        normalizedLabel: "work situation",
      },
    ],
  },
  {
    marker: "She cancelled and then called",
    items: [
      {
        quote: "this is from the phone conversation rather than a session",
        itemType: "event",
        statementClass: "clinician_observation",
        displayText: "Contact was a phone conversation after a cancellation, not a session.",
        normalizedLabel: "contact type",
      },
      {
        quote: "Said she has not been doing the practice",
        itemType: "intervention_response",
        statementClass: "patient_report",
        displayText: "Reports not having done the between-session practice.",
        normalizedLabel: "between-session practice",
      },
      {
        quote: "\"there is no point\"",
        itemType: "symptom",
        statementClass: "patient_report",
        displayText: "\"there is no point\" — patient's own words, recorded as hers.",
        normalizedLabel: "hopelessness",
      },
      {
        // DELIBERATELY WRONG in the second way a real extractor is wrong: the
        // clinician says explicitly that they do NOT want this read as their
        // assessment of her motivation, and here it is as exactly that.
        quote: "I do not want it read as my assessment of her motivation",
        itemType: "observation",
        statementClass: "clinician_observation",
        displayText: "Clinician assesses motivation as low.",
        normalizedLabel: "motivation",
      },
    ],
  },
];

export const FIXTURE_EXTRACTION_MODEL = "fixture-extraction-v1";

/**
 * Candidates for a fabricated transcript, or null when the text is not one.
 *
 * Null rather than an empty extraction, because "this is not a transcript I
 * know" and "I read this transcript and found nothing in it" are different
 * answers and the caller has to be able to tell them apart.
 */
export function fixtureExtraction(transcriptId: string, transcriptText: string): ThoughtExtractionV1 | null {
  // Only ever for text this module produced. A transcript without the marker
  // is either real or corrected beyond recognition, and inventing clinical
  // items for either would be the exact harm the feature is built to prevent.
  if (!transcriptText.includes(FIXTURE_MARKER)) return null;

  const fixture = FIXTURES.find((f) => transcriptText.includes(f.marker));
  if (!fixture) return null;

  const items: ExtractionItem[] = fixture.items.map((item, i) => {
    // Located at call time. A clinician who corrected the wording will have
    // moved or removed the phrase, and the item then arrives with no citation
    // rather than a citation pointing at the wrong words.
    const start = transcriptText.indexOf(item.quote);
    const found = start >= 0;
    const end = found ? start + item.quote.length : -1;
    return {
      tempId: `fx-${i + 1}`,
      itemType: item.itemType,
      statementClass: item.statementClass,
      displayText: item.displayText,
      normalizedLabel: item.normalizedLabel,
      sourceStart: found ? start : null,
      sourceEnd: found ? end : null,
      sourceQuoteHash: found ? quoteHash(transcriptText.slice(start, end)) : null,
      ...(item.numericFacts ? { numericFacts: item.numericFacts } : {}),
    };
  });

  return { schemaVersion: "1", transcriptId, items };
}
