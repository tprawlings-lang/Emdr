"use client";

import { useMemo, useState } from "react";
import { saveThoughtsAction } from "@/lib/clinical/thought-actions";

// The review cards (§3.2, §17.3, Phase 2).
//
// One card per candidate, and the clinician says Keep or Remove on each. §17's
// primary action is Save Thoughts — "do not make the clinician confirm every
// card one by one in the ordinary path" — so the decisions are collected here
// and submitted as one command.
//
// THE CARD LEADS WITH WHAT KIND OF CLAIM IT IS. Not as a tag in the corner: as
// the first thing read, in words rather than a code. §4's failure is a
// hypothesis that reads like an observation, and it does not look like an error
// — it looks like a slightly more confident record than the clinician was. A
// card that shows the sentence first and its epistemic status second invites
// exactly that misreading, because the sentence is what gets skimmed.
//
// NOTHING IS PRE-SELECTED. Every card starts undecided and the save refuses
// until all of them are answered. A screen that defaulted to Keep would collect
// approvals from a clinician who scrolled, and the approval is the entire
// human gate this feature has — §9's task table says "all items reviewed before
// approval", and defaulting is how "reviewed" quietly comes to mean "not
// objected to".
//
// THE QUOTE IS THE EVIDENCE, AND ITS ABSENCE IS INFORMATION. An item that could
// not be tied to the transcript says so, rather than being rendered
// identically to one that could. A clinician deciding on an uncited item is
// working from Steady's paraphrase alone, and that is worth knowing before
// pressing Keep.

export interface CandidateCard {
  id: string;
  itemType: string;
  statementClass: string;
  displayText: string;
  normalizedLabel: string | null;
  /** The transcript text this item was drawn from, when the citation held. */
  quote: string | null;
  numericFacts: { name: string; value: number; unit?: string; approximate?: boolean }[];
}

type Choice = "approve" | "reject";

/** §9.1's four classes, in the clinician's words rather than the schema's.
 *  The `weight` line is what the card is actually communicating: how much this
 *  claim is allowed to be leaned on later. */
const CLASS_COPY: Record<string, { label: string; weight: string; tone: "observed" | "reported" | "thinking" }> = {
  clinician_observation: {
    label: "You observed this",
    weight: "Recorded as something you saw or did.",
    tone: "observed",
  },
  patient_report: {
    label: "The patient said this",
    weight: "Recorded as their words, not your assessment.",
    tone: "reported",
  },
  clinician_hypothesis: {
    label: "You were wondering",
    weight: "Recorded as a hypothesis. It will not read as established.",
    tone: "thinking",
  },
  clinician_uncertainty: {
    label: "You were unsure",
    weight: "Recorded as uncertainty, and kept as uncertainty.",
    tone: "thinking",
  },
};

const TONE_CLASS: Record<string, string> = {
  observed: "bg-app-accent/60 text-app-ink",
  reported: "bg-sky-50 text-sky-900",
  thinking: "bg-amber-50 text-amber-900",
};

function typeLabel(t: string): string {
  return t.replace(/_/g, " ");
}

