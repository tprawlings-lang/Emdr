"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useLatest } from "./useLatest";
import type { Practice, BreathPhase } from "@/lib/practices";

const LABEL: Record<BreathPhase["label"], string> = {
  inhale: "Breathe in",
  hold: "Hold",
  exhale: "Breathe out",
  rest: "Rest",
};
const TARGET: Record<BreathPhase["label"], number | null> = { inhale: 1, exhale: 0.4, hold: null, rest: null };

// Shared visual breathing pacer: an expanding/contracting circle synced to a
// practice's phase timings. Loops until the suggested duration, or until the
// member taps "I'm done". Calls onDone(elapsedSeconds) exactly once. Used by the
// Breathe library and the prepare-for-session on-ramp.
export default function BreathePacer({
  practice,
  onDone,
}: {
  practice: Practice;
  onDone: (elapsedSec: number) => void;
}) {
  const [label, setLabel] = useState("");
  const [scale, setScale] = useState(0.4);
  const [transition, setTransition] = useState("0.6s");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endedRef = useRef(false);
  const startedRef = useRef(0);
  const onDoneRef = useLatest(onDone);

  const end = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    onDoneRef.current(Math.round((Date.now() - startedRef.current) / 1000));
  }, [onDoneRef]);

  useEffect(() => {
    endedRef.current = false;
    startedRef.current = Date.now();
    const phases = practice.phases ?? [];
    let i = 0;
    const step = () => {
      if (endedRef.current) return;
      if ((Date.now() - startedRef.current) / 1000 >= practice.durationSec || phases.length === 0) {
        end();
        return;
      }
      const phase = phases[i % phases.length];
      setLabel(LABEL[phase.label]);
      const t = TARGET[phase.label];
      if (t !== null) {
        setTransition(`${phase.seconds}s`);
        setScale(t);
      }
      timerRef.current = setTimeout(() => {
        i += 1;
        step();
      }, phase.seconds * 1000);
    };
    step();
    return () => {
      endedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [practice, end]);

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="flex h-56 w-56 items-center justify-center">
        <div
          aria-hidden
          className="flex h-56 w-56 items-center justify-center rounded-full bg-sage/30"
          style={{ transform: `scale(${scale})`, transition: `transform ${transition} ease-in-out` }}
        >
          <div className="h-36 w-36 rounded-full bg-sage/50" />
        </div>
      </div>
      <p className="type-display text-2xl text-ground" aria-live="polite">
        {label}
      </p>
      <button
        type="button"
        onClick={end}
        className="rounded-full border border-ground/20 px-6 py-2.5 text-sm font-medium text-ground transition-colors hover:bg-linen"
      >
        I&apos;m done
      </button>
    </div>
  );
}
