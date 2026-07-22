import { autonomousSafetyEnabled } from "./safety/config";

// Versioned policy identifiers. Bump a version whenever its text changes so
// the consent ledger stays meaningful (who agreed to what, when).
//
// Legal text in this file and in /terms and /privacy was reviewed and
// approved by counsel on 2026-06-10 (per founder). Any wording change
// requires re-review and a version bump.
//
// TWO SETS OF VERSIONS live here on purpose. The `*_AUTONOMOUS` set is the
// counsel-approved (2026-07, per founder's attorney) rewrite for the model
// where fixed automated rules — not a human reviewer — decide fit, daily
// availability, and module unlocks. It ships ATOMICALLY with the
// `EMDR_AUTONOMOUS_SAFETY` flag: while a human is still in the loop the
// current "human review" copy is accurate and stays live; the moment the
// flag flips, the selectors below serve the autonomous copy and the ledger
// records the autonomous version. Never diverge the served copy from the
// recorded version — always go through the selectors.
export const CONSENT_VERSION = "v2.0-wellness";
export const TERMS_VERSION = "tos-v2.0";
export const PRIVACY_VERSION = "privacy-v1.0";

export const CONSENT_VERSION_AUTONOMOUS = "v3.0-autonomous";
export const TERMS_VERSION_AUTONOMOUS = "tos-v3.0-autonomous";
export const PRIVACY_VERSION_AUTONOMOUS = "privacy-v2.0-autonomous";

// Reworded "Safety review model" consent body for the autonomous model.
const SAFETY_REVIEW_MODEL_AUTONOMOUS =
  "Steady's safety rails are automated and asynchronous. Fit questions decide whether the program is safe to start, daily check-ins decide what is open today, sessions pause or end themselves when distress climbs, and higher-intensity modules unlock automatically — only when fixed readiness and safety rules are met. No one reviews your readiness by hand and no one is watching live. If the rules cannot clear you, or you repeatedly reach a safety stop, you are routed to human support and crisis resources. You can always see the plain-language reason for any limitation.";

export const CONSENT_SECTIONS: { title: string; body: string }[] = [
  {
    title: "What this service is — and is not",
    body: "Steady is a self-guided wellness program for adults, built around the EMDR method, for processing difficult memories and reducing emotional intensity. It is software: it guides sessions, paces you with daily check-ins, and remembers what helps. It is not therapy, medical care, or a substitute for professional treatment; it does not diagnose or treat any condition; and using it does not create a clinician-patient relationship with anyone.",
  },
  {
    title: "Safety review model",
    body: "Steady's safety rails are automated and asynchronous. Fit questions decide whether the program is safe to start, daily check-ins decide what is open today, sessions pause or end themselves when distress climbs, and higher-intensity modules unlock only after human review of your readiness. Review is not real-time monitoring: no one is watching live, and response times are not immediate.",
  },
  {
    title: "Emergency limitations",
    body: "Steady is NOT for emergencies and is not monitored in real time. If you are in immediate danger or thinking about harming yourself or someone else, call or text 988 (Suicide & Crisis Lifeline, US), call 911, or go to the nearest emergency room. The app always shows these options when safety screens are positive.",
  },
  {
    title: "Privacy and your information",
    body: "What you enter — check-ins, ratings, triggers, your safety plan, companion conversations — is sensitive personal information. It is encrypted, never shared with advertisers, and never used for marketing. Companion messages are processed by an AI service provider to generate replies. You can view and delete what the companion remembers anytime, and you can delete your account and data yourself, without giving a reason.",
  },
  {
    title: "Fees",
    body: "Steady is a monthly membership with a free trial. Payment details are handled by a payment processor and kept separate from your program data — your bank statement says only 'Steady membership.' Cancel anytime from billing settings in two clicks. If the fit questions screen you out after you have paid, the charge is refunded automatically.",
  },
  {
    title: "Tracking disclosure",
    body: "We do not use advertising trackers, analytics pixels, or session-replay tools anywhere in the app. We collect only the technical data needed to run the service securely (such as login events and security logs), and we log safety events as coded entries for audit purposes — never the content of what you wrote.",
  },
  {
    title: "Your rights and choices",
    body: "You can stop any session at any time — stopping early is always allowed and never penalized. You can pause or end the program, export nothing you didn't enter, revoke this consent, and delete your account and data on your own from settings. Revoking consent stops new program activity; deleting your account removes your data immediately, except records we are legally required to keep (such as payment history).",
  },
];

