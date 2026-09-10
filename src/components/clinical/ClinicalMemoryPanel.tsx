"use client";

import { useState } from "react";
import { correctMemoryItemAction } from "@/lib/clinical/thought-actions";
import { createThreadWithItemAction } from "@/lib/clinical/thread-actions";

// Approved clinical memory (§5's layer 2), and the two things a clinician can
// do with it.
//
// THIS PANEL EXISTED AS A GAP FOR A WHILE, and the gap is worth naming: Phase 2
// built the extraction, the cards, the atomic save and the approved-memory
// projection, and nothing rendered the projection. So a clinician could keep
// six items and then never see them again. Every guarantee about statement
// class and provenance was true of rows nobody could read.
//
// TWO ACTIONS, AND BOTH ARE DELIBERATELY NARROW.
//
//   CORRECT. §16's supersession: the prior item stays readable and marked, the
//   replacement carries the same statement class and the same citation. What is
//   NOT offered is changing what kind of claim it is — turning an observation
//   into a hypothesis is not a wording fix, and doing it quietly would rewrite
//   history in the one dimension this schema exists to protect.
//
//   FILE UNDER A THEME. The clinician's own way into threads. Without it the
//   matcher has nothing to match against — it only proposes against threads
//   that already exist — so a deployment where nobody can create one has a
//   thread feature that never does anything.

export interface MemoryRow {
  id: string;
  displayText: string;
  statementClass: string;
  itemType: string;
  normalizedLabel: string | null;
  approvedAt: string | null;
  sourceThoughtId: string | null;
  /** Themes this item is already filed under, so the panel does not offer to
   *  file it somewhere it already is. */
  threadLabels: string[];
  supersedesId: string | null;
}

const CLASS_SHORT: Record<string, string> = {
  clinician_observation: "observed",
  patient_report: "patient said",
  clinician_hypothesis: "wondering",
  clinician_uncertainty: "unsure",
};

const CLASS_TONE: Record<string, string> = {
  clinician_observation: "bg-app-accent/60 text-app-ink",
  patient_report: "bg-sky-50 text-sky-900",
  clinician_hypothesis: "bg-amber-50 text-amber-900",
  clinician_uncertainty: "bg-amber-50 text-amber-900",
};

export function ClinicalMemoryPanel({
  personId,
  items,
  existingThreadLabels,
}: {
  personId: string;
  items: MemoryRow[];
  /** Names already in use, shown as a hint so a clinician does not create
   *  "sleep" beside "Sleep" and split one theme into two. */
  existingThreadLabels: string[];
}) {
  const [openFor, setOpenFor] = useState<{ id: string; mode: "correct" | "file" } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneFor, setDoneFor] = useState<Record<string, string>>({});

  function open(item: MemoryRow, mode: "correct" | "file") {
    setOpenFor({ id: item.id, mode });
    setText(mode === "correct" ? item.displayText : (item.normalizedLabel ?? ""));
    setError(null);
  }

  async function submit(item: MemoryRow) {
    if (!openFor) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      if (openFor.mode === "correct") {
        form.set("itemId", item.id);
        form.set("displayText", text);
        const r = await correctMemoryItemAction(form);
        if (!r.ok) { setError(r.error ?? "That could not be saved."); return; }
        setDoneFor({ ...doneFor, [item.id]: "Corrected. The original stays readable." });
      } else {
        form.set("personId", personId);
        form.set("memoryItemId", item.id);
        form.set("canonicalLabel", text);
        const r = await createThreadWithItemAction(form);
        if (!r.ok) { setError(r.error ?? "That could not be saved."); return; }
        setDoneFor({ ...doneFor, [item.id]: `Filed under “${text}”.` });
      }
      setOpenFor(null);
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return (
      <p className="measure text-sm text-ground">
        Nothing has been kept yet. Items appear here after you record a thought and keep what
        is true — this is the record, not the transcript.
      </p>
    );
  }

  return (
    <div>
      {error && <p className="measure mb-3 text-sm text-state-support" role="alert">{error}</p>}
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl border border-ground/15 px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${CLASS_TONE[item.statementClass] ?? "bg-app-accent/60 text-app-ink"}`}>
                {CLASS_SHORT[item.statementClass] ?? item.statementClass}
              </span>
              <span className="text-xs text-olive">{item.itemType.replace(/_/g, " ")}</span>
              {item.supersedesId && (
                // A corrected item says so. Without it, a reader cannot tell a
                // first draft from a considered revision, and the difference
                // matters when the record is being relied on.
                <span className="text-xs text-olive">· corrected</span>
              )}
              {item.threadLabels.map((l) => (
                <span key={l} className="rounded-full bg-linen px-2 py-0.5 text-xs text-olive">
                  {l}
                </span>
              ))}
            </div>

            <p className="measure mt-2 text-sm text-app-ink">{item.displayText}</p>
            <p className="mt-1 text-xs text-olive">
              {item.approvedAt ? `Kept ${new Date(item.approvedAt).toLocaleDateString()}` : "Kept"}
              {item.sourceThoughtId ? " · from a recorded thought" : ""}
            </p>

            {doneFor[item.id] ? (
              <p className="mt-2 text-sm text-state-safe">{doneFor[item.id]}</p>
            ) : openFor?.id === item.id ? (
              <div className="mt-3 space-y-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-olive">
                    {openFor.mode === "correct" ? "Corrected wording" : "Theme name"}
                  </span>
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={openFor.mode === "correct" ? 1000 : 120}
                    list={openFor.mode === "file" ? "existing-threads" : undefined}
                    className="w-full rounded-xl border border-ground/20 bg-linen px-3 py-2 text-sm text-app-ink"
                  />
                </label>
                {openFor.mode === "file" && (
                  <datalist id="existing-threads">
                    {existingThreadLabels.map((l) => <option key={l} value={l} />)}
                  </datalist>
                )}
                {openFor.mode === "correct" && (
                  <p className="text-xs text-olive">
                    The original stays readable and marked. What this records is a better
                    wording of the same claim — it does not change what kind of claim it is.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button" disabled={busy || !text.trim()} onClick={() => submit(item)}
                    className="rounded-full bg-app-ink px-3.5 py-1.5 text-sm font-medium text-linen disabled:opacity-50"
                  >
                    {openFor.mode === "correct" ? "Save correction" : "File it"}
                  </button>
                  <button
                    type="button" disabled={busy} onClick={() => setOpenFor(null)}
                    className="rounded-full px-3.5 py-1.5 text-sm text-olive underline"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button" onClick={() => open(item, "file")}
                  className="rounded-full border border-ground/20 px-3.5 py-1.5 text-sm text-app-ink"
                >
                  File under a theme
                </button>
                <button
                  type="button" onClick={() => open(item, "correct")}
                  className="rounded-full px-3.5 py-1.5 text-sm text-olive underline"
                >
                  Correct the wording
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
