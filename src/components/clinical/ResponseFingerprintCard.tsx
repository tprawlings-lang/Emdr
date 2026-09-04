import Link from "next/link";
import {
  PATTERN_STATE_LABEL, PATTERN_STATE_NOTE, RESPONSE_POLICY,
  type PatternState,
} from "@/lib/clinical/response-fingerprint-policy";

// The compact "Observed responses" card for the patient overview (§9).
//
// §9 asks for "top 2-3 sufficiently supported interventions and a View all
// action". Three facts per row — what it is, what the record shows, how many
// exposures it rests on — and nothing else. This sits on a page that already
// carries the whole clinical record; a card that grew into a second responses
// page would push the record it summarises below the fold.
//
// SUFFICIENTLY SUPPORTED IS THE WHOLE FILTER. Anything below §6's display
// threshold does not appear here at all, in any form — not greyed, not
// "gathering evidence", not with a smaller number. A partially-rendered pattern
// is still a pattern in the reader's memory a week later, and the card says how
// many interventions were withheld instead, so the omission is visible without
// the omitted thing being shown.
//
// THE DENOMINATOR IS ON EVERY ROW. "Settling has been observed repeatedly" and
// "on 6 recorded exposures" are one sentence, never two — a state label that
// travels without its support count is a conclusion that has lost its evidence.
//
// AND NO ROW SAYS THE INTERVENTION DID ANYTHING. The subject of every phrase is
// the record: what was observed, how often, and what is still missing. §6 bars
// "works", "effective treatment", "caused improvement" and "contraindicated"
// without an independent clinician-authored judgement, and the card is where
// that rule is easiest to break by accident, because a card wants a verdict.

export interface FingerprintCardRow {
  definitionId: string;
  displayName: string;
  classLabel: string;
  patternState: PatternState;
  supportCount: number;
  missingFollowupCount: number;
  mixedCount: number;
}

/** How a state reads at a glance. Filled for settling, hollow for burden,
 *  neutral otherwise — never a colour alone, and never an arrow (an arrow means
 *  "the number fell", which is relief on distress and the opposite on sleep). */
const STATE_MARK: Record<PatternState, string> = {
  insufficient_data: "·",
  mixed: "◈",
  favorable_observed_pattern: "◆",
  limited_observed_pattern: "◆",
  recovery_burden_observed: "◇",
};

export function ResponseFingerprintCard({
  personId, rows, withheldCount,
}: {
  personId: string;
  rows: FingerprintCardRow[];
  /** Interventions with evidence but below the display threshold. Counted so
   *  the reader knows the list is a filtered one. */
  withheldCount: number;
}) {
  return (
    <section className="rounded-2xl border border-ground/10 bg-app-surface px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-app-ink">Observed responses</h2>
        <Link
          href={`/clinician/member/${personId}/responses`}
          className="text-xs text-olive underline"
        >
          Open all
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="measure mt-3 text-sm text-ground">
          {withheldCount > 0
            ? `${withheldCount} intervention${withheldCount === 1 ? " has" : "s have"} been recorded, ` +
              `none yet with the ${RESPONSE_POLICY.displayThreshold} comparable exposures needed before ` +
              `anything is summarised from them.`
            : "Nothing recorded yet for this person."}{" "}
          <Link href={`/clinician/member/${personId}/responses`} className="underline">
            See the record
          </Link>
          .
        </p>
      ) : (
        <>
          <ul className="mt-3 space-y-3">
            {rows.slice(0, 3).map((r) => (
              <li key={r.definitionId}>
                <p className="text-sm text-app-ink">
                  <span aria-hidden className="text-olive">{STATE_MARK[r.patternState]} </span>
                  {r.displayName}{" "}
                  <span className="text-xs text-olive">{r.classLabel}</span>
                </p>
                <p className="measure text-xs text-ground">
                  {PATTERN_STATE_LABEL[r.patternState]}, on {r.supportCount} recorded exposure
                  {r.supportCount === 1 ? "" : "s"}
                  {r.mixedCount > 0 && ` — ${r.mixedCount} of them disagreed across windows`}
                  {r.missingFollowupCount > 0 &&
                    `; ${r.missingFollowupCount} had a window nobody recorded`}
                  .
                </p>
              </li>
            ))}
          </ul>

          {/* One note, for the top row only. Repeating it per row would make the
              card longer than the thing it summarises. */}
          <p className="measure mt-3 text-xs text-olive">
            {PATTERN_STATE_NOTE[rows[0].patternState]}
          </p>

          {withheldCount > 0 && (
            <p className="measure mt-2 text-xs text-olive">
              {withheldCount} more {withheldCount === 1 ? "intervention has" : "interventions have"}{" "}
              been recorded with fewer than {RESPONSE_POLICY.displayThreshold} exposures, so nothing
              is summarised from {withheldCount === 1 ? "it" : "them"} yet.
            </p>
          )}
        </>
      )}
    </section>
  );
}
