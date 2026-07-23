"use client";
import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import BlsStimulus from "./BlsStimulus";
import {
  newResourcing,
  begin,
  advancePrep,
  completeSet,
  answerBetween,
  groundMe,
  completeClosure,
  RESOURCING_PREP_STEPS,
  type ResourcingState,
} from "@/lib/safety/resourcing-session";
import { RESOURCING_CUES, RESOURCING_BETWEEN, RESOURCING_PARAMS } from "@/lib/safety/resourcing";

// Phase-4a resourcing session (Calm/Safe Place). Client flow only; every clinical
// decision (stop/closure) is the pure reducer. Directive cues are deterministic;
// no generative text runs during a set. Ground-Me is always reachable.
export default function ResourcingSession() {
  const [s, setS] = useState<ResourcingState>(newResourcing);
  const [cueWord, setCueWord] = useState("");
  const [closureSecs, setClosureSecs] = useState(0);

  // Rotate a directive cue per set (deterministic, not reactive).
  const cue = RESOURCING_CUES[s.setsCompleted % RESOURCING_CUES.length];
  const betweenPrompt = RESOURCING_BETWEEN[s.setsCompleted % RESOURCING_BETWEEN.length];

  const onSetComplete = useCallback(() => setS((st) => completeSet(st)), []);
  const onSetFailure = useCallback(() => setS((st) => groundMe(st)), []); // fail-safe → closure

  // Closure timer: enforce the mandatory minimum before "complete" is allowed.
  useEffect(() => {
    if (s.phase !== "closure") return;
    setClosureSecs(0);
    const id = setInterval(() => setClosureSecs((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [s.phase]);

  const StopButton = (
    <button
      type="button"
      onClick={() => setS((st) => groundMe(st))}
      className="w-full rounded-full border border-support px-6 py-3 font-medium text-support-deep transition-colors hover:bg-support/10"
    >
      Stop &amp; ground me
    </button>
  );

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-6 py-12">
      {s.phase === "intro" && (
        <div className="space-y-5 text-center">
          <h1 className="font-serif text-3xl font-medium">A calm-place session</h1>
          <p className="text-olive">
            We&apos;ll settle, bring a calm place to mind, and pair it with a few short, gentle
            rounds of sound and tapping. You can stop any time — stopping is always okay.
          </p>
          <button
            type="button"
            onClick={() => setS(begin)}
            className="w-full rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
          >
            Begin
          </button>
        </div>
      )}

      {s.phase === "prep" && (
        <div className="space-y-6">
          <p className="text-center font-serif text-2xl leading-relaxed">
            {RESOURCING_PREP_STEPS[s.stepIndex]?.prompt}
          </p>
          {RESOURCING_PREP_STEPS[s.stepIndex]?.phase === "cue_word" && (
            <input
              value={cueWord}
              onChange={(e) => setCueWord(e.target.value.slice(0, 40))}
              placeholder="your word"
              className="w-full rounded-full border border-ground/15 bg-white px-5 py-3 text-center"
            />
          )}
          <button
            type="button"
            onClick={() => setS((st) => advancePrep(st))}
            className="w-full rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
          >
            Continue
          </button>
          {StopButton}
        </div>
      )}

      {s.phase === "set" && (
        <div className="space-y-8 text-center">
          <p className="font-serif text-2xl">{cue}</p>
          <p className="text-sm text-olive">
            Set {s.setsCompleted + 1} of {RESOURCING_PARAMS.maxSets} · gentle sound &amp; tapping
          </p>
          <BlsStimulus
            key={s.setsCompleted}
            hz={RESOURCING_PARAMS.hz}
            passes={RESOURCING_PARAMS.passesPerSet}
            onComplete={onSetComplete}
            onFailure={onSetFailure}
          />
          {StopButton}
        </div>
      )}

      {s.phase === "between" && (
        <div className="space-y-6 text-center">
          <p className="font-serif text-2xl">{betweenPrompt}</p>
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setS((st) => answerBetween(st, true))}
              className="w-full rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
            >
              Calmer / about the same — stay with it
            </button>
            <button
              type="button"
              onClick={() => setS((st) => answerBetween(st, false))}
              className="w-full rounded-full border border-ground/20 px-6 py-3 font-medium transition-colors hover:bg-linen"
            >
              Less pleasant — let&apos;s stop and ground
            </button>
          </div>
        </div>
      )}

      {s.phase === "closure" && (
        <div className="space-y-6 text-center">
          <h2 className="font-serif text-2xl font-medium">Let&apos;s close gently</h2>
          <p className="text-olive">
            Come back to the room at your own pace. Notice your breath, your feet on the floor.
            Your word and your calm place are yours to return to any time.
          </p>
          <button
            type="button"
            disabled={closureSecs < 120}
            onClick={() => setS((st) => completeClosure(st, closureSecs))}
            className="w-full rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {closureSecs < 120 ? `A little longer… (${Math.max(0, 120 - closureSecs)}s)` : "I'm back — finish"}
          </button>
        </div>
      )}

      {s.phase === "completed" && (
        <div className="space-y-5 text-center">
          <h2 className="font-serif text-3xl font-medium">Closed and complete</h2>
          <p className="text-olive">Well done for taking care of yourself today.</p>
          <Link
            href="/dashboard"
            className="inline-block rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
          >
            Back to dashboard
          </Link>
        </div>
      )}
    </main>
  );
}
