"use client";
import { useEffect, useRef } from "react";

// Bilateral-stimulation generator — auditory (alternating left/right panned tones)
// + haptic (device vibration). Audio + touch only; NO visual BLS (config /
// WCAG). Runs one set of `passes` alternations at `hz`, then calls onComplete.
// Fail-safe: any audio/timing failure STOPS the set (never catches up or resumes)
// and calls onFailure — the caller routes to grounding/closure. Cleans up on unmount.
export default function BlsStimulus({
  hz,
  passes,
  onComplete,
  onFailure,
}: {
  hz: number;
  passes: number;
  onComplete: () => void;
  onFailure: (reason: string) => void;
}) {
  // Keep latest callbacks without re-running the set when their identity changes.
  const completeRef = useRef(onComplete);
  const failRef = useRef(onFailure);
  completeRef.current = onComplete;
  failRef.current = onFailure;

  useEffect(() => {
    let ctx: AudioContext | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let count = 0;
    let finished = false;

    const cleanup = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (ctx && ctx.state !== "closed") ctx.close().catch(() => {});
      ctx = null;
    };

    const fail = (reason: string) => {
      if (finished) return;
      finished = true;
      cleanup();
      failRef.current(reason);
    };

    try {
      const AC: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    } catch {
      fail("audio_init");
      return;
    }

    const beat = () => {
      if (!ctx || finished) return;
      const pan = count % 2 === 0 ? -1 : 1;
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const panner = ctx.createStereoPanner();
        panner.pan.value = pan;
        osc.frequency.value = 220;
        osc.connect(gain);
        gain.connect(panner);
        panner.connect(ctx.destination);
        const t = ctx.currentTime;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.14, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        osc.start(t);
        osc.stop(t + 0.13);
      } catch {
        fail("timing"); // audio/timing failure mid-set → stop, never catch up
        return;
      }
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(35);
      }
      count += 1;
      if (count >= passes) {
        finished = true;
        cleanup();
        completeRef.current();
      }
    };

    const start = () => {
      // Guard against a zero/invalid rate.
      const periodMs = hz > 0 ? 1000 / hz : 0;
      if (!periodMs) {
        fail("bad_rate");
        return;
      }
      interval = setInterval(beat, periodMs);
    };

    // Browsers require a user gesture to start audio; resume if suspended.
    if (ctx.state === "suspended") {
      ctx.resume().then(start).catch(() => fail("audio_resume"));
    } else {
      start();
    }

    return cleanup;
  }, [hz, passes]);

  // Audio/haptic only — nothing visual (no flashing motion).
  return null;
}
