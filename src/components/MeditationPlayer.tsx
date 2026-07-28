"use client";
import { useEffect, useRef, useState } from "react";
import type { Practice } from "@/lib/practices";
import { useSpeech } from "./useSpeech";

// Guided-meditation player (roadmap F2). Steps through a practice's segments,
// reading each aloud on-device (optional) and holding it on screen for its
// pace. No media is streamed — the script is deterministic data and the voice
// is the same on-device TTS the sessions use. Calls onDone with elapsed seconds
// when the script finishes (or when the member ends early after a real stretch).
export default function MeditationPlayer({
  practice,
  voiceDefault,
  onDone,
}: {
  practice: Practice;
  voiceDefault: boolean;
  onDone: (elapsedSec: number) => void;
}) {
  const segments = practice.segments ?? [];
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [voiceOn, setVoiceOn] = useState(voiceDefault);
  const startedAt = useRef(Date.now());
  const { speak, cancel, supported } = useSpeech(voiceOn);

  // Advance through segments while playing. Each segment is spoken once on
  // entry, then held for its `seconds` before moving on. Pausing clears the
  // timer and stops speech; resuming restarts the current beat.
  useEffect(() => {
    if (!playing || segments.length === 0) return;
    const seg = segments[idx];
    if (voiceOn) speak(seg.text);
    const t = setTimeout(() => {
      if (idx + 1 < segments.length) {
        setIdx((i) => i + 1);
      } else {
        cancel();
        onDone(Math.round((Date.now() - startedAt.current) / 1000));
      }
    }, seg.seconds * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, playing, voiceOn]);

  useEffect(() => () => cancel(), [cancel]);

  if (segments.length === 0) return null;
  const seg = segments[idx];
  const progress = Math.round(((idx + 1) / segments.length) * 100);

  function togglePlay() {
    if (playing) cancel();
    setPlaying((p) => !p);
  }
  function endEarly() {
    cancel();
    onDone(Math.round((Date.now() - startedAt.current) / 1000));
  }

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-between gap-8 px-6 py-12 text-center">
      <div className="w-full">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-moss">
          <div className="h-full rounded-full bg-sage-deep transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 text-xs text-olive">{practice.title}</p>
      </div>

      <p className="font-serif text-2xl leading-relaxed text-ground">{seg.text}</p>

      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={togglePlay}
            className="rounded-full bg-sage px-8 py-3 font-medium text-ground transition-colors hover:bg-sage-deep"
          >
            {playing ? "Pause" : "Resume"}
          </button>
          {supported && (
            <button
              type="button"
              onClick={() => setVoiceOn((v) => !v)}
              aria-pressed={voiceOn}
              className="rounded-full border border-ground/20 px-5 py-3 text-sm text-ground/80 transition-colors hover:bg-moss"
            >
              {voiceOn ? "Voice on" : "Voice off"}
            </button>
          )}
        </div>
        <button type="button" onClick={endEarly} className="text-sm text-olive underline">
          I&apos;m done
        </button>
      </div>
    </main>
  );
}
