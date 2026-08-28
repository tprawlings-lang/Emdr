"use client";
import { useState } from "react";
import Link from "next/link";
import { completePractice } from "@/lib/actions";
import type { Practice } from "@/lib/practices";
import BreathePacer from "./BreathePacer";

export default function BreatheLibrary({ practices }: { practices: Practice[] }) {
  const [selected, setSelected] = useState<Practice | null>(null);
  const [done, setDone] = useState(false);

  const handleDone = (elapsedSec: number) => {
    if (selected && elapsedSec >= 20) void completePractice(selected.id, elapsedSec);
    setDone(true);
  };

  // ── Player ──
  if (selected && !done) {
    return (
      <main className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center gap-8 px-6 py-12 text-center">
        <BreathePacer practice={selected} onDone={handleDone} />
        {selected.note && <p className="max-w-sm text-sm text-olive">{selected.note}</p>}
      </main>
    );
  }
  if (selected && done) {
    return (
      <main className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center gap-6 px-6 py-12 text-center">
        <h1 className="type-display text-3xl font-medium">Nicely done</h1>
        <p className="text-olive">That&apos;s a small, real act of care. Your breath is always here to come back to.</p>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setDone(false);
            }}
            className="rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
          >
            Another pattern
          </button>
          <Link href="/dashboard" className="text-sm text-olive underline">
            Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  // ── Library ──
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="type-display text-3xl font-medium">Breathe</h1>
      <p className="mt-2 text-olive">
        A few minutes of paced breathing to settle your system — before a session, or any time. Pick one that
        feels right; there&apos;s no wrong choice.
      </p>
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
              <span className="text-xs text-olive">
                {Math.round(p.durationSec / 60)} min{!p.hasHold && " · no breath-holds"}
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
