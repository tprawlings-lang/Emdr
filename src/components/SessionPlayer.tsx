"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SessionStep, TherapyModule } from "@/lib/modules";
import { fillNarrationSlots } from "@/lib/modules";
import NarrationView from "@/components/NarrationView";
import { getAudioContext, unlockMedia } from "@/components/media-unlock";
import { useSpeech } from "@/components/useSpeech";
import { personalizedCues } from "@/lib/safety/resourcing";
import type { SessionFocus } from "@/lib/session-focus";
import { finishSession, logSafetyEvent, recordSessionTrigger, speakInSession, startSession } from "@/lib/actions";
import VoiceInput from "@/components/VoiceInput";
import LiveVoice from "@/components/LiveVoice";
import {
  SESSION_CAP_MIN,
  SESSION_WINDDOWN_MIN,
  sudsDecision,
} from "@/lib/session-safety";

// In-session safety rules live in lib/session-safety.ts (deterministic,
// covered by the @safety test suite). The player also inserts a rest pause
// between BLS sets.
const REST_SECONDS = 8;

type Phase = "intro" | "running" | "ground" | "sudpause" | "hardstop" | "finishing";

interface Props {
  module: TherapyModule;
  /** Pre-session focus options built from the member's stored data. */
  focus?: SessionFocus | null;
  /** Saved calm-place word, shown during grounding and hard stops. */
  calmPlace?: string | null;
  /** Default to audio-only bilateral stimulation (photosensitivity flag). */
  audioOnlyDefault?: boolean;
  /** Offer voice answers on free-text reflections (demo/flagged; typing stays
   *  the full path either way). */
  voiceEnabled?: boolean;
  /** Member's preferred name, for personalizing the guided narration. */
  memberName?: string | null;
  /** Enable hands-free voice + the dynamic in-session responder (demo/flag). */
  liveEnabled?: boolean;
}

// iPhone/iPad (incl. iPadOS reporting as "MacIntel" with touch) — used only to
// show a one-line hint about downloading a more natural voice.
function isAppleTouch(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
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
        // Shared context, unlocked in a tap handler (iOS). Creating a fresh one
        // here would stay suspended on iPad and never sound.
        const ac = getAudioContext();
        if (!ac) return;
        if (ac.state === "suspended") ac.resume().catch(() => {});
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
      ctx.fillStyle = "#2f3a33";
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
        ctx.fillStyle = "#a8b8a1";
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, 22, 0, Math.PI * 2);
        ctx.fillStyle = "#8a9a90";
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
      className="w-full rounded-3xl"
      aria-label={
        running
          ? "Bilateral stimulation: follow the moving dot with your eyes"
          : "Bilateral stimulation paused"
      }
    />
  );
}

// Audio-only bilateral stimulation: alternating left/right tones, nothing
// moving on screen. The default for members with a photosensitivity flag and
// available to everyone (compliance 6.1).
function BlsAudio({ running, speedMs }: { running: boolean; speedMs: number }) {
  const sideRef = useRef(1);

  useEffect(() => {
    if (!running) return;
    const beep = () => {
      try {
        // Shared context, unlocked in a tap handler (iOS-safe).
        const ac = getAudioContext();
        if (!ac) return;
        if (ac.state === "suspended") ac.resume().catch(() => {});
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        const panner = ac.createStereoPanner();
        osc.frequency.value = 396;
        gain.gain.setValueAtTime(0.1, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.14);
        panner.pan.value = sideRef.current;
        sideRef.current *= -1;
        osc.connect(gain).connect(panner).connect(ac.destination);
        osc.start();
        osc.stop(ac.currentTime + 0.15);
      } catch {
        // best effort
      }
    };
    beep();
    const id = setInterval(beep, speedMs / 2);
    return () => clearInterval(id);
  }, [running, speedMs]);

  return (
    <div className="flex h-[220px] w-full flex-col items-center justify-center rounded-3xl bg-ground text-center text-ivory/85">
      <p className="font-serif text-2xl">{running ? "Follow the tones" : "Audio paused"}</p>
      <p className="mt-2 max-w-sm text-sm text-ivory/60">
        Left… right… let your attention move with the sound. Headphones work best.
      </p>
    </div>
  );
}

