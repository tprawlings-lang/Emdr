"use client";
import { useCallback, useEffect, useState } from "react";
import { useLatest } from "./useLatest";

// On-device text-to-speech via the Web Speech API. No audio leaves the device;
// nothing is uploaded. Used to SPEAK the deterministic, output-guard-clean
// narration, resourcing prompts and directive cues aloud. Degrades gracefully to
// text-only when the browser has no speech synthesis.
//
// We pick the most natural voice the device offers instead of the platform
// default (which is usually the most robotic one). Still 100% on-device.

// Voices whose names signal a higher-quality (neural / enhanced / premium) engine.
const GOOD_HINTS = ["natural", "neural", "enhanced", "premium", "siri", "google"];
// Named voices that are the pleasant modern defaults on Apple / Android / Chrome.
const NICE_NAMES = [
  "samantha", "karen", "moira", "serena", "daniel", "aaron", "nicky",
  "ava", "allison", "tom", "evan", "joelle", "zoe",
];
// Legacy/novelty voices to avoid — they sound robotic.
const BAD_HINTS = ["compact", "eloquence", "fred", "albert", "zarvox", "trinoids", "bad news", "bells", "cellos"];

function scoreVoice(v: SpeechSynthesisVoice): number {
  const name = v.name.toLowerCase();
  const lang = (v.lang || "").toLowerCase();
  if (!lang.startsWith("en")) return -1; // our copy is English
  let s = 0;
  if (GOOD_HINTS.some((h) => name.includes(h))) s += 15;
  if (NICE_NAMES.some((h) => name.includes(h))) s += 8;
  if (BAD_HINTS.some((h) => name.includes(h))) s -= 30;
  if (lang === "en-us") s += 4;
  else if (lang === "en-gb") s += 3;
  else s += 1;
  return s;
}

function pickBestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = 0; // require a positive score (an English voice); else platform default
  for (const v of voices) {
    const sc = scoreVoice(v);
    if (sc > bestScore) {
      bestScore = sc;
      best = v;
    }
  }
  return best;
}

export type VoiceQuality = "enhanced" | "basic" | "unknown";

function classify(v: SpeechSynthesisVoice | null): VoiceQuality {
  if (!v) return "unknown";
  const name = v.name.toLowerCase();
  return GOOD_HINTS.some((h) => name.includes(h)) ? "enhanced" : "basic";
}

export function useSpeech(enabled: boolean) {
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  const enabledRef = useLatest(enabled);

  // The chosen voice. Voices load asynchronously on most browsers, so we resolve
  // now and again whenever the list changes.
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  const voiceRef = useLatest(voice);

  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const load = () => {
      const best = pickBestVoice(synth.getVoices());
      if (best) setVoice(best);
    };
    load();
    // Different browsers expose the event differently; support both.
    try {
      synth.addEventListener("voiceschanged", load);
    } catch {
      synth.onvoiceschanged = load;
    }
    return () => {
      try {
        synth.removeEventListener("voiceschanged", load);
      } catch {
        /* no-op */
      }
    };
  }, [supported]);

  const cancel = useCallback(() => {
    if (supported) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* no-op */
      }
    }
  }, [supported]);

  const speak = useCallback(
    (text: string, opts?: { queue?: boolean }) => {
      if (!supported || !enabledRef.current || !text) return;
      try {
        const synth = window.speechSynthesis;
        // Queue mode (narration): append without cancelling, so multiple beats
        // play in sequence. Otherwise replace whatever's speaking. On iOS a cancel
        // fired immediately before speak() can drop the new utterance entirely, so
        // only cancel when something is actually queued/playing.
        if (!opts?.queue && (synth.speaking || synth.pending)) synth.cancel();
        synth.resume(); // iOS sometimes leaves the queue paused
        const u = new SpeechSynthesisUtterance(text);
        const v = voiceRef.current;
        if (v) {
          u.voice = v; // the most natural voice we found, not the robotic default
          u.lang = v.lang;
        }
        u.rate = 0.9; // calm, unhurried
        u.pitch = 1.0;
        u.volume = 1.0;
        synth.speak(u);
      } catch {
        /* no-op — text remains on screen */
      }
    },
    [supported, enabledRef, voiceRef]
  );

  // Stop any speech when the component using this unmounts.
  useEffect(() => () => cancel(), [cancel]);

  return { speak, cancel, supported, voiceName: voice?.name ?? null, voiceQuality: classify(voice) };
}
