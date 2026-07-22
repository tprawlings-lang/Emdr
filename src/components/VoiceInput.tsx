"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Voice responses — let a member answer a free-text reflection by speaking.
//
// Design rules (mirrored in EXPERIENCE_RULES for clinician sign-off):
//  • Typing is always available and never required. This control only *fills*
//    a text field the member still reads, edits, and confirms — it never
//    submits on its own. Deaf/HoH members lose nothing by ignoring it.
//  • The member's device does the listening. Steady receives only text, never
//    a recording. NOTE: the in-browser demo uses the browser's built-in Web
//    Speech recognition, which on some browsers routes audio to the browser
//    vendor's service. The on-device / audio-never-leaves guarantee is the
//    *production* (native app) commitment; the browser widget is a labeled
//    preview so the clinician can feel the interaction.
//  • Accessibility: the button is keyboard-operable and labelled; status is
//    announced politely (not per-word); nothing auto-plays.
//
// Scope: use ONLY for free-text reflections — never SUDS ratings, fit answers,
// or any safety-gate input (VOICE_INPUT_SCOPE).

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<
    ArrayLike<{ transcript: string }> & { isFinal: boolean }
  >;
};

function getRecognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function VoiceInput({
  onTranscript,
  label = "Answer by voice",
  className = "",
}: {
  /** Called with the recognized text when the member stops speaking. The
   *  parent puts it into an editable field the member then confirms. */
  onTranscript: (text: string) => void;
  label?: string;
  className?: string;
}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [status, setStatus] = useState("");
  const recRef = useRef<Recognition | null>(null);
  const finalRef = useRef("");

  // Abort any in-flight recognition when the control unmounts. No setState in
  // this effect — capability is detected at click time instead, which keeps
  // SSR and hydration identical (the button always renders; it reports
  // unavailability only if actually used on an unsupporting browser).
  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setStatus("Voice isn't available in this browser — please type your answer instead.");
      return;
    }
    const rec = new Ctor();
    recRef.current = rec;
    finalRef.current = "";
    rec.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const chunk = res[0]?.transcript ?? "";
        if (res.isFinal) finalRef.current += chunk;
        else interimText += chunk;
      }
      setInterim(interimText);
    };
    rec.onerror = (ev) => {
      setStatus(
        ev.error === "not-allowed" || ev.error === "service-not-allowed"
          ? "Microphone permission is off. You can type your answer instead."
          : "Voice didn't work just now — please type your answer."
      );
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
      const text = finalRef.current.trim();
      if (text) {
        onTranscript(text);
        setStatus("Added what you said below — read it over and edit anything before you save.");
      }
    };

    try {
      rec.start();
      setListening(true);
      setStatus("Listening… take your time. Tap Stop when you're done.");
    } catch {
      setStatus("Voice didn't start — please type your answer.");
      setListening(false);
    }
  }, [onTranscript]);

  return (
    <div className={className}>
      <button
        type="button"
        onClick={listening ? stop : start}
        aria-pressed={listening}
        className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
          listening
            ? "border-support bg-support/15 text-support-deep"
            : "border-ground/20 bg-ivory hover:bg-moss"
        }`}
      >
        <span aria-hidden="true">{listening ? "■" : "🎤"}</span>
        {listening ? "Stop" : label}
      </button>

      {listening && interim && (
        <p className="mt-2 text-sm italic text-olive" aria-hidden="true">
          {interim}…
        </p>
      )}

      {/* Polite, whole-phrase status for screen readers — never per word. */}
      <p role="status" aria-live="polite" className="mt-1 text-xs text-olive">
        {status}
      </p>

      <p className="mt-1 text-xs text-olive/80">
        Your device does the listening — Steady receives only the words you keep, never a
        recording. You can always type instead.
      </p>
    </div>
  );
}
