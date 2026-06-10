"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SessionStep, TherapyModule } from "@/lib/modules";
import { finishSession, startSession } from "@/lib/actions";

// Hard-stop rules enforced client-side and recorded server-side:
// distress >= 9 at any rating, or a rise of 3+ above the starting rating
// while already high. The player also inserts a rest pause between BLS sets.
const HARD_STOP_ABSOLUTE = 9;
const HARD_STOP_RISE = 3;
const REST_SECONDS = 8;

type Phase = "intro" | "running" | "hardstop" | "finishing";

interface Props {
  module: TherapyModule;
}

function BlsVisual({
  running,
  speedMs,
  soundOn,
}: {
  running: boolean;
  speedMs: number;
  soundOn: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const lastSideRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const start = performance.now();

    const beep = (pan: number) => {
      if (!soundOn) return;
      try {
        audioRef.current ??= new AudioContext();
        const ac = audioRef.current;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        const panner = ac.createStereoPanner();
        osc.frequency.value = 396;
        gain.gain.setValueAtTime(0.08, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.12);
        panner.pan.value = pan;
        osc.connect(gain).connect(panner).connect(ac.destination);
        osc.start();
        osc.stop(ac.currentTime + 0.13);
      } catch {
        // Audio is best-effort; the visual channel is primary.
      }
    };

    const draw = (now: number) => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = "#1c1917";
      ctx.fillRect(0, 0, w, h);
      if (running) {
        const t = ((now - start) % speedMs) / speedMs; // 0..1 over one full cycle
        const x = (0.5 - 0.5 * Math.cos(t * Math.PI * 2)) * (w - 80) + 40;
        const side = x < w / 2 ? -1 : 1;
        if (side !== lastSideRef.current) {
          lastSideRef.current = side;
          beep(side);
        }
        ctx.beginPath();
        ctx.arc(x, h / 2, 22, 0, Math.PI * 2);
        ctx.fillStyle = "#a8e6cf";
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, 22, 0, Math.PI * 2);
        ctx.fillStyle = "#57534e";
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [running, speedMs, soundOn]);

  return (
    <canvas
      ref={canvasRef}
      width={760}
      height={220}
      className="w-full rounded-xl"
      aria-label={
        running
          ? "Bilateral stimulation: follow the moving dot with your eyes"
          : "Bilateral stimulation paused"
      }
    />
  );
}