// The autonomous consent set is the approved copy with only the "Safety review
// model" section reworded — every other section is unchanged from the current,
// counsel-approved copy.
export const CONSENT_SECTIONS_AUTONOMOUS: { title: string; body: string }[] =
  CONSENT_SECTIONS.map((section) =>
    section.title === "Safety review model"
      ? { ...section, body: SAFETY_REVIEW_MODEL_AUTONOMOUS }
      : section,
  );

// --- Selectors: always resolve the served copy + recorded version together.
// Consumers (onboarding, /terms, /privacy, consent ledger writes) MUST use
// these rather than the raw constants so served text and recorded version can
// never drift apart when the flag flips.

/** True when the autonomous copy/versions are the live set. */
export function autonomousCopyActive(): boolean {
  return autonomousSafetyEnabled();
}

export function currentConsentVersion(): string {
  return autonomousCopyActive() ? CONSENT_VERSION_AUTONOMOUS : CONSENT_VERSION;
}

export function currentTermsVersion(): string {
  return autonomousCopyActive() ? TERMS_VERSION_AUTONOMOUS : TERMS_VERSION;
}

export function currentPrivacyVersion(): string {
  return autonomousCopyActive() ? PRIVACY_VERSION_AUTONOMOUS : PRIVACY_VERSION;
}

export function currentConsentSections(): { title: string; body: string }[] {
  return autonomousCopyActive() ? CONSENT_SECTIONS_AUTONOMOUS : CONSENT_SECTIONS;
}

// ── Voice / biometric consent (DRAFT — counsel review pending) ──────────────
// A DISTINCT, explicit opt-in required before voice input or live spoken
// sessions may be offered to a real member (they are demo-only until then).
// Voice can be "biometric" information under some laws (e.g. Illinois BIPA,
// Washington My Health My Data, Texas CUBI), so it is not folded into the main
// care-program consent — it is its own gate, recorded under scope
// "voice_biometric". NOT wired into a live gate yet; ships with the voice/live
// flags after counsel sign-off. Bump the version on any wording change.
export const VOICE_CONSENT_VERSION = "voice-consent-v1.0-draft";

export const VOICE_CONSENT_SECTIONS: { title: string; body: string }[] = [
  {
    title: "What you're turning on",
    body: "Voice lets you speak instead of type. In guided sessions, you can also turn on hands-free listening, and Steady will respond to what you say out loud. This is completely optional — typing and tapping always work exactly the same, and nothing here is required to use the program.",
  },
  {
    title: "Your voice, and how it is handled",
    body: "When you speak, your device turns your speech into text. In the shipped mobile app that transcription happens on your device and the audio never leaves your phone — Steady receives only the text. (In the web preview, your browser's built-in speech recognition may process the audio; Steady still receives only text, never a recording.) We keep only the text, encrypted like anything else you write. We do NOT create a voiceprint, we do NOT use your voice to identify you, and we do NOT use your voice or its text to train anyone's AI.",
  },
  {
    title: "This may count as biometric information",
    body: "Some laws treat your voice as sensitive biometric information. That is why this is a separate, explicit choice rather than part of the main agreement — so you can say yes to Steady without ever saying yes to voice. You can use every part of the program without it.",
  },
  {
    title: "You stay in control",
    body: "You can turn voice off at any time, in the moment or in settings — one tap, no reason needed, and no penalty. Deleting your account or your data removes the transcripts along with everything else. Withdrawing here stops any further voice capture immediately.",
  },
  {
    title: "Where it goes — and where it doesn't",
    body: "Your voice is never sold, never shared with advertisers, and never used for marketing. Crisis detection during a session runs on our own servers, and crisis responses are scripted, not AI. The live session responder can suggest grounding but can never make a safety or treatment decision — those stay with the program's fixed rules and, when needed, human support.",
  },
  {
    title: "What we keep, and for how long",
    body: "We keep only the transcript text that you confirm or that the session uses — never the audio. It is encrypted at rest and deleted when you delete your data. Coded, content-free records that voice was used may remain in the audit log for safety review, but they contain no recording and none of what you said.",
  },
];

/** Voice/biometric consent is required before voice or live sessions may be
 *  offered to a real member. Off (demo-only) until counsel signs off and the
 *  gate is wired; this reports whether that consent should be enforced. */
export function voiceConsentRequired(): boolean {
  return process.env.EMDR_VOICE_INPUT === "1" || process.env.EMDR_LIVE_SESSION === "1";
}
