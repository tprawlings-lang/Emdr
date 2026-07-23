"use client";
import { useCallback, useEffect, useRef } from "react";

// On-device text-to-speech via the Web Speech API. No audio leaves the device;
// nothing is uploaded. Used to SPEAK the deterministic, output-guard-clean
// resourcing prompts and directive cues aloud. Degrades gracefully to text-only
// when the browser has no speech synthesis.
export function useSpeech(enabled: boolean) {
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

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
    (text: string) => {
      if (!supported || !enabledRef.current || !text) return;
      try {
        window.speechSynthesis.cancel(); // don't stack utterances
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 0.9; // calm, unhurried
        u.pitch = 1.0;
        u.volume = 1.0;
        window.speechSynthesis.speak(u);
      } catch {
        /* no-op — text remains on screen */
      }
    },
    [supported]
  );

  // Stop any speech when the component using this unmounts.
  useEffect(() => () => cancel(), [cancel]);

  return { speak, cancel, supported };
}