export default function SessionPlayer({ module: mod }: Props) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("intro");
  const [stepIndex, setStepIndex] = useState(0);
  const [sudsTrail, setSudsTrail] = useState<number[]>([]);
  const [currentSuds, setCurrentSuds] = useState(5);
  const [hardStopReason, setHardStopReason] = useState<string>("");
  const [speedMs, setSpeedMs] = useState(2400);
  const [soundOn, setSoundOn] = useState(false);
  const [blsState, setBlsState] = useState<{ set: number; secondsLeft: number; resting: boolean }>(
    { set: 1, secondsLeft: 0, resting: false }
  );
  const [blsStarted, setBlsStarted] = useState(false);

  const step: SessionStep | undefined = mod.steps[stepIndex];
  const preSuds = sudsTrail.length > 0 ? sudsTrail[0] : null;
  const peakSuds = sudsTrail.length > 0 ? Math.max(...sudsTrail) : null;

  const endSession = useCallback(
    async (outcome: "completed" | "hard_stop" | "abandoned", reason?: string, trail?: number[]) => {
      if (!sessionId) {
        router.push("/dashboard");
        return;
      }
      const t = trail ?? sudsTrail;
      setPhase("finishing");
      await finishSession({
        sessionId,
        outcome,
        preSuds: t.length > 0 ? t[0] : null,
        postSuds: t.length > 0 ? t[t.length - 1] : null,
        peakSuds: t.length > 0 ? Math.max(...t) : null,
        hardStopReason: reason,
        sudsTrail: t,
      });
      if (outcome === "completed") {
        router.push(`/session/${mod.id}/complete?sid=${sessionId}`);
      } else if (outcome === "hard_stop") {
        // stay; hard-stop overlay offers crisis/grounding choices
      } else {
        router.push("/dashboard");
      }
    },
    [sessionId, sudsTrail, mod.id, router]
  );

  const triggerHardStop = useCallback(
    (reason: string, trail: number[]) => {
      setHardStopReason(reason);
      setPhase("hardstop");
      if (!sessionId) return;
      void finishSession({
        sessionId,
        outcome: "hard_stop",
        preSuds: trail.length > 0 ? trail[0] : null,
        postSuds: trail.length > 0 ? trail[trail.length - 1] : null,
        peakSuds: trail.length > 0 ? Math.max(...trail) : null,
        hardStopReason: reason,
        sudsTrail: trail,
      });
    },
    [sessionId]
  );

  const advance = useCallback(() => {
    if (stepIndex + 1 >= mod.steps.length) {
      void endSession("completed");
    } else {
      setStepIndex((i) => i + 1);
    }
  }, [stepIndex, mod.steps.length, endSession]);

  const submitSuds = useCallback(() => {
    const trail = [...sudsTrail, currentSuds];
    setSudsTrail(trail);
    if (currentSuds >= HARD_STOP_ABSOLUTE) {
      triggerHardStop(`Distress rated ${currentSuds}/10`, trail);
      return;
    }
    if (trail.length > 1 && currentSuds - trail[0] >= HARD_STOP_RISE && currentSuds >= 7) {
      triggerHardStop(
        `Distress rose from ${trail[0]} to ${currentSuds} during the session`,
        trail
      );
      return;
    }
    advance();
  }, [sudsTrail, currentSuds, advance, triggerHardStop]);

  // BLS set/rest timer.
  useEffect(() => {
    if (phase !== "running" || step?.kind !== "bls" || !blsStarted) return;
    const id = setInterval(() => {
      setBlsState((s) => {
        if (s.secondsLeft > 1) return { ...s, secondsLeft: s.secondsLeft - 1 };
        if (s.resting) {
          // Rest finished -> next set or step done.
          if (s.set >= (step.sets ?? 1)) {
            clearInterval(id);
            setTimeout(() => {
              setBlsStarted(false);
              advance();
            }, 0);
            return { set: 1, secondsLeft: 0, resting: false };
          }
          return { set: s.set + 1, secondsLeft: step.durationSec ?? 30, resting: false };
        }
        // Set finished -> micro-pause.
        return { ...s, secondsLeft: REST_SECONDS, resting: true };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase, step, blsStarted, advance]);

  const startBls = () => {
    setBlsStarted(true);
    setBlsState({ set: 1, secondsLeft: step?.durationSec ?? 30, resting: false });
  };

  if (phase === "intro") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-2xl font-bold">{mod.name}</h1>
        <p className="mt-2 text-stone-600">{mod.objective}</p>
        <div className="mt-6 rounded-lg border border-stone-200 bg-white p-5 text-sm text-stone-700">
          <p>
            About {mod.durationLabel}. You can pause or stop at any time — stopping early is
            always allowed. If distress climbs too high, the session ends itself and offers
            grounding.
          </p>
          <label className="mt-4 flex items-center gap-2">
            <input
              type="checkbox"
              checked={soundOn}
              onChange={(e) => setSoundOn(e.target.checked)}
            />
            Add alternating audio tones (left/right)
          </label>
          <label className="mt-3 block">
            Dot speed
            <select
              value={speedMs}
              onChange={(e) => setSpeedMs(Number(e.target.value))}
              className="ml-2 rounded-sm border border-stone-300 px-2 py-1"
            >
              <option value={3200}>Slow</option>
              <option value={2400}>Medium</option>
              <option value={1700}>Faster</option>
            </select>
          </label>
        </div>
        <button
          onClick={async () => {
            const id = await startSession(mod.id);
            setSessionId(id ?? null);
            setPhase("running");
          }}
          className="mt-6 w-full rounded-lg bg-stone-900 px-6 py-3 font-medium text-white hover:bg-stone-700"
        >
          Begin
        </button>
      </div>
    );
  }

  if (phase === "finishing") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center text-stone-600">Saving…</div>
    );
  }

  if (phase === "hardstop") {
    return (
      <div className="mx-auto max-w-xl px-6 py-14">
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-6">
          <h1 className="text-2xl font-bold text-amber-900">Session paused for your safety</h1>
          <p className="mt-3 text-amber-900">
            {hardStopReason}. That is the system working as designed — not a failure. Your care
            team has been notified and will review this session.
          </p>
          <div className="mt-5 rounded-lg bg-white p-4 text-stone-800">
            <p className="font-semibold">Ground yourself now</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              <li>Feel your feet on the floor. Press them down.</li>
              <li>Name five things you can see in the room.</li>
              <li>Breathe out longer than you breathe in, five times.</li>
              <li>If you saved a calm-place word, say it to yourself now.</li>
            </ol>
          </div>
          <div className="mt-5 flex flex-col gap-3">
            <a
              href="/crisis"
              className="rounded-lg bg-red-700 px-5 py-3 text-center font-semibold text-white hover:bg-red-800"
            >
              I need help now
            </a>
            <a
              href="/dashboard"
              className="rounded-lg border border-stone-300 px-5 py-3 text-center text-stone-700 hover:bg-stone-100"
            >
              I am settled — back to dashboard
            </a>
          </div>
        </div>
      </div>
    );
  }

  // phase === "running"
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-center justify-between text-sm">
        <span className="text-stone-500">
          {mod.name} · step {stepIndex + 1} of {mod.steps.length}
        </span>
        <div className="flex gap-3">
          <a href="/crisis" className="font-semibold text-red-700 underline">
            Need help now?
          </a>
          <button
            onClick={() => void endSession("abandoned")}
            className="text-stone-500 underline"
          >
            Exit session
          </button>
        </div>
      </div>

      {step?.kind === "instruction" || step?.kind === "grounding" ? (
        <div className="mt-8">
          <h2 className="text-xl font-bold">{step.title}</h2>
          <p className="mt-4 text-lg leading-relaxed text-stone-700">{step.text}</p>
          <button
            onClick={advance}
            className="mt-8 w-full rounded-lg bg-stone-900 px-6 py-3 font-medium text-white hover:bg-stone-700"
          >
            Continue
          </button>
        </div>
      ) : step?.kind === "suds" ? (
        <div className="mt-8">
          <h2 className="text-xl font-bold">{step.title}</h2>
          <div className="mt-6">
            <input
              type="range"
              min={0}
              max={10}
              value={currentSuds}
              onChange={(e) => setCurrentSuds(Number(e.target.value))}
              className="w-full"
              aria-label="Distress rating from 0 (none) to 10 (worst possible)"
            />
            <div className="mt-2 flex justify-between text-sm text-stone-500">
              <span>0 — no distress</span>
              <span className="text-2xl font-bold text-stone-900">{currentSuds}</span>
              <span>10 — worst possible</span>
            </div>
          </div>
          <button
            onClick={submitSuds}
            className="mt-8 w-full rounded-lg bg-stone-900 px-6 py-3 font-medium text-white hover:bg-stone-700"
          >
            Record {currentSuds} and continue
          </button>
        </div>
      ) : step?.kind === "bls" ? (
        <div className="mt-8">
          <h2 className="text-xl font-bold">{step.title}</h2>
          <div className="mt-5">
            <BlsVisual
              running={blsStarted && !blsState.resting && blsState.secondsLeft > 0}
              speedMs={speedMs}
              soundOn={soundOn}
            />
          </div>
          {!blsStarted ? (
            <button
              onClick={startBls}
              className="mt-6 w-full rounded-lg bg-stone-900 px-6 py-3 font-medium text-white hover:bg-stone-700"
            >
              Start set 1 of {step.sets ?? 1} ({step.durationSec}s each)
            </button>
          ) : (
            <p className="mt-4 text-center text-lg" aria-live="polite">
              {blsState.resting ? (
                <>Rest. Breathe out slowly… next set in {blsState.secondsLeft}s</>
              ) : (
                <>
                  Set {blsState.set} of {step.sets ?? 1} — follow the dot with your eyes ·{" "}
                  {blsState.secondsLeft}s
                </>
              )}
            </p>
          )}
          <p className="mt-3 text-center text-sm text-stone-500">
            Feeling too much? Use “Exit session” above — stopping is always allowed.
          </p>
        </div>
      ) : null}

      {preSuds !== null && (
        <p className="mt-10 text-center text-xs text-stone-400">
          Start distress {preSuds} · peak {peakSuds}
        </p>
      )}
    </div>
  );
}
