// A fabricated transcription service, for demonstration and for tests.
//
// WHY THIS EXISTS. Phase 1 is unreviewable without it. A clinician reviewer
// opening the demo can press Record, speak for ninety seconds, and then be told
// no transcription provider is configured — which is honest and useless. The
// same argument that turned on resourcing BLS in demo applies here: a reviewer
// who cannot run the workflow cannot give feedback on it, and
// unusable-by-default is not a safety property when the data is fabricated.
//
// WHY IT CANNOT ESCAPE DEMO. A service that invents clinical text is the single
// most dangerous thing in this file's neighbourhood: outside a demonstration it
// would put words a clinician never said into a patient's record, attributed to
// that clinician, in a field the product treats as source evidence. So the
// selection is gated on EMDR_DEMO, the transcripts say what they are, and a
// guard fails the build if the gate is removed.
//
// WHAT IT IS NOT. It does not transcribe. It ignores the audio's content
// entirely and returns fabricated text chosen deterministically from the
// recording's length and bytes. The demo's value is in the WORKFLOW — record,
// read, correct, save — and that workflow is exercised identically whether the
// words came from a microphone or from this list.

import crypto from "node:crypto";
import { hashTranscript, type TranscriptionService, type TranscriptSpan } from "./transcription";

/** Fabricated post-session clinician thoughts.
 *
 *  Written to exercise the review screen honestly rather than to flatter it, so
 *  each one carries at least one of the things §4 and §9.2 care about: a hedge,
 *  a negation, a quoted patient statement, an approximate number, a named
 *  relationship. A fixture whose sentences are all clean declaratives would let
 *  a reviewer approve the feature having never seen the case it is built for.
 *
 *  The mis-heard words are deliberate too — "semed", "sleap" — because §3.2's
 *  whole promise is that the clinician can correct what Steady heard, and a
 *  transcript with nothing wrong in it never asks them to. */
const TRANSCRIPTS: Array<{ text: string; lowConfidence: Array<[number, number]> }> = [
  {
    text:
      "She semed steadier today. Not calm exactly, but she stayed in the room with it, "
      + "which she has not managed before. She said \"I keep waiting for it to go wrong\" — "
      + "her words, not mine. I think this might connect to the thing with her sister, but I "
      + "am not sure yet and I do not want to lead her there. Sleep is still poor, maybe four "
      + "hours. Follow up on the sleap next session.",
    lowConfidence: [[4, 9], [346, 351]],
  },
  {
    text:
      "Difficult session. He did not want to talk about the accident and I did not push. We "
      + "spent most of it on grounding — the cold water one, which he says works about half "
      + "the time. He mentioned his brother is staying with him now, which is new. Might be "
      + "part of why this week was harder, or might be helping. Too early to say.",
    lowConfidence: [],
  },
  {
    text:
      "Third session in a row where she has arrived late and apologised for it. Not reading "
      + "that as avoidance yet. Distress went from about a seven to a three during the set, "
      + "which is the biggest shift she has had. She used the cue word without being prompted. "
      + "I want to check whether the work thing is still active before we go further.",
    lowConfidence: [[213, 218]],
  },
  {
    text:
      "Short one. She cancelled and then called, so this is from the phone conversation rather "
      + "than a session. She sounded flat. Said she has not been doing the practice and "
      + "\"there is no point\" — I am recording that as her words because I do not want it "
      + "read as my assessment of her motivation. Worth a check-in before the next appointment.",
    lowConfidence: [],
  },
];

/** Deterministic: the same recording always produces the same transcript.
 *
 *  Keyed on the audio's own bytes rather than a counter or a clock, so a demo
 *  can be walked twice and read the same, and a test can assert on the text
 *  without pinning a call order. */
function pick(audio: Buffer): (typeof TRANSCRIPTS)[number] {
  const digest = crypto.createHash("sha256").update(audio).digest();
  return TRANSCRIPTS[digest[0] % TRANSCRIPTS.length];
}

/** The marker every fabricated transcript carries.
 *
 *  On the text itself, not beside it in the UI. A transcript is copied, quoted
 *  into a note draft, exported and read in an audit trail, and a label that
 *  lives in a component does not travel with it. §29's fabricated-data boundary
 *  is a property of the row for the same reason. */
export const FIXTURE_MARKER = "[Fabricated transcript — no audio was transcribed.]";

export const fixtureTranscription: TranscriptionService = {
  id: "fixture",

  async transcribe({ audio }) {
    if (audio.byteLength === 0) {
      return {
        ok: false, provider: "fixture", retryable: false,
        reason: "The recording was empty.",
      };
    }
    const chosen = pick(audio);
    const text = `${chosen.text}\n\n${FIXTURE_MARKER}`;
    const lowConfidence: TranscriptSpan[] = chosen.lowConfidence.map(([start, end]) => ({
      start, end, confidence: 0.42,
    }));
    return {
      ok: true,
      text,
      hash: hashTranscript(text),
      provider: "fixture",
      model: "fixture-transcripts-v1",
      language: "en",
      lowConfidence,
      // Reported from the audio rather than invented, so the duration a
      // clinician sees is the one they actually recorded.
      durationMs: null,
    };
  },
};
