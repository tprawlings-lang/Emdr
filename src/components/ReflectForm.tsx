"use client";

import { useState } from "react";
import { saveActivityAction } from "@/lib/program-actions";
import { SubmitButton } from "@/components/experience/SubmitButton";

// "Try it and notice" (Handoff 10 1B unit 3; CV10_B03).
//
// What shows next depends on the answer, and only on it: "Did it" or "Partly"
// opens the two optional ratings and a note; "Not this time" offers to make the
// step smaller and NEVER asks why. Nothing appears or moves until the member
// chooses. The ratings are stored, not shown back — there is no total here,
// and none anywhere outside Progress.

export interface ReflectCopy {
  prompt: string;
  outcomes: readonly string[];
  mastery: string;
  enjoyment: string;
  noticed: string;
  notThisTime: string;
  notThisTimeChoices: readonly string[];
}

const OUTCOME_VALUE = ["did", "partly", "not"] as const;
const CHOICE_VALUE = ["smaller", "keep", "skip"] as const;

function Scale({ name, label }: { name: string; label: string }) {
  return (
    <fieldset className="mt-5">
      <legend className="font-medium text-ground">
        {label} <span className="text-sm font-normal text-olive">Optional</span>
      </legend>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {Array.from({ length: 11 }, (_, v) => (
          <label key={v} className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-ground/15 bg-linen text-sm hover:bg-moss has-checked:border-clay has-checked:bg-clay has-checked:font-semibold">
            <input type="radio" name={name} value={v} className="sr-only" />
            {v}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function ReflectForm({
  programId, unitId, planned, copy,
}: { programId: string; unitId: string; planned: readonly string[]; copy: ReflectCopy }) {
  const [outcome, setOutcome] = useState<(typeof OUTCOME_VALUE)[number] | null>(null);

  return (
    <form action={saveActivityAction} className="mt-6">
      <input type="hidden" name="kind" value="activity-reflect" />
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="unitId" value={unitId} />

      <fieldset>
        <legend className="sr-only">Which one</legend>
        <div className="space-y-2">
          {planned.map((p, i) => (
            <label key={p} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border border-ground/10 bg-linen px-4 py-2 has-checked:border-clay has-checked:bg-clay/40">
              <input type="radio" name="planItem" value={p} defaultChecked={i === 0} required />
              <span className="text-ground">{p}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="font-medium text-ground">{copy.prompt}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {copy.outcomes.map((label, i) => (
            <label key={label} className="cursor-pointer rounded-full border border-ground/15 bg-linen px-5 py-2.5 text-sm hover:bg-moss has-checked:border-clay has-checked:bg-clay has-checked:font-semibold">
              <input
                type="radio" name="outcome" value={OUTCOME_VALUE[i]} className="sr-only" required
                onChange={() => setOutcome(OUTCOME_VALUE[i])}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {(outcome === "did" || outcome === "partly") && (
        <>
          <Scale name="mastery" label={copy.mastery} />
          <Scale name="enjoyment" label={copy.enjoyment} />
          <label className="mt-5 block">
            <span className="font-medium text-ground">{copy.noticed} <span className="text-sm font-normal text-olive">Optional</span></span>
            <textarea name="noticed" rows={2} maxLength={500} className="mt-2 w-full rounded-2xl border border-ground/15 bg-app-surface px-4 py-3 text-ground" />
          </label>
          <SubmitButton pendingLabel="Saving…" className="mt-6 rounded-full bg-sage px-6 py-3 font-medium text-ground hover:bg-sage-deep">
            Save
          </SubmitButton>
        </>
      )}

      {outcome === "not" && (
        <div role="status" className="mt-6 rounded-3xl border border-ground/10 bg-linen p-5">
          <p className="measure text-ground/90">{copy.notThisTime}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {copy.notThisTimeChoices.map((label, i) => (
              <SubmitButton
                key={label}
                name="notThisTime"
                value={CHOICE_VALUE[i]}
                pendingLabel="Saving…"
                className={i === 0
                  ? "rounded-full bg-sage px-5 py-2.5 text-sm font-medium text-ground hover:bg-sage-deep"
                  : "rounded-full border border-ground/20 px-5 py-2.5 text-sm text-ground/80 hover:bg-moss"}
              >
                {label}
              </SubmitButton>
            ))}
          </div>
        </div>
      )}
    </form>
  );
}
