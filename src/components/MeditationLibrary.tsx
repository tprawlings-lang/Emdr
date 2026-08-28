"use client";
import { useState } from "react";
import Link from "next/link";
import { completePractice } from "@/lib/actions";
import type { Practice } from "@/lib/practices";
import MeditationPlayer from "./MeditationPlayer";

// Copy that differs between the meditation and sleep libraries. Same player,
// same completion mechanics — only the framing changes.
export interface LibraryCopy {
  heading: string;
  intro: string;
  doneTitle: string;
  doneBody: string;
  anotherLabel: string;
  footnote: string;
}

const MEDITATION_COPY: LibraryCopy = {
  heading: "Meditate",
  intro:
    "Short, guided practices to steady and soothe — grounding, breath, calm-place, self-compassion. Read aloud, or follow along as text. Pick whatever feels right; there's no wrong choice.",
  doneTitle: "That was time well spent",
  doneBody:
    "You gave yourself a few quiet minutes. That's a real act of care — and it's always here when you need it.",
  anotherLabel: "Another practice",
  footnote:
    "Gentler, more grounding practices come first on days your check-in suggests taking it easy. Stop any time.",
};

// Meditation / sleep library (roadmap F2 / F5). Backend-served, safety-ordered
// for today's check-in (gentler practices first on elevated days); the client
// renders the guided player. Deterministic scripts — no streamed media.
export default function MeditationLibrary({
  practices,
  voiceDefault,
  copy = MEDITATION_COPY,
}: {
  practices: Practice[];
  voiceDefault: boolean;
  copy?: LibraryCopy;
}) {
  const [selected, setSelected] = useState<Practice | null>(null);
  const [done, setDone] = useState(false);

  const handleDone = (elapsedSec: number) => {
    // Count it once the member has genuinely settled in (roughly a third of
    // the guided length, min 30s) — a glance shouldn't log a practice.
    const threshold = Math.max(30, Math.round((selected?.durationSec ?? 90) / 3));
    if (selected && elapsedSec >= threshold) void completePractice(selected.id, elapsedSec);
    setDone(true);
  };

  if (selected && !done) {
    return (
      <>
        <MeditationPlayer practice={selected} voiceDefault={voiceDefault} onDone={handleDone} />
        {selected.note && (
          <p className="mx-auto max-w-md px-6 pb-10 text-center text-sm text-olive">{selected.note}</p>
        )}
      </>
    );
  }
  if (selected && done) {
    return (
      <main className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center gap-6 px-6 py-12 text-center">
        <h1 className="type-display text-3xl font-medium">{copy.doneTitle}</h1>
        <p className="text-olive">{copy.doneBody}</p>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setDone(false);
            }}
            className="rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
          >
            {copy.anotherLabel}
          </button>
          <Link href="/dashboard" className="text-sm text-olive underline">
            Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="type-display text-3xl font-medium">{copy.heading}</h1>
      <p className="mt-2 text-olive">{copy.intro}</p>
      <div className="mt-8 space-y-3">
        {practices.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setDone(false);
              setSelected(p);
            }}
            className="w-full rounded-3xl border border-ground/10 bg-linen p-5 text-left shadow-soft transition-colors hover:bg-moss"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="type-display text-xl text-ground">{p.title}</span>
              <span className="text-xs text-olive">{Math.round(p.durationSec / 60)} min</span>
            </div>
            <p className="mt-1 text-sm text-olive">{p.intro}</p>
          </button>
        ))}
      </div>
      <p className="mt-6 text-center text-xs text-olive">{copy.footnote}</p>
    </main>
  );
}
