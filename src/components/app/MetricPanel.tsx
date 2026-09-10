import { Panel } from "@/components/app/surfaces";
import { metric } from "@/lib/metrics/dictionary";
import type { MetricResult } from "@/lib/metrics/compute";

// The metric dictionary, rendered (handoff 07 §3.2 p32, §5.3 p48).
//
// Every row reads a typed result and divides nothing. p48: "the API returns
// series, units, intervals, suppression and evidence pointers; the client does
// not calculate clinical or business metrics from raw records." A component
// that can divide can divide by the wrong denominator, and it will.
//
// p48's failure rule is implemented literally: "if a required definition,
// denominator, version or refresh time is missing, the chart renders a FAILED
// STATE rather than a number." A missing version is not a cosmetic gap — it
// means nobody can say what the number means.

function failed(r: MetricResult): string | null {
  if (!r.metric_version) return "no metric version";
  if (!r.data_version) return "no data version";
  if (!r.projection_version) return "no projection version";
  if (!r.refreshed_at) return "no refresh time";
  if (r.denominator === undefined || r.denominator === null) return "no denominator";
  return null;
}

export function MetricPanel({ results }: { results: MetricResult[] }) {
  if (results.length === 0) {
    return (
      <Panel title="Metrics">
        <p className="measure text-sm text-ground">
          No population is in scope for this account, so there is nothing to compute. That is an
          empty result, not a failure to load.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Metric dictionary"
      footnote="Every value carries its numerator, denominator, window, missingness and four versions — the metric's, the cohort's, the dataset's and the projection's. A number without them cannot be compared with the one you saw last month."
    >
      <ul className="divide-y divide-ground/10">
        {results.map((r) => {
          const def = metric(r.metric_id);
          const broken = failed(r);
          const censored = r.detail.mostly_censored === "true";
          return (
            <li key={`${r.metric_id}-${r.detail.day ?? ""}`} className="py-3.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-sm font-medium text-app-ink">
                  {def.label}
                  {r.detail.day ? ` — day ${r.detail.day}` : ""}
                </span>
                <span className="text-sm">
                  {broken ? (
                    // The failed state. A number rendered without its version
                    // is a number nobody can interpret, so it is not rendered.
                    <span className="font-semibold text-state-support">
                      ✕ cannot be shown — {broken}
                    </span>
                  ) : r.suppressed ? (
                    <span className="text-olive">
                      withheld (under {r.missing.suppressed_below}) of{" "}
                      {r.denominator.toLocaleString()}
                    </span>
                  ) : censored ? (
                    <span className="text-olive">
                      not observable yet — {r.missing.censored_window_not_elapsed} of{" "}
                      {(r.denominator + Number(r.missing.censored_window_not_elapsed ?? 0)).toLocaleString()}{" "}
                      have not reached this point
                    </span>
                  ) : r.value === null ? (
                    <span className="text-olive">
                      no denominator — nobody qualified
                    </span>
                  ) : (
                    <span className="text-ground">
                      {(r.value * 100).toFixed(1)}%{" "}
                      <span className="text-olive">
                        ({r.numerator.toLocaleString()} of {r.denominator.toLocaleString()})
                      </span>
                    </span>
                  )}
                </span>
              </div>

              <p className="measure mt-1 text-xs text-olive">{def.definition}</p>

              {/* The required-display fields, and what the metric must not be
                  read as. The second is usually the reason the first matters. */}
              <p className="measure mt-1 text-xs text-olive">
                <span className="text-ground">Not:</span> {def.notA}
              </p>

              {Object.keys(r.missing).length > 0 && (
                <p className="mt-1 font-mono text-xs text-olive">
                  {Object.entries(r.missing)
                    .filter(([, v]) => v !== 0)
                    .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
                    .join(" · ") || "nothing withheld or missing"}
                </p>
              )}
              <p className="mt-1 font-mono text-xs text-olive">
                {def.id} {r.metric_version} · cohort {r.cohort_id} {r.cohort_hash} · data{" "}
                {r.data_version} · {r.status}
              </p>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
