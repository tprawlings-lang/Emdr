"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { completePractice } from "@/lib/actions";
import type { Practice, BreathPhase } from "@/lib/practices";

const LABEL: Record<BreathPhase["label"], string> = {
  inhale: "Breathe in",
  hold: "Hold",
  exhale: "Breathe out",
  rest: "Rest",
};
// Target circle scale per phase (null = hold current size).
const TARGET: Record<BreathPhase["label"], number | null> = { inhale: 1, exhale: 0.4, hold: null, rest: null };

export default function BreatheLibrary({ practices }: { practices: Practice[] }) {
  const [selected, setSelected] = useState<Practice | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [label, setLabel] = useState("");
  const [scale, setScale] = useState(0.4);
  const [transition, setTransition] = useState("0.6s");

  const runRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(0);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const finish = useCallback((practice: Practice) => {
    runRef.current = false;
    clearTimer();
    setRunning(false);
    setDone(true);
    const elapsed = Math.round((Date.now() - startedAtRef.current) / 1000);
    if (elapsed >= 20) void completePractice(practice.id, elapsed); // only log a real attempt
  }, []);

  const start = useCallback(
    (practice: Practice) => {
      setSelected(practice);
      setDone(false);
      setRunning(true);
      runRef.current = true;
      startedAtRef.current = Date.now();
      let i = 0;
      const step = () => {
        if (!runRef.current) return;
        const elapsed = (Date.now() - startedAtRef.current) / 1000;
        if (elapsed >= practice.durationSec) return finish(practice);
        const phases = practice.phases ?? [];
        if (phases.length === 0) return finish(practice);
        const phase = phases[i % phases.length];
        setLabel(LABEL[phase.label]);
        const target = TARGET[phase.label];
        if (target !== null) {
          setTransition(`${phase.seconds}s`);
          setScale(target);
        }
        timerRef.current = setTimeout(() => {
          i += 1;
          step();
        }, phase.seconds * 1000);
      };
      step();
    },
    [finish]
  );

  const stop = useCallback(() => {
    if (selected) finish(selected);
  }, [selected, finish]);

  const reset = () => {
    runRef.current = false;
    clearTimer();
    setSelected(null);
    setRunning(false);
    setDone(false);
    setScale(0.4);
  };

  useEffect(
    () => () => {
      runRef.current = false;
      clearTimer();
    },
    []
  );

  // ── Player ──
  if (selected && (running || done)) {
    return (
      <main className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center gap-8 px-6 py-12 text-center">
        {running ? (
          <>
            <div className="flex h-64 w-64 items-center justify-center">
              <div
                aria-hidden
                className="flex h-64 w-64 items-center justify-center rounded-full bg-sage/30"
                style={{ transform: `scale(${scale})`, transition: `transform ${transition} ease-in-out` }}
              >
                <div className="h-40 w-40 rounded-full bg-sage/50" />
              </div>
            </div>
            <p className="font-serif text-3xl text-ground" aria-live="polite">
              {label}
            </p>
            {selected.note && <p className="max-w-sm text-sm text-olive">{selected.note}</p>}
            <button
              type="button"
              onClick={stop}
              className="rounded-full border border-ground/20 px-6 py-3 font-medium text-ground transition-colors hover:bg-linen"
            >
              I&apos;m done
            </button>
          </>
        ) : (
          <>
            <h1 className="font-serif text-3xl font-medium">Nicely done</h1>
            <p className="text-olive">That&apos;s a small, real act of care. Your breath is always here to come back to.</p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={reset}
                className="rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
              >
                Another pattern
              </button>
              <Link href="/dashboard" className="text-sm text-olive underline">
                Back to dashboard
              </Link>
            </div>
          </>
        )}
      </main>
    );
  }

  // ── Library ──
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="font-serif text-3xl font-medium">Breathe</h1>
      <p className="mt-2 text-olive">
        A few minutes of paced breathing to settle your system — before a session, or any time. Pick one that
        feels right; there&apos;s no wrong choice.
      </p>
      <div className="mt-8 space-y-3">
        {practices.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => start(p)}
            className="w-full rounded-3xl border border-ground/10 bg-linen p-5 text-left shadow-soft transition-colors hover:bg-moss"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-serif text-xl text-ground">{p.title}</span>
              <span className="text-xs text-olive">
                {Math.round(p.durationSec / 60)} min
                {!p.hasHold && " · no breath-holds"}
              </span>
            </div>
            <p className="mt-1 text-sm text-olive">{p.intro}</p>
          </button>
        ))}
      </div>
      <p className="mt-6 text-center text-xs text-olive">
        Gentler patterns come first on days your check-in suggests taking it easy. Stop any time.
      </p>
    </main>
  );
}
