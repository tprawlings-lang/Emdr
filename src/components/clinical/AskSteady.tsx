"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { askAboutPersonAction } from "@/lib/clinical/ask-actions";
import { NOT_YET_SEARCHED, type AskAnswer } from "@/lib/clinical/ask-answer";

// Ask Steady about this patient (Thoughts spec v2.1 §12; Phase 5).
//
// §12: "Place a patient-scoped query box in the patient workspace or
// Thoughts/Threads view. Queries such as 'When did sleep start getting worse?',
// 'What have I written about her sister?', and 'How has grounding been working?'
// should work without special syntax."
//
// FOUR ANSWER SHAPES, NOT ONE ANSWER WITH CAVEATS. §12's hardest requirement is
// "if evidence is insufficient or conflicting, say so. Do not smooth conflicting
// history into one answer" — and a caveat under a fluent paragraph is exactly
// the smoothing it forbids. So a conflicting answer does not look like an
// answered one with a warning; it looks like two columns of records that
// disagree, with nothing in between them pretending to reconcile.
//
// EVERY STATEMENT OPENS ITS SOURCE. §12: "return a source list and
// claim-to-source mapping. The UI should offer View source." The mapping is
// carried in the data rather than assembled here — each claim already knows
// which record it came from, and this renders the link.
//
// THE QUESTION STAYS IN THE BOX after asking. A clinician reading an answer is
// usually about to ask a better version of the same question, and clearing the
// field makes them retype it.

/** How each kind of record is named to a clinician. Their own words for their
 *  own records, not the retrieval layer's type names. */
const SOURCE_LABEL: Record<string, string> = {
  note: "Your note",
  memory: "Kept item",
  thread: "Thread",
  assessment: "Assessment",
  checkin: "Check-in",
  session: "Session",
};

const EXAMPLES = [
  "When did sleep start getting worse?",
  "What have I written about her sister?",
  "How has grounding been working?",
];

function SourceLink({ personId, sourceId, label }: { personId: string; sourceId: string; label: string }) {
  return (
    <Link
      href={`/clinician/member/${personId}/thoughts#${sourceId}`}
      className="text-xs font-medium text-state-info underline underline-offset-2"
    >
      {label}
    </Link>
  );
}

export function AskSteady({ personId }: { personId: string }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function ask(q: string) {
    setError(null);
    start(async () => {
      const result = await askAboutPersonAction(personId, q);
      if (!result.ok) {
        setError(result.error ?? "Steady could not answer that.");
        setAnswer(null);
        return;
      }
      setAnswer(result.answer ?? null);
    });
  }

  return (
    <section data-testid="ask-steady" className="rounded-3xl border border-ground/10 bg-linen p-5">
      <h2 className="type-display text-lg font-medium text-ground">Ask about this person</h2>
      <p className="measure mt-1 text-sm text-olive">
        Reads what you and your team have written about this person, and shows you where each
        part of the answer came from. It never writes anything to their record.
      </p>

      <form
        className="mt-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <label htmlFor="ask-steady-q" className="sr-only">
          Ask a question about this person
        </label>
        <input
          id="ask-steady-q"
          name="question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="When did sleep start getting worse?"
          className="min-w-0 flex-1 rounded-full border border-ground/20 bg-app-surface px-4 py-2.5 text-sm text-ground"
        />
        <button
          type="submit"
          disabled={pending || question.trim().length < 3}
          className="rounded-full bg-ground px-5 py-2.5 text-sm font-medium text-ivory disabled:opacity-50"
        >
          {pending ? "Looking…" : "Ask"}
        </button>
      </form>

      {/* No special syntax, and the examples say so by being ordinary
          sentences rather than a query language. */}
      <ul className="mt-2 flex flex-wrap gap-2">
        {EXAMPLES.map((e) => (
          <li key={e}>
            <button
              type="button"
              onClick={() => { setQuestion(e); ask(e); }}
              className="rounded-full border border-ground/15 px-3 py-1.5 text-xs text-olive hover:bg-ivory"
            >
              {e}
            </button>
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="measure mt-4 text-sm text-state-support">
          {error}
        </p>
      )}

      {answer && (
        <div className="mt-5 border-t border-ground/10 pt-4" data-testid="ask-answer" data-answer-kind={answer.kind}>
          <p className="measure text-sm text-ground">{answer.summary}</p>

          {/* CONFLICTING: both sides, side by side, with nothing between them
              that reconciles them. */}
          {answer.conflicts.length > 0 && (
            <div className="mt-4 space-y-4">
              {answer.conflicts.map((c) => (
                <div key={c.topic} data-testid="ask-conflict" className="rounded-2xl border border-state-caution/40 bg-state-caution-bg/40 p-4">
                  <p className="text-sm font-medium text-ground">
                    The record disagrees about {c.topic}
                  </p>
                  <ul className="mt-2 space-y-2">
                    {c.sides.map((s) => (
                      <li key={s.citation} className="text-sm text-ground">
                        <span className="measure block">{s.says}</span>
                        <SourceLink personId={personId} sourceId={s.citation} label="View source" />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {answer.claims.length > 0 && (
            <ul className="mt-4 space-y-3">
              {answer.claims.map((c, i) => (
                <li key={`${c.citations[0]}-${i}`} data-testid="ask-claim" className="border-b border-ground/5 pb-3 last:border-b-0">
                  {/* What kind of record this is, before the text. A thread's
                      text is its label — "sleep" — and without this it reads as
                      a one-word sentence somebody wrote rather than as a
                      grouping the clinician made. */}
                  <p className="text-xs uppercase tracking-wide text-olive">{SOURCE_LABEL[c.sourceType]}</p>
                  <p className="measure mt-0.5 text-sm text-ground">{c.text}</p>
                  <p className="mt-1 flex flex-wrap gap-x-3">
                    {c.citations.map((id) => (
                      <SourceLink key={id} personId={personId} sourceId={id} label="View source" />
                    ))}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {/* What was NOT searched. An answer reporting "not enough in the
              record" while never having looked at half of it is making a claim
              about the person that is really a claim about the search. */}
          {answer.kind === "insufficient" && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-olive">
                Not searched
              </p>
              <ul className="mt-1 space-y-1">
                {NOT_YET_SEARCHED.map((s) => (
                  <li key={s.source} className="measure text-xs text-olive">
                    <span className="text-ground">{s.source}</span> — {s.why}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {answer.omitted.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-olive">
                Withheld
              </p>
              <ul className="mt-1 space-y-1">
                {answer.omitted.map((o) => (
                  <li key={o.text} className="measure text-xs text-olive">
                    {o.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="measure mt-4 text-xs text-olive">
            {answer.sources.length} source{answer.sources.length === 1 ? "" : "s"} ·{" "}
            searched {answer.provenance.candidates} record
            {answer.provenance.candidates === 1 ? "" : "s"} ·{" "}
            {answer.provenance.semanticScoring
              ? "lexical, structured, recency and semantic ranking"
              : "lexical, structured and recency ranking — no semantic scoring in this build"}{" "}
            · {answer.provenance.retrievalPolicyVersion}
          </p>
          <p className="measure mt-1 text-xs text-olive">
            This is what is written down, not a clinical judgement. Nothing here was added to
            the record.
          </p>
        </div>
      )}
    </section>
  );
}
