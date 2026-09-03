"use client";
import { useEffect } from "react";
import { useLatest } from "./useLatest";
import { getAudioContext } from "./media-unlock";

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
  // Keep latest callbacks without re-running the set when their identity
  // changes. Written in a layout effect rather than during render: a discarded
  // render must not leave a stale handler for a stimulation set to complete
  // into. See useLatest.
  const completeRef = useLatest(onComplete);
  const failRef = useLatest(onFailure);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let count = 0;
    let finished = false;

    const cleanup = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      // The context is shared (unlocked in a tap handler for iOS) — do NOT close
      // it here; the next set reuses it. Only stop this set's interval.
    };

    const fail = (reason: string) => {
      if (finished) return;
      finished = true;
      cleanup();
      failRef.current(reason);
    };

    // Reuse the shared context that was unlocked inside a tap handler. Creating a
    // fresh one here (post-render) would stay suspended on iOS and never sound.
    const ctx = getAudioContext();
    if (!ctx) {
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

    // The context should already be running (unlocked in a tap handler). If it's
    // still suspended, nudge resume() but START THE SET ANYWAY — never hang waiting
    // on iOS audio unlock, so the set always progresses to the between-set check.
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    start();

    return cleanup;
  }, [hz, passes, completeRef, failRef]);

  // Audio/haptic only — nothing visual (no flashing motion).
  return null;
}