export function ThoughtItemCards({
  thoughtId,
  transcriptVersion,
  candidates,
  onDone,
}: {
  thoughtId: string;
  transcriptVersion: number;
  candidates: CandidateCard[];
  onDone?: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ approved: number; rejected: number } | null>(null);

  // DERIVED FROM WHAT IS BEING SAVED, not generated.
  //
  // The key has to survive a retry after a network failure — a fresh key per
  // attempt turns the retry into a second save, which is the duplicate §8.1
  // forbids. A random value made once per mount does that, but only by
  // accident: it is impure during render, React may discard and re-run the
  // render that produced it, and a remount after re-organizing silently reuses
  // a position-stable id for a different decision set.
  //
  // Identifying the SET instead is both pure and more correct. The same
  // candidates over the same transcript version are the same save no matter how
  // many times the component mounts, and a different candidate set — which is
  // what re-organizing produces — is a different save without anyone having to
  // remember to make it one.
  const idempotencyKey = useMemo(() => {
    const material = `${thoughtId}:${transcriptVersion}:${candidates.map((c) => c.id).sort().join(",")}`;
    let h = 0x811c9dc5;
    for (let i = 0; i < material.length; i++) {
      h ^= material.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${thoughtId}-${transcriptVersion}-${h.toString(36)}`;
  }, [thoughtId, transcriptVersion, candidates]);

  const undecided = candidates.filter((c) => !choices[c.id]);
  const keeping = candidates.filter((c) => choices[c.id] === "approve").length;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const decisions = candidates.map((c) => ({
        candidateId: c.id,
        decision: choices[c.id],
        ...(edits[c.id] !== undefined && edits[c.id].trim() && edits[c.id] !== c.displayText
          ? { displayText: edits[c.id].trim() }
          : {}),
      }));
      const form = new FormData();
      form.set("thoughtId", thoughtId);
      form.set("transcriptVersion", String(transcriptVersion));
      form.set("idempotencyKey", idempotencyKey);
      form.set("decisions", JSON.stringify(decisions));
      const result = await saveThoughtsAction(form);
      if (!result.ok) {
        setError(result.error ?? "That could not be saved.");
        return;
      }
      setSaved({ approved: keeping, rejected: candidates.length - keeping });
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <div className="mt-4 rounded-2xl border border-ground/10 bg-app-surface px-5 py-5">
        <p className="text-sm font-medium text-state-safe">
          <span aria-hidden>◆</span> Saved
        </p>
        <p className="measure mt-2 text-sm text-ground">
          {saved.approved} item{saved.approved === 1 ? "" : "s"} kept
          {saved.rejected > 0 ? `, ${saved.rejected} removed` : ""}. Kept items are in this
          {" "}{`patient's`} clinical memory. They are not a formal note, and nothing here has
          been shared with the patient.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-ground/10 bg-app-surface px-5 py-5">
      <h3 className="text-sm font-semibold text-app-ink">What Steady organized</h3>
      <p className="measure mt-1 text-sm text-olive">
        Steady proposed these from your transcript. Nothing is kept until you say so, and what
        you keep is stored as the kind of statement it says above the text.
      </p>

      <ul className="mt-4 space-y-3">
        {candidates.map((c) => {
          const cls = CLASS_COPY[c.statementClass] ?? {
            label: c.statementClass,
            weight: "",
            tone: "observed" as const,
          };
          const choice = choices[c.id];
          return (
            <li
              key={c.id}
              className={`rounded-xl border px-4 py-4 ${
                choice === "reject"
                  ? "border-ground/10 bg-linen/40 opacity-60"
                  : choice === "approve"
                    ? "border-state-safe/40 bg-app-surface"
                    : "border-ground/15 bg-app-surface"
              }`}
            >
              {/* The class first, deliberately. See the note at the top. */}
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASS[cls.tone]}`}>
                  {cls.label}
                </span>
                <span className="text-xs text-olive">{typeLabel(c.itemType)}</span>
                {c.normalizedLabel && (
                  <span className="text-xs text-olive">· {c.normalizedLabel}</span>
                )}
              </div>

              <label className="sr-only" htmlFor={`item-${c.id}`}>Item text</label>
              <textarea
                id={`item-${c.id}`}
                value={edits[c.id] ?? c.displayText}
                onChange={(e) => setEdits({ ...edits, [c.id]: e.target.value })}
                rows={2}
                disabled={busy || choice === "reject"}
                className="measure mt-3 w-full rounded-xl border border-ground/15 bg-linen px-3 py-2 text-sm text-app-ink disabled:opacity-60"
              />

              <p className="mt-1 text-xs text-olive">{cls.weight}</p>

              {c.numericFacts.length > 0 && (
                <p className="mt-2 text-xs text-olive">
                  {c.numericFacts.map((n, i) => (
                    <span key={n.name}>
                      {i > 0 ? " · " : ""}
                      {n.name.replace(/_/g, " ")}: {n.value}
                      {n.unit ? ` ${n.unit}` : ""}
                      {/* An approximate number and an exact one are different
                          clinical facts, and the difference is the clinician's
                          own hedge. It is shown, not rounded away. */}
                      {n.approximate ? " (approximate — you said about this)" : ""}
                    </span>
                  ))}
                </p>
              )}

              {c.quote ? (
                <blockquote className="mt-3 border-l-2 border-ground/20 pl-3 text-xs text-olive">
                  “{c.quote}”
                </blockquote>
              ) : (
                <p className="mt-3 text-xs text-olive">
                  <span aria-hidden>▲</span> Steady could not tie this to a specific line in your
                  transcript. Read it against what you said before keeping it.
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-pressed={choice === "approve"}
                  onClick={() => setChoices({ ...choices, [c.id]: "approve" })}
                  disabled={busy}
                  className={`rounded-full px-3.5 py-1.5 text-sm ${
                    choice === "approve"
                      ? "bg-app-ink font-medium text-linen"
                      : "border border-ground/20 text-app-ink"
                  }`}
                >
                  Keep
                </button>
                <button
                  type="button"
                  aria-pressed={choice === "reject"}
                  onClick={() => setChoices({ ...choices, [c.id]: "reject" })}
                  disabled={busy}
                  className={`rounded-full px-3.5 py-1.5 text-sm ${
                    choice === "reject"
                      ? "bg-ground/70 font-medium text-linen"
                      : "border border-ground/20 text-app-ink"
                  }`}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {error && (
        <p className="measure mt-4 text-sm text-state-support" role="alert">{error}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy || undecided.length > 0}
          className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-linen disabled:opacity-50"
        >
          Save thoughts
        </button>
        <p className="text-xs text-olive" aria-live="polite">
          {undecided.length > 0
            ? `${undecided.length} item${undecided.length === 1 ? "" : "s"} still to decide`
            : `Keeping ${keeping} of ${candidates.length}`}
        </p>
      </div>
    </div>
  );
}
