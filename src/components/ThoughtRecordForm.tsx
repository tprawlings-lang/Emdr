"use client";

import Link from "next/link";
import { useState } from "react";
import { saveThoughtRecordAction } from "@/lib/thought-record-actions";
import { SubmitButton } from "@/components/experience/SubmitButton";

// "Working with a thought" (Handoff 10 2B; CV10_D04). The words are the signed
// pack's, passed in from content/h10-thought-record.ts.
//
// One thing moves, and only because the member chose it: a strength of 8 or
// more at step 2 asks whether to try a grounding skill first, and the rest of
// the record waits until they answer. "Find the room" leaves without saving;
// "Keep going" carries on. Nothing is kept until Save.

export interface ThoughtRecordCopy {
  intro: string;
  steps: ReadonlyArray<{ field: string; question: string; hint?: string }>;
  strengthQuestion: string;
  feelingWordsLabel: string;
  save: string;
  stop: string;
  privacy: string;
  strongAt: number;
  strong: string;
  strongGround: string;
  strongContinue: string;
  groundHref: string;
}

const field = "mt-2 w-full rounded-2xl border border-ground/15 bg-app-surface px-4 py-3 text-ground";

function Scale({ name, label, onPick }: { name: string; label: string; onPick?: (v: number) => void }) {
  return (
    <fieldset className="mt-4">
      <legend className="text-ground">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {Array.from({ length: 11 }, (_, v) => (
          <label key={v} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-ground/15 bg-linen text-sm hover:bg-moss has-checked:border-clay has-checked:bg-clay has-checked:font-semibold">
            <input type="radio" name={name} value={v} className="sr-only" onChange={() => onPick?.(v)} />
            {v}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function ThoughtRecordForm({ copy, stopHref }: { copy: ThoughtRecordCopy; stopHref: string }) {
  const [strength, setStrength] = useState<number | null>(null);
  const [keepGoing, setKeepGoing] = useState(false);
  const strong = strength !== null && strength >= copy.strongAt;
  const rest = strength !== null && (!strong || keepGoing);
  const [situation, feeling, ...later] = copy.steps;

  const numbered = (i: number, s: { question: string; hint?: string }) => (
    <span className="font-medium text-ground">
      <span className="text-olive">{i}. </span>{s.question}
      {s.hint && <span className="mt-0.5 block text-sm font-normal text-olive">{s.hint}</span>}
    </span>
  );

  return (
    <form action={saveThoughtRecordAction} className="mt-6 space-y-6">
      <label className="block">
        {numbered(1, situation)}
        <textarea name="situation" rows={2} maxLength={500} required className={field} />
      </label>

      <div>
        <label className="block">
          {numbered(2, feeling)}
          <input name="feeling" maxLength={60} aria-label={copy.feelingWordsLabel} className={`${field} min-h-11`} />
        </label>
        <Scale name="strengthBefore" label={copy.strengthQuestion} onPick={(v) => { setStrength(v); setKeepGoing(false); }} />
      </div>

      {strong && !keepGoing && (
        <div role="status" className="rounded-3xl border border-ground/10 bg-linen p-5">
          <p className="text-ground">{copy.strong}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href={copy.groundHref} className="inline-flex min-h-11 items-center rounded-full bg-sage px-5 font-medium text-ground hover:bg-sage-deep">
              {copy.strongGround}
            </Link>
            <button type="button" onClick={() => setKeepGoing(true)} className="min-h-11 rounded-full border border-ground/20 px-5 text-ground hover:bg-moss">
              {copy.strongContinue}
            </button>
          </div>
        </div>
      )}

      {rest && later.map((s, i) =>
        s.field === "strengthAfter" ? (
          <Scale key={s.field} name="strengthAfter" label={`${i + 3}. ${s.question}`} />
        ) : (
          <label key={s.field} className="block">
            {numbered(i + 3, s)}
            <textarea name={s.field} rows={2} maxLength={500} className={field} />
          </label>
        )
      )}

      <p className="text-sm text-olive">{copy.privacy}</p>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Saving…" className="rounded-full bg-sage px-6 py-3 font-medium text-ground hover:bg-sage-deep">
          {copy.save}
        </SubmitButton>
        <Link href={stopHref} className="inline-flex min-h-11 items-center rounded-full border border-ground/20 px-6 text-ground hover:bg-moss">
          {copy.stop}
        </Link>
      </div>
    </form>
  );
}
