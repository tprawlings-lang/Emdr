"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Hands-free continuous listening for live sessions. Unlike VoiceInput
// (tap-to-talk), this keeps the mic open: when the member finishes a phrase,
// onUtterance fires with the final transcript. One clear on/off toggle controls
// it — always visible, always stoppable — and it never auto-starts.
//
// PRIVACY: the browser preview uses the browser's built-in recognition, which
// on some browsers sends audio to the browser vendor. The on-device / audio-
// never-leaves guarantee is the shipped (native) app. The toggle label states
// that listening is on so it is never covert.

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
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

function getRecognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function LiveVoice({
  onUtterance,
  busy,
}: {
  onUtterance: (text: string) => void;
  /** Parent is processing a response — we pause emitting new utterances. */
  busy?: boolean;
}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [status, setStatus] = useState("");
  const recRef = useRef<Recognition | null>(null);
  const wantOnRef = useRef(false);
  const busyRef = useRef(false);

  // Keep the ref in sync for the recognition callback (which closes over it)
  // without writing to a ref during render.
  useEffect(() => {
    busyRef.current = Boolean(busy);
  }, [busy]);

  useEffect(() => {
    return () => {
      wantOnRef.current = false;
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const begin = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setStatus("Voice isn't available in this browser — you can still type or tap through.");
      return;
    }
    const rec = new Ctor();
    recRef.current = rec;
    rec.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const chunk = res[0]?.transcript ?? "";
        if (res.isFinal) {
          const finalText = chunk.trim();
          if (finalText && !busyRef.current) onUtterance(finalText);
        } else {
          interimText += chunk;
        }
      }
      setInterim(interimText);
    };
    rec.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        setStatus("Microphone permission is off. You can type or tap through instead.");
        wantOnRef.current = false;
        setListening(false);
      }
    };
    rec.onend = () => {
      // Continuous recognition ends itself periodically; restart while wanted.
      if (wantOnRef.current) {
        try {
          rec.start();
        } catch {
          /* will retry on next end */
        }
      } else {
        setListening(false);
        setInterim("");
      }
    };

    try {
      rec.start();
      wantOnRef.current = true;
      setListening(true);
      setStatus("");
    } catch {
      setStatus("Voice didn't start — you can type or tap through instead.");
    }
  }, [onUtterance]);

  const stop = useCallback(() => {
    wantOnRef.current = false;
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  }, []);

  return (
    <div className="rounded-2xl border border-ground/15 bg-linen/60 p-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={listening ? stop : begin}
          aria-pressed={listening}
          className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
            listening ? "border-support bg-support/15 text-support-deep" : "border-ground/20 bg-ivory hover:bg-moss"
          }`}
        >
          <span aria-hidden="true">{listening ? "‖" : "🎙"}</span>
          {listening ? "Listening — tap to stop" : "Talk to me (hands-free)"}
        </button>
        {listening && (
          <span className="inline-flex items-center gap-1.5 text-xs text-support-deep" aria-hidden="true">
            <span className="h-2 w-2 animate-pulse rounded-full bg-support" /> mic on
          </span>
        )}
      </div>
      {interim && (
        <p className="mt-2 text-sm italic text-olive" aria-hidden="true">
          {interim}…
        </p>
      )}
      <p role="status" aria-live="polite" className="mt-1 text-xs text-olive">
        {status}
      </p>
      <p className="mt-1 text-xs text-olive/80">
        When listening is on, speak naturally and pause — you don&apos;t need to press anything. Your
        device does the listening; only text is sent. You can stop any time.
      </p>
    </div>
  );
}