const TRIGGER_CATEGORIES = [
  { value: "relational", label: "People & relationships" },
  { value: "environmental", label: "Places & situations" },
  { value: "body", label: "Body sensations" },
  { value: "memory", label: "Memories & dates" },
  { value: "internal", label: "Thoughts & feelings" },
  { value: "other", label: "Something else" },
] as const;

// Module 5 structured capture: each saved entry writes to the member's
// trigger map (encrypted), which feeds the program plan, the companion, the
// pre-session focus picker, and the specialist's review. Headline level by
// design — short fields, not narratives.
function TriggerEntryStep({
  sessionId,
  text,
  onDone,
  voiceEnabled = false,
}: {
  sessionId: string | null;
  text?: string;
  onDone: () => void;
  voiceEnabled?: boolean;
}) {
  const [saved, setSaved] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("relational");
  const [bodyFelt, setBodyFelt] = useState("");
  const [belief, setBelief] = useState("");
  const [disruption, setDisruption] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const save = async () => {
    if (!sessionId || pending) return;
    setPending(true);
    setError(null);
    const res = await recordSessionTrigger({
      sessionId,
      name,
      category,
      bodyFelt,
      belief,
      disruption,
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error ?? "That didn't save — try again.");
      return;
    }
    setSaved((s) => [...s, name.trim()]);
    setName("");
    setBodyFelt("");
    setBelief("");
    setDisruption(5);
  };

  return (
    <div className="mt-8">
      <h2 className="font-serif text-2xl font-medium">Map your triggers (headline level)</h2>
      {text && <p className="mt-3 text-sm leading-relaxed text-olive">{text}</p>}

      {saved.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {saved.map((s, i) => (
            <span key={i} className="rounded-full bg-safe/20 px-4 py-1.5 text-sm text-ground">
              ✓ {s}
            </span>
          ))}
        </div>
      )}

      <div className="mt-5 rounded-3xl border border-ground/10 bg-linen p-6 shadow-soft">
        <label className="block">
          <span className="text-sm font-medium">What sets it off? (a few words)</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="e.g. Raised voices, hospital smells, Sunday evenings"
            className="mt-1 w-full rounded-2xl border border-ground/15 bg-ivory px-4 py-2.5 text-sm focus:border-sage focus:outline-none"
          />
          {voiceEnabled && (
            <VoiceInput
              className="mt-2"
              label="Answer by voice"
              onTranscript={(t) =>
                setName((prev) => (prev.trim() ? `${prev} ${t}` : t).slice(0, 120))
              }
            />
          )}
        </label>
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Where does it belong?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {TRIGGER_CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategory(c.value)}
                className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                  category === c.value
                    ? "border-clay bg-clay font-semibold"
                    : "border-ground/15 bg-ivory hover:bg-moss"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="mt-4 block">
          <span className="text-sm font-medium">Where do you feel it in your body?</span>
          <input
            value={bodyFelt}
            onChange={(e) => setBodyFelt(e.target.value)}
            maxLength={200}
            placeholder="e.g. Tight chest, clenched jaw, heavy stomach"
            className="mt-1 w-full rounded-2xl border border-ground/15 bg-ivory px-4 py-2.5 text-sm focus:border-sage focus:outline-none"
          />
        </label>
        <label className="mt-4 block">
          <span className="text-sm font-medium">The belief that comes with it</span>
          <input
            value={belief}
            onChange={(e) => setBelief(e.target.value)}
            maxLength={300}
            placeholder="e.g. I am not safe · It was my fault · I can't trust anyone"
            className="mt-1 w-full rounded-2xl border border-ground/15 bg-ivory px-4 py-2.5 text-sm focus:border-sage focus:outline-none"
          />
        </label>
        <label className="mt-4 block">
          <span className="text-sm font-medium">
            How disruptive is it day to day? <span className="font-bold">{disruption}</span>/10
          </span>
          <input
            type="range"
            min={1}
            max={10}
            value={disruption}
            onChange={(e) => setDisruption(Number(e.target.value))}
            className="mt-1 w-full"
            aria-label="Disruption from 1 (barely) to 10 (constant)"
          />
        </label>
        {error && <p className="mt-3 text-sm text-support-deep">{error}</p>}
        <button
          onClick={() => void save()}
          disabled={pending || name.trim().length === 0}
          className="mt-5 w-full rounded-full border border-ground px-6 py-3 font-medium transition-colors hover:bg-ground hover:text-ivory disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save this trigger to my map"}
        </button>
      </div>

      <button
        onClick={onDone}
        disabled={pending}
        className="mt-5 w-full rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep disabled:opacity-50"
      >
        {saved.length > 0
          ? `Done for today — ${saved.length} saved, continue`
          : "Continue without adding"}
      </button>
      <p className="mt-3 text-center text-sm text-olive">
        Headlines only — a few words is enough. If distress climbs above 6, stop here and use
        “Ground me.”
      </p>
    </div>
  );
}

