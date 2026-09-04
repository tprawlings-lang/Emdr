"use client";

import { useState } from "react";
import {
  recordInterventionAction, confirmInstanceAction, remapInstanceAction,
  suggestNormalizationAction,
} from "@/lib/clinical/intervention-actions";
// The VOCABULARY module, not the store. This runs in the browser and the store
// reaches better-sqlite3; the build refuses that, correctly.
import {
  INTERVENTION_CLASSES, CLASS_LABEL, CLASS_NOTE,
} from "@/lib/clinical/intervention-vocabulary";

// Recording an intervention that happened outside Steady, and correcting how
// Steady named one (expansion handoff 02 §2, §7, §12).
//
// THE FORM ASKS WHAT AND WHEN, AND NOT WHETHER IT HELPED. There is no outcome
// field here, deliberately. §12's Phase 1 definition of done is "instances
// reconstruct from source events" and "no benefit labels yet"; a "did it work?"
// dropdown on the entry form would collect exactly the judgement §6 says must
// come from evidence in named windows, in a single box with no window at all.
//
// THE CLASS IS A RADIO, NOT A FREE FIELD. §2's seven classes are the ontology
// the whole feature counts on; a text box would produce "grounding ",
// "Grounding" and "grounding exercise" and split one person's evidence three
// ways under §6's thresholds.

export function InterventionEntryForm({ personId }: { personId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Candidates for what the wording might already mean (§8). SHOWN, never
  // applied: the clinician either recognises one and reuses their own earlier
  // words, or ignores it. Nothing here changes what gets saved.
  const [candidates, setCandidates] = useState<
    Array<{ definitionId: string; displayName: string; reason: string }>
  >([]);

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    try {
      const r = await recordInterventionAction(form);
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
        <span aria-hidden>◆</span> Recorded. It joins the record below as something that happened —
        what followed it is recorded separately.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-linen"
      >
        Record something you did
      </button>
    );
  }

  return (
    <form action={submit} className="space-y-4">
      <input type="hidden" name="personId" value={personId} />

      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wide text-olive">
          What did you do
        </span>
        <input
          name="wording"
          required
          maxLength={160}
          placeholder="Cold water at the sink"
          onBlur={async (e) => {
            const r = await suggestNormalizationAction(e.currentTarget.value);
            setCandidates(r.candidates);
          }}
          className="mt-1 w-full rounded-xl border border-ground/20 bg-linen px-3 py-2 text-sm text-app-ink"
        />
        <span className="mt-1 block text-xs text-olive">
          Use the words you would use with a colleague. Steady keys on them so the same thing
          counts as the same thing next time.
        </span>
        {candidates.length > 0 && (
          <div className="mt-2 rounded-xl border border-ground/15 px-3 py-2">
            <p className="text-xs text-olive">
              You may already have recorded this. Reusing your own earlier wording keeps the
              exposures counted together; typing something new records it as a different thing.
            </p>
            <ul className="mt-1 space-y-0.5">
              {candidates.map((c) => (
                <li key={c.definitionId} className="text-xs text-app-ink">
                  {c.displayName}{" "}
                  <span className="text-olive">— {c.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </label>

      <fieldset>
        <legend className="text-xs font-semibold uppercase tracking-wide text-olive">
          What kind of thing was it
        </legend>
        <div className="mt-2 space-y-1.5">
          {INTERVENTION_CLASSES.map((cls) => (
            <label key={cls} className="flex items-start gap-2 text-sm text-app-ink">
              <input
                type="radio"
                name="interventionClass"
                value={cls}
                required
                className="mt-1"
                defaultChecked={cls === "external_clinician_entered"}
              />
              <span>
                {CLASS_LABEL[cls]}
                <span className="block text-xs text-olive">{CLASS_NOTE[cls]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wide text-olive">When</span>
        <input
          type="date"
          name="occurredAt"
          className="mt-1 w-full rounded-xl border border-ground/20 bg-linen px-3 py-2 text-sm text-app-ink"
        />
      </label>

      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wide text-olive">
          Anything about the circumstances (optional)
        </span>
        <textarea
          name="note"
          rows={2}
          maxLength={500}
          placeholder="After a difficult phone call, before the session."
          className="mt-1 w-full rounded-xl border border-ground/20 bg-linen px-3 py-2 text-sm text-app-ink"
        />
        <span className="mt-1 block text-xs text-olive">
          The circumstances, not the result. What followed goes on the record as its own
          observation, with its own source.
        </span>
      </label>

      {error && <p className="text-sm text-state-support">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-linen disabled:opacity-50"
        >
          {busy ? "Saving…" : "Record it"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-olive underline"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Accept the name Steady gave one exposure. §8 keeps this with a person: the
 *  model and the adapters may propose an identity, never agree to one. */
export function ConfirmInstance({
  instanceId, personId,
}: { instanceId: string; personId: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (done) return <span className="text-xs text-state-safe">Confirmed</span>;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await confirmInstanceAction(instanceId, personId);
          if (r.ok) setDone(true);
        } finally {
          setBusy(false);
        }
      }}
      className="rounded-full border border-ground/20 px-2.5 py-1 text-xs text-app-ink disabled:opacity-50"
    >
      {busy ? "…" : "That's right"}
    </button>
  );
}

/** Move one exposure to a different intervention. The correction appends — the
 *  name it moved away from stays in history (§7). */
export function RemapInstance({
  instanceId, personId, options, currentDefinitionId,
}: {
  instanceId: string;
  personId: string;
  options: Array<{ id: string; displayName: string }>;
  currentDefinitionId: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = options.filter((o) => o.id !== currentDefinitionId);
  if (others.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-olive underline"
      >
        Not that
      </button>
    );
  }

  return (
    <form
      action={async (form: FormData) => {
        setBusy(true);
        setError(null);
        try {
          const r = await remapInstanceAction(form);
          if (!r.ok) { setError(r.error ?? "That could not be saved."); return; }
          setOpen(false);
        } finally {
          setBusy(false);
        }
      }}
      className="mt-2 w-full space-y-2 rounded-xl border border-ground/15 px-3 py-2"
    >
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="instanceId" value={instanceId} />
      <label className="block text-xs text-olive">
        It was actually
        <select
          name="toDefinitionId"
          required
          className="mt-1 w-full rounded-lg border border-ground/20 bg-linen px-2 py-1.5 text-sm text-app-ink"
        >
          {others.map((o) => (
            <option key={o.id} value={o.id}>{o.displayName}</option>
          ))}
        </select>
      </label>
      <input
        name="reason"
        maxLength={300}
        placeholder="Why (optional)"
        className="w-full rounded-lg border border-ground/20 bg-linen px-2 py-1.5 text-xs text-app-ink"
      />
      {error && <p className="text-xs text-state-support">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-app-ink px-3 py-1 text-xs text-linen disabled:opacity-50"
        >
          {busy ? "…" : "Correct it"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-olive underline">
          Cancel
        </button>
      </div>
    </form>
  );
}
