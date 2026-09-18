import {
  describeObservation, isSettling, inWindowOrder,
  EVIDENCE_LABEL,
  type ResponseObservation,
} from "@/lib/clinical/response-vocabulary";
import type { ExposureStanding } from "@/lib/clinical/response-standing";

// One exposure, scannable in a line and openable for the rest (17 September
// handoff, P4: "allow exposure details to expand").
//
// IT USED TO BE ALL EXPANDED, ALWAYS. Every exposure printed its context, every
// observation it carried and its missing windows, so a person with forty of
// them — ordinary — produced several hundred lines of extra-small text in one
// scroll. The page answered "what happened after the container practice on the
// 14th" and "how has this person responded to grounding" with the same wall.
//
// SO THE SCAN LINE CARRIES THE STANDING, and the standing is what tells a
// reader whether opening it is worth their time: mixed, followed up, partly, or
// not followed up. That is the one thing you cannot work out from a date and a
// source label, and it was previously four lines down inside the detail.
//
// THE CONTROLS STAY ON THE SCAN LINE, outside the disclosure. A name waiting on
// confirmation is work, and work that only appears after you open something is
// work most people will not find. It also keeps a click on a button from
// toggling the row it sits in.

export function ExposureRow({
  date, source, dose, context, standing, observations, controls,
}: {
  date: string;
  source: string;
  dose: string | null;
  context: string | null;
  standing: ExposureStanding;
  observations: ReadonlyArray<ResponseObservation>;
  /** Confirm and remap, rendered by the page because they are client forms. */
  controls?: React.ReactNode;
}) {
  const hasDetail = observations.length > 0 || context !== null;
  return (
    <li className="border-t border-ground/10 pt-2 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm text-app-ink">{date}</span>
        <span className="text-xs text-olive">{source}</span>
        {dose && <span className="text-xs text-olive">{dose}</span>}
        <span
          data-testid="exposure-standing"
          className={
            standing.state === "mixed"
              ? "rounded-full bg-app-accent/60 px-2 py-0.5 text-xs font-medium text-app-ink"
              : standing.outstanding
                ? "rounded-full border border-ground/20 px-2 py-0.5 text-xs text-app-ink"
                : "text-xs text-olive"
          }
        >
          {standing.said}
        </span>
        {controls}
      </div>

      {hasDetail && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-olive underline-offset-2 hover:underline">
            What followed
          </summary>
          <div className="mt-1">
            {context && <p className="measure text-xs text-olive">{context}</p>}
            {observations.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {inWindowOrder([...observations]).map((o) => {
                  const settling = isSettling(o.outcomeType, o.direction);
                  return (
                    <li key={o.id} className="measure text-xs text-ground">
                      {/* NOT an arrow. An arrow reads as "the number went down",
                          and on sleep quality the number going up is the settled
                          direction — so an arrow would call a good night a
                          deterioration. */}
                      <span aria-hidden className="text-olive">
                        {settling === true ? "◆ " : settling === false ? "◇ " : "· "}
                      </span>
                      <span className="sr-only">
                        {settling === true ? "toward settled: "
                          : settling === false ? "away from settled: "
                          : "recorded: "}
                      </span>
                      {describeObservation(o)}{" "}
                      <span className="text-olive">({EVIDENCE_LABEL[o.evidenceClass]})</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {/* The missing windows are NOT repeated here. They are the scan
                line's standing, and printing them twice one line apart is the
                duplication this page already had in another form. */}
          </div>
        </details>
      )}
    </li>
  );
}
