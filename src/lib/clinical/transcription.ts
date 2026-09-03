// Transcription, behind a provider-neutral interface (§13).
//
// §9 permits exactly this shape: "If the gateway has not landed when
// implementation begins, Phase 1 may ship transcription behind a
// provider-neutral interface, but structured model tasks must wait for or land
// with the gateway." The gateway HAS landed, and transcription still belongs
// here rather than as a gateway task — the gateway's contract is a prompt, a
// system message and a structured output, and audio-to-text has none of those.
// Forcing it through `invoke()` would mean inventing a fake prompt for a call
// that has no prompt, which makes the inference ledger less true, not more.
//
// The structured task that DOES follow — turning this transcript into candidate
// memory items — is a gateway task, and it is Phase 2.
//
// WHAT THE INTERFACE INSISTS ON.
//
//   A VERIFIABLE TRANSCRIPT. §13's verification row: "Hash transcript; store
//   provider/model/version and confidence metadata." The hash is what proves
//   which text a later extraction ran against, and what detects a transcript
//   changing under a stale browser tab (§14.1's conflict rule). Computed here,
//   from the text, so it cannot disagree with what was stored.
//
//   LOW CONFIDENCE THAT REACHES THE CLINICIAN. §13: "Low-confidence spans shown
//   to clinician", and §17.4's copy: "A few words may need review. Check the
//   highlighted transcript before saving." A provider that reports per-span
//   confidence has somewhere to put it; one that does not returns an empty list
//   rather than a fabricated confident one.
//
//   A RETRYABLE FAILURE IS DIFFERENT FROM A DEAD ONE. §13's failure row: "If
//   provider fails, keep audio and mark retryable." A timeout and a rejected
//   audio format are not the same event, and only the first is worth trying
//   again — so the result says which it was rather than leaving a retry loop to
//   guess from an error string.

import crypto from "node:crypto";

export interface TranscriptSpan {
  /** Character offsets into the transcript text. */
  start: number;
  end: number;
  /** 0–1. Below `LOW_CONFIDENCE` the span is surfaced for review. */
  confidence: number;
}

export interface TranscriptionSuccess {
  ok: true;
  text: string;
  /** sha256 of the text. The identity of this exact version. */
  hash: string;
  provider: string;
  model: string | null;
  language: string | null;
  /** Spans the provider was unsure about. Empty when it reports no per-span
   *  confidence — empty because none were reported, never because none exist. */
  lowConfidence: TranscriptSpan[];
  durationMs: number | null;
}

export interface TranscriptionFailure {
  ok: false;
  provider: string;
  reason: string;
  /** Worth another attempt: a timeout, a 5xx, a rate limit. False for a
   *  rejected format or an empty recording, where retrying just fails again. */
  retryable: boolean;
}

export type TranscriptionResult = TranscriptionSuccess | TranscriptionFailure;

export interface TranscriptionService {
  id: string;
  transcribe(args: {
    audio: Buffer;
    contentType: string;
    /** A hint, never an assertion. A provider may detect otherwise. */
    languageHint?: string;
  }): Promise<TranscriptionResult>;
}

/** Below this, a span is highlighted for the clinician (§13, §17.4). */
export const LOW_CONFIDENCE = 0.7;

export function hashTranscript(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/** Spans worth showing, given a provider's own confidence numbers. */
export function lowConfidenceSpans(spans: TranscriptSpan[]): TranscriptSpan[] {
  return spans.filter((s) => s.confidence < LOW_CONFIDENCE);
}

// ---------------------------------------------------------------------------
// The unconfigured default
// ---------------------------------------------------------------------------

/** No transcription provider is configured.
 *
 *  It FAILS RETRYABLY rather than returning empty text, and the difference
 *  matters: empty text is a transcript, and a transcript moves the thought to
 *  `review`, where a clinician would be shown a blank page and told to check
 *  it. A retryable failure leaves the audio in place and the thought in
 *  `processing`, which is what is actually true — nothing has transcribed it
 *  yet, and something might.
 *
 *  A deployment without a provider therefore keeps recordings safe instead of
 *  silently discarding what was said. */
export const unconfiguredTranscription: TranscriptionService = {
  id: "unconfigured",
  async transcribe() {
    return {
      ok: false,
      provider: "unconfigured",
      reason: "No transcription provider is configured for this environment.",
      retryable: true,
    };
  },
};

let active: TranscriptionService = unconfiguredTranscription;

export function transcriptionService(): TranscriptionService {
  return active;
}

export function setTranscriptionService(s: TranscriptionService): () => void {
  const previous = active;
  active = s;
  return () => { active = previous; };
}
