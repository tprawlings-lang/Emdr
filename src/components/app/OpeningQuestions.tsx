import Link from "next/link";
import type { TracedAnswer } from "@/lib/buyer/opening-questions";

// Decisions first, charts second (17 September handoff, P5).
//
// THE QUESTION IS THE HEADING, in the reader's own words rather than as a
// metric name. "Where is access delayed?" is what somebody came to find out;
// "Median days referral to first contact" is what we happen to have counted,
// and a console that leads with the second makes the reader do the translation.
//
// THE FOUR TRACES OPEN, THEY DO NOT SHOUT. The acceptance is that a figure can
// be traced to its denominator, window, missingness and definition — not that
// all four compete with the answer. One disclosure per question, closed by
// default, and the answer stays a sentence.

export function OpeningQuestions({
  answers, heading,
}: {
  answers: readonly TracedAnswer[];
  heading: string;
}) {
  return (
    <section data-testid="opening-questions" className="rounded-3xl border border-ground/15 bg-app-surface px-6 py-5">
      <h2 className="type-display text-xl font-medium text-ground">{heading}</h2>
      <ul className="mt-4 space-y-5">
        {answers.map((a) => (
          <li key={a.questionId} data-testid="opening-question" data-question={a.questionId}>
            <h3 className="text-sm font-semibold text-ground">{a.question}</h3>
            <p className="measure mt-1 text-ground/90">{a.answer}</p>
            {a.figure && (
              <p className="mt-1 text-2xl font-medium text-ground" data-testid="opening-figure">
                {a.figure}
              </p>
            )}
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-olive underline-offset-2 hover:underline">
                Where this number comes from
              </summary>
              <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[8rem_1fr]">
                <dt className="text-xs text-olive">Out of</dt>
                <dd className="measure text-sm text-ground/90" data-trace="denominator">{a.denominator}</dd>
                <dt className="text-xs text-olive">Window</dt>
                <dd className="measure text-sm text-ground/90" data-trace="window">{a.window}</dd>
                <dt className="text-xs text-olive">Not in it</dt>
                <dd className="measure text-sm text-ground/90" data-trace="missingness">{a.missingness}</dd>
                <dt className="text-xs text-olive">Counted as</dt>
                <dd className="measure text-sm text-ground/90" data-trace="definition">{a.definition}</dd>
              </dl>
              <p className="mt-2 text-xs">
                <Link href={a.evidenceHref} className="inline-flex min-h-6 items-center text-olive underline">{a.evidenceLabel}</Link>
              </p>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
