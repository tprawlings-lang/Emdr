"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createDemoPatientAction } from "@/lib/demo/new-patient-actions";
import {
  DEPTHS, DEPTH_SPECS, PRESENTATIONS, PRESENTATION_SPECS, STAGE_SPECS,
  ONBOARDING_STAGES, includes, type Depth, type Presentation,
} from "@/lib/demo/new-patient";
import type { CreatedPatient } from "@/lib/demo/new-patient-store";

// Creating a fabricated patient (demo only).
//
// THE FORM SHOWS WHAT IT WILL WRITE, BEFORE IT WRITES IT. The stage list below
// updates as the depth changes, so somebody choosing "account only" can see
// that consent, the screener, the instruments and the profile are NOT being
// filled in — which is the point of that choice and would otherwise be
// invisible until they signed in and found out.
//
// AND IT SHOWS THE CREDENTIALS AFTERWARDS. A fabricated account nobody can sign
// in to is a row in a database. The password is the shared demo one and it is
// printed here on purpose: these are invented people in an invented
// environment, and the account exists to be used.

function pct(n: number, of: number): string {
  return of === 0 ? "" : `${n}/${of}`;
}

export function NewPatient({
  clinicians,
}: {
  /** Read on the server, because the choice decides which tenant the patient
   *  joins and a list in the component would drift from the environment. */
  clinicians: Array<{ id: string; name: string }>;
}) {
  const [depth, setDepth] = useState<Depth>("baseline_recorded");
  const [presentation, setPresentation] = useState<Presentation>("moderate");
  const [result, setResult] = useState<CreatedPatient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div data-testid="new-patient">
      <form
        action={(fd) => {
          setError(null);
          fd.set("depth", depth);
          fd.set("presentation", presentation);
          start(async () => {
            const r = await createDemoPatientAction(fd);
            if (!r.ok) { setError(r.error ?? "Could not create the patient."); setResult(null); return; }
            setResult(r.patient ?? null);
          });
        }}
        className="space-y-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="np-name" className="block text-sm font-medium text-ground">
              Name
            </label>
            <input
              id="np-name"
              name="name"
              required
              placeholder="Rowan Blake"
              className="mt-1 w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm text-ground"
            />
            <p className="mt-1 text-xs text-olive">
              &ldquo;(fabricated)&rdquo; is added automatically and travels with them onto every
              screen — a caseload row, a record header, a session brief.
            </p>
          </div>
          <div>
            <label htmlFor="np-email" className="block text-sm font-medium text-ground">
              Sign-in address <span className="font-normal text-olive">(optional)</span>
            </label>
            <input
              id="np-email"
              name="email"
              placeholder="rowan.blake.new@steady.local"
              className="mt-1 w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm text-ground"
            />
            <p className="mt-1 text-xs text-olive">
              Must end in @steady.local. Left blank, one is made from the name.
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="np-clinician" className="block text-sm font-medium text-ground">
            Who will see them
          </label>
          <select
            id="np-clinician"
            name="clinicianId"
            required
            defaultValue={clinicians[0]?.id ?? ""}
            className="mt-1 w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm text-ground"
          >
            {clinicians.map((cl) => (
              <option key={cl.id} value={cl.id}>{cl.name}</option>
            ))}
          </select>
          <p className="measure mt-1 text-xs text-olive">
            This is the assignment. The patient joins that clinician&rsquo;s organization, and a
            caseload is every member in it — so choosing here is what makes them appear in
            somebody&rsquo;s queue rather than in nobody&rsquo;s.
          </p>
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-ground">How far to take them</legend>
          <div className="mt-2 space-y-2">
            {DEPTHS.map((d) => (
              <label
                key={d}
                className={`block cursor-pointer rounded-2xl border px-4 py-3 ${
                  depth === d ? "border-ground bg-linen" : "border-ground/15"
                }`}
              >
                <span className="flex items-baseline gap-2">
                  <input
                    type="radio"
                    name="depth-choice"
                    checked={depth === d}
                    onChange={() => setDepth(d)}
                    className="mt-1"
                  />
                  <span className="text-sm font-medium text-ground">{DEPTH_SPECS[d].label}</span>
                </span>
                <span className="measure mt-1 block pl-6 text-xs text-olive">
                  {DEPTH_SPECS[d].purpose}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* What will and will not be written. Shown before the button, because
            "account only" means four things are deliberately left undone and
            that is invisible otherwise. */}
        <div className="rounded-2xl border border-ground/10 bg-linen px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-olive">
            What this writes
          </p>
          <ul className="mt-2 space-y-1.5">
            {ONBOARDING_STAGES.map((s) => {
              const on = includes(depth, s);
              return (
                <li key={s} data-stage={s} data-included={on ? "yes" : "no"} className="text-sm">
                  <span aria-hidden className={on ? "text-state-safe" : "text-olive"}>
                    {on ? "◆" : "○"}
                  </span>{" "}
                  <span className={on ? "text-ground" : "text-olive"}>
                    {STAGE_SPECS[s].label}
                  </span>
                  <span className="measure block pl-5 text-xs text-olive">
                    {on ? STAGE_SPECS[s].what : `Left for them to do. ${STAGE_SPECS[s].what}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-ground">Baseline presentation</legend>
          <p className="measure mt-1 text-xs text-olive">
            Only used when a baseline is recorded. Each preset is consistent across all five
            instruments, so the record reads as one person rather than as five numbers. None of
            them screens positive for risk — a fabricated crisis in a clinician&rsquo;s queue is
            a fire drill nobody asked for.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRESENTATIONS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPresentation(p)}
                aria-pressed={presentation === p}
                title={PRESENTATION_SPECS[p].note}
                className={`rounded-full border px-4 py-2 text-sm ${
                  presentation === p
                    ? "border-ground bg-ground text-ivory"
                    : "border-ground/20 text-ground hover:bg-linen"
                }`}
              >
                {PRESENTATION_SPECS[p].label}
              </button>
            ))}
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-ground px-6 py-3 text-sm font-medium text-ivory disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create this patient"}
        </button>
      </form>

      {error && (
        <p role="alert" className="measure mt-4 text-sm text-state-support">
          {error}
        </p>
      )}

      {result && (
        <div data-testid="new-patient-result" className="mt-6 rounded-2xl border border-state-safe/40 bg-state-safe-bg/40 p-5">
          <h3 className="text-sm font-semibold text-ground">{result.name} exists</h3>
          <dl className="mt-3 grid grid-cols-[1fr_auto] items-baseline gap-x-3 text-sm">
            <dt className="text-ground">Sign in as</dt>
            <dd className="font-mono text-xs text-ground">{result.email}</dd>
            <dd className="col-span-2 font-mono text-xs text-olive">
              password: {result.password}
            </dd>
          </dl>
          <p className="measure mt-3 text-sm text-ground">{DEPTH_SPECS[depth].next}</p>

          {result.baseline.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-olive">
                Baseline recorded
              </p>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {result.baseline.map((b) => (
                  <li key={b.instrument} className="font-mono text-xs text-ground">
                    {b.instrument} {b.total}
                    {b.positive ? " (above cutoff)" : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/clinician/patients" className="text-sm font-medium text-state-info underline">
              Find them in the patient directory
            </Link>
            <Link href="/clinician/caseload" className="text-sm font-medium text-state-info underline">
              See them in the caseload
            </Link>
            <Link href={`/clinician/member/${result.userId}`} className="text-sm font-medium text-state-info underline">
              Open their record
            </Link>
          </p>
          <p className="measure mt-3 text-xs text-olive">
            Stages written: {result.stagesRun.join(", ")} ({pct(result.stagesRun.length, ONBOARDING_STAGES.length)}).
            Everything else is theirs to do.
          </p>
        </div>
      )}
    </div>
  );
}