const GROUNDING_STEPS = [
  "Feel your feet on the floor. Press them down gently.",
  "Breathe out longer than you breathe in. Three slow breaths.",
  "Name five things you can see, four you can hear, three you can touch, two you can smell, one you can taste.",
  "Look around the room. Notice where you are, today's date, that you are here now.",
];

export default function SessionPlayer({ module: mod, focus, calmPlace, audioOnlyDefault, voiceEnabled = false, memberName, liveEnabled = false }: Props) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("intro");
  const [selectedFocusId, setSelectedFocusId] = useState<string | null>(null);
  const [customFocus, setCustomFocus] = useState("");
  const [blsMode, setBlsMode] = useState<"visual" | "audio">(audioOnlyDefault ? "audio" : "visual");
  const [windDown, setWindDown] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const cappedRef = useRef(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [sudsTrail, setSudsTrail] = useState<number[]>([]);
  const [currentSuds, setCurrentSuds] = useState(5);
  const [hardStopReason, setHardStopReason] = useState<string>("");
  const [speedMs, setSpeedMs] = useState(2400);
  // Bilateral tones on by default — the narration promises "a slow, steady rhythm
  // plays underneath", and a silent session is the common "I can't hear anything".
  const [soundOn, setSoundOn] = useState(true);
  // Spoken narration on by default (on-device TTS). Members can mute it.
  const [voiceOn, setVoiceOn] = useState(true);
  // Voice for the short directive cues spoken DURING a positive-resource set.
  const { speak: speakCue, voiceQuality } = useSpeech(voiceOn);
  const [blsState, setBlsState] = useState<{ set: number; secondsLeft: number; resting: boolean }>(
    { set: 1, secondsLeft: 0, resting: false }
  );
  const [blsStarted, setBlsStarted] = useState(false);

  // Live spoken conversation (hands-free). The deterministic session flow above
  // is untouched — this only overlays a spoken exchange. suggestGroundMe just
  // visually emphasizes the Ground-me affordance; it never moves the engine.
  const [liveTurns, setLiveTurns] = useState<{ role: "you" | "steady"; text: string }[]>([]);
  const [liveBusy, setLiveBusy] = useState(false);
  const liveBusyRef = useRef(false);

  const handleUtterance = useCallback(
    async (text: string) => {
      if (liveBusyRef.current) return;
      liveBusyRef.current = true;
      setLiveBusy(true);
      setLiveTurns((t) => [...t.slice(-8), { role: "you", text }]);
      try {
        const res = await speakInSession({
          sessionId: sessionId ?? "",
          moduleId: mod.id,
          transcript: text,
          currentSuds: sudsTrail.length ? sudsTrail[sudsTrail.length - 1] : null,
          calmPlace: calmPlace ?? null,
          name: memberName ?? null,
        });
        if (res.ok && res.response) {
          setLiveTurns((t) => [...t.slice(-8), { role: "steady", text: res.response!.text }]);
          if (res.response.suggestGroundMe && typeof window !== "undefined") {
            // Distress signal in speech → surface grounding immediately.
            setPhase("ground");
            setBlsStarted(false);
          }
        }
      } catch {
        /* a failed turn is silent; the session itself is unaffected */
      } finally {
        liveBusyRef.current = false;
        setLiveBusy(false);
      }
    },
    [sessionId, mod.id, sudsTrail, calmPlace, memberName]
  );

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
    unlockMedia(); // keep audio + speech unlocked across steps (iOS)
    if (stepIndex + 1 >= mod.steps.length) {
      void endSession("completed");
    } else {
      setStepIndex((i) => i + 1);
    }
  }, [stepIndex, mod.steps.length, endSession]);

  const submitSuds = useCallback(() => {
    const trail = [...sudsTrail, currentSuds];
    setSudsTrail(trail);
    const decision = sudsDecision(trail);
    if (decision === "hard_stop") {
      triggerHardStop(`Distress rated ${currentSuds}/10`, trail);
      return;
    }
    if (decision === "pause") {
      // Compliance 4B.2: pause processing, ground, then an explicit choice
      // to continue or stop — never push through high distress.
      setBlsStarted(false);
      setPhase("sudpause");
      void logSafetyEvent("suds_pause", sessionId ?? undefined);
      return;
    }
    advance();
  }, [sudsTrail, currentSuds, advance, triggerHardStop, sessionId]);

  // Session length caps (compliance 4B.3): wind-down notice at 35 minutes,
  // hard cap at 45 — the session jumps to its closing grounding step.
  useEffect(() => {
    if (phase === "intro" || phase === "finishing" || phase === "hardstop") return;
    const id = setInterval(() => {
      if (!startedAtRef.current || cappedRef.current) return;
      const mins = (Date.now() - startedAtRef.current) / 60000;
      if (mins >= SESSION_CAP_MIN) {
        cappedRef.current = true;
        setBlsStarted(false);
        setStepIndex(mod.steps.length - 1);
        setPhase("running");
        void logSafetyEvent("session_time_cap", sessionId ?? undefined);
      } else if (mins >= SESSION_WINDDOWN_MIN) {
        setWindDown((w) => {
          if (!w) void logSafetyEvent("session_winddown_shown", sessionId ?? undefined);
          return true;
        });
      }
    }, 15000);
    return () => clearInterval(id);
  }, [phase, sessionId, mod.steps.length]);

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
    unlockMedia(); // unlock audio inside this tap so the tones actually sound (iOS)
    setBlsStarted(true);
    setBlsState({ set: 1, secondsLeft: step?.durationSec ?? 30, resting: false });
  };

  const chosenFocus =
    customFocus.trim() ||
    focus?.options.find((o) => o.id === selectedFocusId)?.label ||
    "";

  // Light directive cues spoken DURING a set — only for positive-resource
  // (autonomous-tier) modules like the calm place. NOT for gated trauma-processing
  // sets, where "notice what's pleasant" would be clinically wrong. Personalized
  // to the member's calm place / focus; deterministic + output-guard-clean.
  const resourcingModule = mod.tier === "autonomous";
  const blsCues = personalizedCues(calmPlace || chosenFocus);
  const setActive =
    step?.kind === "bls" && blsStarted && !blsState.resting && blsState.secondsLeft > 0;
  const currentCue = blsCues[(blsState.set - 1) % blsCues.length];
  useEffect(() => {
    if (!resourcingModule || !setActive) return;
    speakCue(currentCue); // fires once per set start (deps don't include the ticking clock)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourcingModule, setActive, blsState.set]);

  if (phase === "intro") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="mb-6 rounded-3xl border border-pause/40 bg-pause-soft px-5 py-3 text-sm text-ground">
          <strong>Not for emergencies.</strong> Sessions are not monitored in real time. If you
          are in danger, call or text{" "}
          <a href="tel:988" className="font-semibold underline">988</a> or call 911.
        </div>
        <h1 className="font-serif text-4xl font-medium">{mod.name}</h1>
        <p className="mt-2 text-olive">{mod.objective}</p>

        {focus && (
          <div className="mt-6 rounded-3xl border border-ground/10 bg-linen p-6 shadow-soft">
            <h2 className="font-semibold">{focus.prompt}</h2>
            {focus.helper && <p className="mt-1 text-sm text-olive">{focus.helper}</p>}
            {focus.options.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
                {focus.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    disabled={o.disabled}
                    onClick={() => {
                      setSelectedFocusId((cur) => (cur === o.id ? null : o.id));
                      setCustomFocus("");
                    }}
                    className={`rounded-2xl border px-4 py-3 text-left text-sm transition-colors ${
                      o.disabled
                        ? "cursor-not-allowed border-ground/10 bg-ivory text-ground/40"
                        : selectedFocusId === o.id && !customFocus.trim()
                          ? "border-clay bg-clay font-semibold"
                          : "border-ground/15 bg-ivory hover:bg-moss"
                    }`}
                  >
                    <span className="block">{o.label}</span>
                    {(o.disabled ? o.disabledReason : o.detail) && (
                      <span className="mt-0.5 block text-xs text-olive">
                        {o.disabled ? o.disabledReason : o.detail}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <input
              type="text"
              value={customFocus}
              onChange={(e) => {
                setCustomFocus(e.target.value);
                if (e.target.value.trim()) setSelectedFocusId(null);
              }}
              placeholder={focus.customPlaceholder}
              aria-label="Or describe your own focus"
              className="mt-3 w-full rounded-2xl border border-ground/15 bg-ivory px-4 py-2.5 text-sm focus:border-sage focus:outline-none"
            />
            <p className="mt-2 text-xs text-olive">
              Choosing a focus is optional — you can also just begin.
            </p>
          </div>
        )}

        <div className="mt-6 rounded-3xl border border-ground/10 bg-linen p-6 text-sm text-ground/90 shadow-soft">
          <p>
            About {mod.durationLabel}. You can pause or stop at any time — stopping early is
            always allowed. If distress climbs too high, the session ends itself and offers
            grounding.
          </p>
          {voiceQuality === "basic" && isAppleTouch() && (
            <p className="mt-3 text-xs text-olive">
              Tip: for a warmer, more natural narrator on iPhone/iPad, download an enhanced
              voice once in Settings → Accessibility → Spoken Content → Voices.
            </p>
          )}
          <fieldset className="mt-4">
            <legend className="font-medium">Bilateral stimulation</legend>
            <div className="mt-2 flex gap-2">
              <label className="cursor-pointer rounded-full border border-ground/15 bg-ivory px-4 py-1.5 has-checked:border-clay has-checked:bg-clay has-checked:font-semibold">
                <input
                  type="radio"
                  name="blsmode"
                  checked={blsMode === "visual"}
                  onChange={() => setBlsMode("visual")}
                  className="sr-only"
                />
                Moving dot
              </label>
              <label className="cursor-pointer rounded-full border border-ground/15 bg-ivory px-4 py-1.5 has-checked:border-clay has-checked:bg-clay has-checked:font-semibold">
                <input
                  type="radio"
                  name="blsmode"
                  checked={blsMode === "audio"}
                  onChange={() => setBlsMode("audio")}
                  className="sr-only"
                />
                Audio only (no motion)
              </label>
            </div>
            {audioOnlyDefault && (
              <p className="mt-2 text-xs text-olive">
                Audio-only is your default based on your fit questions — gentler for
                photosensitivity. You can change it.
              </p>
            )}
          </fieldset>
          {blsMode === "visual" && (
            <label className="mt-4 flex items-center gap-2">
              <input
                type="checkbox"
                checked={soundOn}
                onChange={(e) => setSoundOn(e.target.checked)}
              />
              Add alternating audio tones (left/right)
            </label>
          )}
          <label className="mt-3 block">
            Dot speed
            <select
              value={speedMs}
              onChange={(e) => setSpeedMs(Number(e.target.value))}
              className="ml-2 rounded-2xl border border-ground/15 bg-ivory px-3 py-1"
            >
              <option value={3200}>Slow</option>
              <option value={2400}>Medium</option>
              <option value={1700}>Faster</option>
            </select>
          </label>
        </div>
        <button
          onClick={async () => {
            unlockMedia(); // unlock audio + speech inside the tap so the session can talk (iOS)
            const id = await startSession(mod.id, chosenFocus || undefined);
            setSessionId(id ?? null);
            startedAtRef.current = Date.now();
            setPhase("running");
          }}
          className="mt-6 w-full rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
        >
          {chosenFocus ? `Begin slowly — focus: ${chosenFocus}` : "Begin slowly"}
        </button>
      </div>
    );
  }

  if (phase === "finishing") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center text-olive">Saving…</div>
    );
  }

  if (phase === "ground" || phase === "sudpause") {
    return (
      <div className="mx-auto max-w-xl px-6 py-14">
        <div className="rounded-3xl border border-ground/10 bg-linen p-7 shadow-soft">
          <h1 className="font-serif text-3xl font-medium">
            {phase === "sudpause" ? "Let's pause and settle first" : "Coming back to the room"}
          </h1>
          {phase === "sudpause" && (
            <p className="mt-2 text-olive">
              Your distress is high enough that pushing on isn&apos;t the right move. Ground
              first — then you choose.
            </p>
          )}
          <ol className="mt-5 list-decimal space-y-3 pl-5 text-lg leading-relaxed text-ground/90">
            {GROUNDING_STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
            {calmPlace && <li>Say your calm-place word to yourself: “{calmPlace}”.</li>}
          </ol>
          <div className="mt-7 flex flex-col gap-3">
            <button
              onClick={() => {
                const wasPause = phase === "sudpause";
                setPhase("running");
                if (wasPause) advance();
              }}
              className="rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
            >
              {phase === "sudpause" ? "I'm steadier — continue gently" : "I'm steadier — back to the session"}
            </button>
            <button
              onClick={() => void endSession("abandoned")}
              className="rounded-full border border-ground/20 px-6 py-3.5 text-ground/80 transition-colors hover:bg-moss"
            >
              End the session here — stopping is always allowed
            </button>
            <a href="/crisis" className="text-center text-sm font-semibold text-support underline">
              I need more help than grounding
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "hardstop") {
    return (
      <div className="mx-auto max-w-xl px-6 py-14">
        <div className="rounded-3xl border-2 border-pause/60 bg-pause-soft p-7 shadow-soft">
          <h1 className="font-serif text-3xl font-medium">Session paused for your safety</h1>
          <p className="mt-3 text-ground/90">
            {hardStopReason}. That is the system working as designed — not a failure. Your care
            team has been notified and will review this session.
          </p>
          <div className="mt-5 rounded-3xl bg-linen p-5 text-ground">
            <p className="font-semibold">Ground yourself now</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              <li>Feel your feet on the floor. Press them down.</li>
              <li>Name five things you can see in the room.</li>
              <li>Breathe out longer than you breathe in, five times.</li>
              <li>
                {calmPlace
                  ? `Say your calm-place word to yourself now: “${calmPlace}”.`
                  : "If you saved a calm-place word, say it to yourself now."}
              </li>
            </ol>
          </div>
          <div className="mt-5 flex flex-col gap-3">
            <a
              href="/crisis"
              className="rounded-full bg-support px-5 py-3 text-center font-semibold text-white transition-colors hover:bg-support-deep"
            >
              I need help now
            </a>
            <a
              href="/dashboard"
              className="rounded-full border border-ground/20 px-5 py-3 text-center text-ground/80 transition-colors hover:bg-moss"
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
    <div className="mx-auto max-w-3xl px-6 py-8 pb-28">
      {/* Persistent exit (compliance 4B.1): always visible, one tap, no
          confirmation — instantly halts stimulation and pivots to grounding. */}
      <button
        onClick={() => {
          setBlsStarted(false);
          setPhase("ground");
          void logSafetyEvent("ground_me_pressed", sessionId ?? undefined);
        }}
        className="fixed right-5 bottom-5 z-50 rounded-full bg-support px-7 py-4 text-lg font-bold text-white shadow-soft transition-colors hover:bg-support-deep"
      >
        Ground me
      </button>
      {windDown && (
        <div className="mb-4 rounded-3xl border border-pause/40 bg-pause-soft px-5 py-3 text-sm text-ground">
          You&apos;ve been at this a while. Sessions wind down around {SESSION_WINDDOWN_MIN}{" "}
          minutes — start letting the work settle.
        </div>
      )}
      <div className="flex items-center justify-between text-sm">
        <span className="text-olive">
          {mod.name} · step {stepIndex + 1} of {mod.steps.length}
          {chosenFocus && (
            <span className="ml-2 rounded-full bg-clay/60 px-3 py-0.5 text-xs font-medium text-ground">
              Focus: {chosenFocus}
            </span>
          )}
        </span>
        <div className="flex gap-3">
          <button
            onClick={() => {
              unlockMedia(); // this tap also unlocks speech on iOS
              setVoiceOn((v) => !v);
            }}
            aria-pressed={voiceOn}
            className="text-olive underline"
          >
            {voiceOn ? "🔊 Voice on" : "🔇 Voice off"}
          </button>
          <a href="/crisis" className="font-semibold text-support underline">
            Need help now?
          </a>
          <button
            onClick={() => void endSession("abandoned")}
            className="text-olive underline"
          >
            Exit session
          </button>
        </div>
      </div>

      {step?.kind === "trigger-entry" ? (
        <TriggerEntryStep sessionId={sessionId} text={step.text} onDone={advance} voiceEnabled={voiceEnabled} />
      ) : step?.kind === "instruction" || step?.kind === "grounding" ? (
        <div className="mt-8">
          <h2 className="font-serif text-2xl font-medium">{step.title}</h2>
          {step.beats && step.beats.length > 0 ? (
            <div className="mt-4">
              <NarrationView
                key={stepIndex}
                voice={voiceOn}
                beats={step.beats.map((b) => fillNarrationSlots(b, { calmPlace, name: memberName }))}
              />
            </div>
          ) : (
            <p className="mt-4 text-lg leading-relaxed text-ground/90">{step.text}</p>
          )}

          {liveEnabled && (
            <div className="mt-6">
              {liveTurns.length > 0 && (
                <div className="mb-3 space-y-2" aria-live="polite">
                  {liveTurns.slice(-4).map((t, i) => (
                    <p
                      key={i}
                      className={
                        t.role === "you"
                          ? "text-right text-sm text-olive"
                          : "rounded-2xl bg-linen px-4 py-2 text-[15px] leading-relaxed text-ground/90"
                      }
                    >
                      {t.role === "you" ? `You: ${t.text}` : t.text}
                    </p>
                  ))}
                  {liveBusy && <p className="text-xs text-olive">…</p>}
                </div>
              )}
              <LiveVoice onUtterance={handleUtterance} busy={liveBusy} />
            </div>
          )}

          <button
            onClick={advance}
            className="mt-8 w-full rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
          >
            Continue
          </button>
        </div>
      ) : step?.kind === "suds" ? (
        <div className="mt-8">
          <h2 className="font-serif text-2xl font-medium">{step.title}</h2>
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
            <div className="mt-2 flex justify-between text-sm text-olive">
              <span>0 — no distress</span>
              <span className="text-2xl font-bold text-ground">{currentSuds}</span>
              <span>10 — worst possible</span>
            </div>
          </div>
          <button
            onClick={submitSuds}
            className="mt-8 w-full rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
          >
            Record {currentSuds} and continue
          </button>
        </div>
      ) : step?.kind === "bls" ? (
        <div className="mt-8">
          <h2 className="font-serif text-2xl font-medium">{step.title}</h2>
          <div className="mt-5">
            {blsMode === "audio" ? (
              <BlsAudio
                running={blsStarted && !blsState.resting && blsState.secondsLeft > 0}
                speedMs={speedMs}
              />
            ) : (
              <BlsVisual
                running={blsStarted && !blsState.resting && blsState.secondsLeft > 0}
                speedMs={speedMs}
                soundOn={soundOn}
              />
            )}
          </div>
          {resourcingModule && setActive && (
            <p className="mt-5 text-center font-serif text-2xl text-ground" aria-live="polite">
              {currentCue}
            </p>
          )}
          {!blsStarted ? (
            <button
              onClick={startBls}
              className="mt-6 w-full rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
            >
              Start set 1 of {step.sets ?? 1} ({step.durationSec}s each)
            </button>
          ) : (
            <p className="mt-4 text-center text-lg" aria-live="polite">
              {blsState.resting ? (
                <>Rest. Breathe out slowly… next set in {blsState.secondsLeft}s</>
              ) : (
                <>
                  Set {blsState.set} of {step.sets ?? 1} —{" "}
                  {blsMode === "audio" ? "follow the tones left and right" : "follow the dot with your eyes"}{" "}
                  · {blsState.secondsLeft}s
                </>
              )}
            </p>
          )}
          <p className="mt-3 text-center text-sm text-olive">
            Feeling too much? Use “Exit session” above — stopping is always allowed.
          </p>
        </div>
      ) : null}

      {preSuds !== null && (
        <p className="mt-10 text-center text-xs text-olive">
          Start distress {preSuds} · peak {peakSuds}
        </p>
      )}
    </div>
  );
}
