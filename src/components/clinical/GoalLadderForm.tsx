"use client";

import { useState } from "react";
import {
  createGoalAction, confirmGoalAction, recordObservationAction,
  recordPatientReportAction, decideObservationAction,
} from "@/lib/clinical/goal-actions";
// The VOCABULARY module, not the store. This runs in the browser and the store
// reaches better-sqlite3; the build refuses that, correctly.
import {
  GOAL_DOMAINS, GOAL_LEVELS, DOMAIN_LABEL, LEVEL_LABEL,
  BASELINE_NOTE, COMPLETION_NOTE, EVIDENCE_LABEL,
  type GoalDomain, type GoalLevel,
} from "@/lib/clinical/return-to-life-vocabulary";

// Creating a goal, and recording evidence against one (handoff 01 §9).
//
// THE PATIENT'S OWN STATEMENT IS THE FIRST FIELD, and the ladder comes after
// it. §9: "natural statement first, optional AI organization second." A form
// that opened with five level boxes would be asking a clinician to write a
// scale, and the goal would end up being whatever fits the scale.
//
// THE LEVELS ARE LABELLED IN WORDS. §9: "show levels in plain language, not
// clinical scoring language." Nothing on this form says -2. A person reading
// their own goal should not have to learn a scale to recognise themselves in
// it, and the labels come from the domain so the clinician's form and the
// patient's view cannot word them differently.
//
// RECORDING EVIDENCE IS TWO BUTTONS, NOT A DROPDOWN. "They told me" and "I saw
// it" post to different actions. A single control with a source selector is one
// mis-click away from filing a patient's words as a clinician's observation,
// and §1 keeps those apart precisely because they carry different weight later.

