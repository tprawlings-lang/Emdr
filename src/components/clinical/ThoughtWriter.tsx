"use client";

import { useState } from "react";
import { writeThoughtAction } from "@/lib/clinical/thought-actions";

// Writing a thought instead of speaking it.
//
// §3.1 specifies a recording screen, and audio-first is right for the case it
// was designed for: ninety seconds between sessions, and talking is faster than
// typing. It is wrong as the ONLY door. A clinician who declines the microphone
// prompt, is somewhere they cannot say a patient's business aloud, has no
// working recorder, or simply prefers to type currently cannot put a session
// note anywhere — and memory, threads, follow-ups and Session Prep are all fed
// from thoughts, so audio-only makes that whole chain unreachable for them.
//
// THIS IS THE SAME PIPELINE. What it produces is a thought with no audio whose
// first transcript came from the clinician rather than a service, which is a
// shape the schema already allowed. Everything after — organize, review, keep,
// thread, follow up — runs unchanged, because none of it ever cared where the
// text came from.
//
// IT DOES NOT PRETEND TO BE A RECORDING. The transcript will say it was written
// by the clinician, and this form says so too. A typed note presented as a
// transcript would misrepresent its own provenance, which is the one thing this
// feature is most careful about everywhere else.

export function ThoughtWriter({
  personId,
  personName,
  onWritten,
}: {
  personId: string;
  personName: string;
  onWritten?: (thoughtId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-ground/20 px-4 py-2 text-sm text-app-ink"
      >
        Write it instead
      </button>
    );
  }

  return (
    <form
      action={async (fd) => {
        setBusy(true);
        setError(null);
        try {
          const result = await writeThoughtAction(fd);
          if (!result.ok || !result.thoughtId) {
            setError(result.error ?? "That could not be saved.");
            return;
          }
          setText("");
          setOpen(false);
          onWritten?.(result.thoughtId);
        } finally {
          setBusy(false);
        }
      }}
      className="rounded-2xl border border-ground/10 bg-app-surface px-5 py-5"
    >
      <input type="hidden" name="personId" value={personId} />

      {/* §3.1: the patient's name at the top, so a wrong-person error is caught
          before anything is written rather than after. The same reason the
          recorder shows it. */}
      <p className="text-sm font-medium text-app-ink">A note about {personName}</p>
      <p className="measure mt-1 text-xs text-olive">
        Written by you, not transcribed. It goes to the same place a recorded thought does —
        yours to review, and only what you keep becomes part of the record.
      </p>

      <label className="sr-only" htmlFor={`write-${personId}`}>Your note</label>
      <textarea
        id={`write-${personId}`}
        name="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        maxLength={20_000}
        required
        disabled={busy}
        placeholder="She seemed steadier today. Not calm exactly, but she stayed with it…"
        className="measure mt-3 w-full rounded-xl border border-ground/15 bg-linen px-3 py-2 text-sm text-app-ink"
      />

      {error && <p className="measure mt-3 text-sm text-state-support" role="alert">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          disabled={busy || !text.trim()}
          className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-linen disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save this note"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          disabled={busy}
          className="rounded-full px-4 py-2 text-sm text-olive underline disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
