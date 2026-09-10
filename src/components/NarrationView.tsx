"use client";

import { useEffect, useRef, useState } from "react";
import { useLatest } from "./useLatest";
import { useSpeech } from "./useSpeech";

// Guided-session narration ("someone is talking"). Delivers clinician-authored
// beats one at a time with a gentle reveal, at a calm pace. Deterministic copy
// — no model in the session loop.
//
// The parent gives this a `key` per step, so a new step remounts it fresh
// (no manual state reset needed).
//
// Accessibility (deaf/HoH members are first-class here — text IS the channel):
//  • The full narration is always present for screen readers (sr-only block),
//    so assistive tech gets the whole thing in order, never a per-character
//    firehose. The animated copy is aria-hidden.
//  • prefers-reduced-motion → everything appears at once, no typewriter.
//  • A "Show all" button reveals everything instantly; the parent's Continue is
//    always available, so no one is trapped waiting for text to finish.

const CHAR_MS = 26; // gentle typing speed
const BEAT_PAUSE_MS = 650; // breath between spoken lines

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default function NarrationView({ beats, voice = false }: { beats: string[]; voice?: boolean }) {
  // Lazy init: reduced-motion members start with everything already shown.
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? beats.length : 0));
  const [typed, setTyped] = useState("");
  const instantRef = useRef(prefersReducedMotion());

  // Speak the narration aloud (on-device) when voice is on. Each beat is queued so
  // they play in order without cutting one another off; the visual reveal above is
  // independent, so nobody waits on audio. Deterministic clinician-authored copy —
  // the same text already shown. Component is keyed per step by the parent, so this
  // runs once per step; cancel on unmount / mute stops it.
  const { speak, cancel, supported: speechSupported } = useSpeech(voice);
  const beatsRef = useLatest(beats);
  useEffect(() => {
    if (!voice || !speechSupported) return;
    beatsRef.current.forEach((b, i) => speak(b, { queue: i > 0 }));
    return () => cancel();
    // Run once per mount (keyed per step upstream); speak/cancel are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!voice) cancel(); // muting mid-step stops the voice immediately
  }, [voice, cancel]);

  useEffect(() => {
    if (instantRef.current) return; // reduced-motion or already revealed
    const timers: ReturnType<typeof setTimeout>[] = [];
    let beatIdx = 0;
    let charIdx = 0;
    const tick = () => {
      if (instantRef.current) return;
      const line = beats[beatIdx] ?? "";
      if (charIdx <= line.length) {
        setTyped(line.slice(0, charIdx));
        charIdx += 1;
        timers.push(setTimeout(tick, CHAR_MS));
      } else {
        setShown((n) => Math.max(n, beatIdx + 1));
        setTyped("");
        beatIdx += 1;
        charIdx = 0;
        if (beatIdx < beats.length) timers.push(setTimeout(tick, BEAT_PAUSE_MS));
      }
    };
    timers.push(setTimeout(tick, 300));
    return () => timers.forEach(clearTimeout);
  }, [beats]);

  const showAll = () => {
    instantRef.current = true;
    setTyped("");
    setShown(beats.length);
  };

  const allShown = shown >= beats.length;

  return (
    <div>
      {/* Full narration for assistive tech — read in order, once. */}
      <div className="sr-only">
        {beats.map((b, i) => (
          <p key={i}>{b}</p>
        ))}
      </div>

      {/* Visual, animated delivery (hidden from screen readers). */}
      <div aria-hidden="true" className="space-y-3">
        {beats.slice(0, shown).map((b, i) => (
          <p key={i} className="text-lg leading-relaxed text-ground/90">
            {b}
          </p>
        ))}
        {!allShown && typed && (
          <p className="text-lg leading-relaxed text-ground/90">
            {typed}
            <span className="ml-0.5 inline-block h-5 w-0.5 -translate-y-0.5 animate-pulse bg-ground/50 align-middle" />
          </p>
        )}
      </div>

      {!allShown && (
        <button type="button" onClick={showAll} className="mt-3 text-sm text-olive underline">
          Show all at once
        </button>
      )}
    </div>
  );
}
