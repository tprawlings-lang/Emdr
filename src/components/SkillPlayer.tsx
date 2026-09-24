"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SkillStep } from "@/lib/practices";
import { completePractice } from "@/lib/actions";
import { useSpeech } from "@/components/useSpeech";

// A skill, one step per screen (Handoff 10 1A).
//
// Back / Continue / Stop. STOP IS ONE TAP, with no confirmation and no "are you
// sure" — it returns to the library, because a member who wants out of a
// grounding skill is exactly the member a dialog would fail. A step with
// `minSeconds` holds Continue until that time has passed; nothing moves on its
// own. The voice reads each step with on-device speech and can be turned off;
// the text is always on screen.

export default function SkillPlayer({
  skillId,
  title,
  steps,
  voiceDefault = false,
}: {
  skillId: string;
  title: string;
  steps: SkillStep[];
  voiceDefault?: boolean;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [voiceOn, setVoiceOn] = useState(voiceDefault);
  // When the current step opened. Continue waits until `minSeconds` after it;
  // a tick re-renders the countdown, and moving steps resets it in the same
  // event that moves them, so no effect has to set state after the fact.
  const [stepOpenedAt, setStepOpenedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const started = useRef<number | null>(null);
  const { speak, cancel, supported } = useSpeech(voiceOn);
  const step = steps[index];
  const last = index === steps.length - 1;
  const need = step?.minSeconds ?? 0;
  const waitLeft = need > 0 && stepOpenedAt !== null && now !== null
    ? Math.min(need, Math.max(0, Math.ceil(need - (now - stepOpenedAt) / 1000)))
    : need > 0 && stepOpenedAt === null ? need : 0;

  useEffect(() => {
    if (step) speak(step.text);
    return () => cancel();
  }, [index, step, speak, cancel]);

  useEffect(() => {
    // The clock is read in effects and events only, never during render.
    if (started.current === null) started.current = Date.now();
    const t = setInterval(() => {
      const at = Date.now();
      setNow(at);
      setStepOpenedAt((s) => s ?? at);
    }, 250);
    return () => clearInterval(t);
  }, []);

  const goTo = (i: number) => {
    setIndex(i);
    setStepOpenedAt(Date.now());
  };

  if (!step) return null;

  const stop = () => {
    cancel();
    router.push("/app/activities/skills");
  };

  const next = async () => {
    if (!last) {
      goTo(index + 1);
      return;
    }
    cancel();
    await completePractice(skillId, (Date.now() - (started.current ?? Date.now())) / 1000);
    router.push("/app/activities/skills?done=1");
  };

  return (
    <div className="mx-auto max-w-xl">
      <div className="flex items-center justify-between text-sm text-olive">
        <span>
          {title} · step {index + 1} of {steps.length}
        </span>
        {supported && (
          <button type="button" onClick={() => setVoiceOn((v) => !v)} aria-pressed={voiceOn} className="underline">
            {voiceOn ? "Voice on" : "Voice off"}
          </button>
        )}
      </div>

      <p className="type-display mt-8 text-2xl leading-relaxed text-ground" aria-live="polite">
        {step.text}
      </p>

      <div className="mt-10 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => void next()}
          disabled={waitLeft > 0}
          className="rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep disabled:cursor-not-allowed disabled:opacity-60"
        >
          {waitLeft > 0 ? `Stay with this for ${waitLeft} more second${waitLeft === 1 ? "" : "s"}` : last ? "Finish" : "Continue"}
        </button>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => goTo(Math.max(0, index - 1))}
            disabled={index === 0}
            className="flex-1 rounded-full border border-ground/20 px-6 py-3 text-ground/80 transition-colors hover:bg-moss disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            onClick={stop}
            className="flex-1 rounded-full border border-ground/20 px-6 py-3 text-ground/80 transition-colors hover:bg-moss"
          >
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}
