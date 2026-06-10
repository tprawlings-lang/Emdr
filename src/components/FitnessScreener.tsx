"use client";

import { useState, useTransition } from "react";
import { submitFitnessScreening } from "@/lib/actions";
import type { FitnessItem } from "@/lib/fitness-screener";

// One question per screen (compliance 4A): plain language, no scrolling walls,
// honest framing. Answers are held client-side and submitted once at the end
// as coded values.

export default function FitnessScreener({ items }: { items: FitnessItem[] }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [pending, startTransition] = useTransition();

  const item = items[index];

  const answer = (value: boolean) => {
    const next = { ...answers, [item.id]: value };
    setAnswers(next);
    if (index + 1 < items.length) {
      setIndex(index + 1);
    } else {
      startTransition(async () => {
        await submitFitnessScreening(JSON.stringify(next));
      });
    }
  };

  return (
    <div className="mt-8">
      <div className="flex gap-1.5" aria-hidden="true">
        {items.map((it, i) => (
          <span
            key={it.id}
            className={`h-1.5 flex-1 rounded-full ${i <= index ? "bg-sage" : "bg-sand/60"}`}
          />
        ))}
      </div>
      <p className="mt-6 text-sm text-olive">
        Question {index + 1} of {items.length}
      </p>
      <h2 className="mt-2 font-serif text-2xl font-medium leading-snug">{item.text}</h2>
      {item.note && <p className="mt-3 text-sm text-olive">{item.note}</p>}
      <div className="mt-8 flex gap-3">
        <button
          onClick={() => answer(true)}
          disabled={pending}
          className="flex-1 rounded-full border border-ground/20 px-6 py-3.5 font-medium text-ground transition-colors hover:bg-moss disabled:opacity-50"
        >
          Yes
        </button>
        <button
          onClick={() => answer(false)}
          disabled={pending}
          className="flex-1 rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep disabled:opacity-50"
        >
          No
        </button>
      </div>
      {pending && <p className="mt-4 text-center text-sm text-olive">Saving…</p>}
      <p className="mt-8 text-center text-xs text-olive">
        These questions only work if they&apos;re answered honestly. They exist to keep you
        safe, not to keep you out.
      </p>
    </div>
  );
}