export function NewGoalForm({ personId }: { personId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    try {
      const r = await createGoalAction(form);
      if (!r.ok) { setError(r.error ?? "That could not be saved."); return; }
      setDone(true);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="text-sm text-state-safe">
        <span aria-hidden>◆</span> Saved as a draft. Confirm it below when the patient has agreed
        to the wording.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button" onClick={() => setOpen(true)}
        className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-linen"
      >
        Add a life goal
      </button>
    );
  }

  return (
    <form action={submit} className="space-y-4">
      <input type="hidden" name="personId" value={personId} />

      <label className="block text-sm">
        <span className="mb-1 block text-olive">In their words — what do they want to be able to do?</span>
        <textarea
          name="patientStatement" rows={2} maxLength={1000} required
          placeholder="I want to shop without needing someone with me."
          className="measure w-full rounded-xl border border-ground/20 bg-linen px-3 py-2 text-sm text-app-ink"
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block text-olive">Why it matters to them</span>
        <textarea
          name="whyItMatters" rows={2} maxLength={1000}
          placeholder="I want my independence back."
          className="measure w-full rounded-xl border border-ground/20 bg-linen px-3 py-2 text-sm text-app-ink"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-olive">Short name for it</span>
          <input
            name="title" maxLength={160} required placeholder="Grocery shopping alone"
            className="w-full rounded-xl border border-ground/20 bg-linen px-3 py-2 text-sm text-app-ink"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-olive">Part of life</span>
          <select
            name="domain" required defaultValue=""
            className="w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
          >
            <option value="" disabled>Choose…</option>
            {GOAL_DOMAINS.map((d: GoalDomain) => (
              <option key={d} value={d}>{DOMAIN_LABEL[d]}</option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="rounded-xl border border-ground/15 px-4 py-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-olive">
          Five steps, in plain words
        </legend>
        <p className="measure mt-1 text-xs text-olive">{BASELINE_NOTE}</p>
        <div className="mt-3 space-y-3">
          {GOAL_LEVELS.map((level) => (
            <label key={level} className="block text-sm">
              <span className="mb-1 block text-olive">{LEVEL_LABEL[level]}</span>
              <input
                name={`level_${level}`} maxLength={500} required
                className="measure w-full rounded-xl border border-ground/20 bg-linen px-3 py-2 text-sm text-app-ink"
              />
            </label>
          ))}
        </div>
      </fieldset>

      {error && <p className="measure text-sm text-state-support" role="alert">{error}</p>}

      <div className="flex flex-wrap gap-3">
        <button
          disabled={busy}
          className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-linen disabled:opacity-50"
        >
          Save as a draft
        </button>
        <button
          type="button" onClick={() => setOpen(false)} disabled={busy}
          className="rounded-full px-4 py-2 text-sm text-olive underline"
        >
          Cancel
        </button>
      </div>
      <p className="measure text-xs text-olive">
        It stays a draft until you confirm it with them. {COMPLETION_NOTE}
      </p>
    </form>
  );
}

export function ConfirmGoal({ goalId, personId }: { goalId: string; personId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      action={async (fd) => {
        setBusy(true); setError(null);
        try {
          const r = await confirmGoalAction(fd);
          if (!r.ok) setError(r.error ?? "That could not be saved.");
        } finally { setBusy(false); }
      }}
      className="mt-3"
    >
      <input type="hidden" name="goalId" value={goalId} />
      <input type="hidden" name="personId" value={personId} />
      <button
        disabled={busy}
        className="rounded-full bg-app-ink px-3.5 py-1.5 text-sm font-medium text-linen disabled:opacity-50"
      >
        Confirm with the patient
      </button>
      {error && <p className="mt-2 text-sm text-state-support" role="alert">{error}</p>}
    </form>
  );
}

export function RecordEvidence({
  goalId, personId, rungs,
}: {
  goalId: string;
  personId: string;
  rungs: { level: GoalLevel; description: string }[];
}) {
  const [source, setSource] = useState<"patient" | "clinician" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  if (saved) return <p className="mt-3 text-sm text-state-safe">{saved}</p>;

  if (!source) {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {/* Two buttons, two actions. A source dropdown would be one mis-click
            from filing a patient's words as a clinician's observation. */}
        <button
          type="button" onClick={() => setSource("patient")}
          className="rounded-full border border-ground/20 px-3.5 py-1.5 text-sm text-app-ink"
        >
          {EVIDENCE_LABEL.patient_reported}
        </button>
        <button
          type="button" onClick={() => setSource("clinician")}
          className="rounded-full border border-ground/20 px-3.5 py-1.5 text-sm text-app-ink"
        >
          {EVIDENCE_LABEL.clinician_observed}
        </button>
      </div>
    );
  }

  return (
    <form
      action={async (fd) => {
        setBusy(true); setError(null);
        try {
          const r = source === "patient"
            ? await recordPatientReportAction(fd)
            : await recordObservationAction(fd);
          if (!r.ok) { setError(r.error ?? "That could not be saved."); return; }
          setSaved(
            source === "patient"
              ? "Recorded as what they told you."
              : "Recorded as what you saw."
          );
        } finally { setBusy(false); }
      }}
      className="mt-3 space-y-3 border-t border-ground/10 pt-3"
    >
      <input type="hidden" name="goalId" value={goalId} />
      <input type="hidden" name="personId" value={personId} />
      <p className="text-xs text-olive">
        {source === "patient" ? EVIDENCE_LABEL.patient_reported : EVIDENCE_LABEL.clinician_observed}
      </p>
      <fieldset className="space-y-1.5">
        <legend className="sr-only">Which step</legend>
        {rungs.map((r) => (
          <label key={r.level} className="flex items-start gap-2 text-sm">
            <input type="radio" name="level" value={r.level} required className="mt-1" />
            <span>
              <span className="text-olive">{LEVEL_LABEL[r.level]} — </span>
              <span className="text-app-ink">{r.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="block text-sm">
        <span className="mb-1 block text-olive">Anything worth noting</span>
        <input
          name="note" maxLength={1000}
          className="w-full rounded-xl border border-ground/20 bg-linen px-3 py-2 text-sm text-app-ink"
        />
      </label>
      {error && <p className="text-sm text-state-support" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy}
          className="rounded-full bg-app-ink px-3.5 py-1.5 text-sm font-medium text-linen disabled:opacity-50"
        >
          Record it
        </button>
        <button
          type="button" onClick={() => setSource(null)} disabled={busy}
          className="rounded-full px-3.5 py-1.5 text-sm text-olive underline"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function DecideObservation({
  observationId, personId, label,
}: {
  observationId: string;
  personId: string;
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  if (done) return <p className="mt-2 text-sm text-state-safe">{done}</p>;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-xs text-olive">{label}</span>
      {(["accepted", "rejected"] as const).map((decision) => (
        <form
          key={decision}
          action={async (fd) => {
            setBusy(true);
            try {
              const r = await decideObservationAction(fd);
              if (r.ok) setDone(decision === "accepted" ? "Accepted as evidence." : "Not related — dismissed.");
            } finally { setBusy(false); }
          }}
        >
          <input type="hidden" name="observationId" value={observationId} />
          <input type="hidden" name="personId" value={personId} />
          <input type="hidden" name="decision" value={decision} />
          <button
            disabled={busy}
            className={`rounded-full px-3 py-1 text-sm disabled:opacity-50 ${
              decision === "accepted"
                ? "bg-app-ink font-medium text-linen"
                : "border border-ground/20 text-app-ink"
            }`}
          >
            {decision === "accepted" ? "Accept" : "Not related"}
          </button>
        </form>
      ))}
    </div>
  );
}
