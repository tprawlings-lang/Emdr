// Person-level chart primitives (§29, the clinician half of the inventory).
//
// Separate from charts/aggregate.tsx on purpose. Those report on populations
// and their central rule is the denominator; these report on one person and
// their central rule is the opposite — never imply a trend, a cause or a
// prediction from a handful of points about a human being.
//
// §29.1 applies to both, and two of its rules do most of the work here:
//
//   Events    "Annotations mark sessions, plan versions or care events. They
//             do not imply cause."
//   Safety    "Show fixed event timelines and response workflow. Do not create
//             a predictive risk score."
//
// So neither of these components can draw a fitted line, and neither accepts a
// score. The slope chart draws the two readings a session actually recorded
// and the segment between them, which is a measurement rather than a claim;
// the timeline draws events that happened, in order, with the rule that fired.

import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Slope — before and after, per session (p61, p77)
// ---------------------------------------------------------------------------

export interface SlopeRow {
  /** The date, as the row's label. */
  label: string;
  open: number;
  /** Null when the session never recorded a close: paused, abandoned, still
   *  running. It is drawn as the open reading alone, and NAMED. */
  close: number | null;
  /** Why there is no close. Required whenever close is null — §29.1's missing
   *  data rule, and the difference between "we did not measure" and "it did
   *  not change". */
  incomplete?: string;
}

/**
 * Activation before and after each session.
 *
 * The x axis is the READING, not time; each row is one session and the rows
 * run in time order. That is what the page example draws, and it is the right
 * shape for the question — "did this session settle or stir" is about the
 * distance between two points, and a conventional time series buries that in
 * the gap between sessions.
 *
 * A session with no close reading keeps its row. Dropping it would make every
 * remaining row a session that finished, and the average of those is not the
 * average of sessions.
 */
export function Slope({
  rows, min = 0, max = 10, unit = "activation",
}: {
  rows: SlopeRow[];
  min?: number;
  max?: number;
  unit?: string;
}) {
  const pos = (v: number) => ((v - min) / Math.max(1, max - min)) * 100;

  return (
    <div>
      <ol className="space-y-3.5">
        {rows.map((r) => (
          <li key={r.label} className="grid gap-1 sm:grid-cols-[5.5rem_1fr] sm:items-center sm:gap-4">
            <span className="text-sm text-olive">{r.label}</span>
            <span className="flex items-center gap-3">
              <span aria-hidden className="relative h-4 flex-1">
                {/* The scale, so a dot near the left means calm rather than
                    merely "left of the other dot". */}
                <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-ground/10" />
                {r.close !== null && (
                  <span
                    className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-ground/30"
                    style={{
                      left: `${Math.min(pos(r.open), pos(r.close))}%`,
                      width: `${Math.abs(pos(r.close) - pos(r.open))}%`,
                    }}
                  />
                )}
                {/* Open is hollow, close is filled. NOT green-for-close:
                    colour with a valence tells a reader the close reading is
                    the good one, and on a session that ended higher than it
                    started that is exactly backwards — the green dot would sit
                    at the worst number on the row. Shape says WHICH reading;
                    nothing here says which is better, because that depends on
                    the direction and the chart does not judge it. */}
                <span
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-app-surface"
                  style={{ left: `${pos(r.open)}%`, borderColor: "var(--color-ground)" }}
                />
                {r.close !== null && (
                  <span
                    className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{ left: `${pos(r.close)}%`, backgroundColor: "var(--color-ground)" }}
                  />
                )}
              </span>
              <span className="w-40 shrink-0 whitespace-nowrap text-sm text-ground">
                {r.close === null ? (
                  <span className="text-olive">{r.incomplete ?? "no close reading"}</span>
                ) : (
                  <>
                    {r.open} → {r.close}
                    {r.close > r.open && (
                      <span className="ml-2 text-xs font-medium text-state-caution">higher at close</span>
                    )}
                  </>
                )}
              </span>
            </span>
          </li>
        ))}
      </ol>

      <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-olive">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full border-2 bg-app-surface" style={{ borderColor: "var(--color-ground)" }} />
          at open
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "var(--color-ground)" }} />
          at close
        </span>
        <span>
          scale {min}–{max}, {unit}
        </span>
      </p>

      {/* The accessible reading. The dots are a shape; this is the data. */}
      <table className="sr-only">
        <caption>{unit} at open and close, per session</caption>
        <thead>
          <tr><th scope="col">Session</th><th scope="col">At open</th><th scope="col">At close</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>{r.open}</td>
              <td>{r.close === null ? (r.incomplete ?? "no close reading") : r.close}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event timeline — fixed gates and the human response (p78)
// ---------------------------------------------------------------------------

export type GateMark = "clear" | "pause" | "block" | "review";

export interface TimelineEvent {
  date: string;
  mark: GateMark;
  /** The rule that fired, or the action taken. Never an inference. */
  detail: string;
  /** The policy version the rule ran under. §29.1 requires it on a safety
   *  surface: a gate is only interpretable against the rules in force. */
  version?: string;
}

const MARK: Record<GateMark, { label: string; color: string }> = {
  clear: { label: "CLEAR", color: "var(--color-state-safe)" },
  pause: { label: "PAUSE", color: "var(--color-state-caution)" },
  block: { label: "BLOCK", color: "var(--color-state-support)" },
  review: { label: "REVIEW", color: "var(--color-state-info)" },
};

/**
 * What the fixed gates did, in order.
 *
 * This is the screen where a predictive risk score would be easiest to add and
 * hardest to argue with — a clinician looking at four amber marks wants a
 * fifth telling them what happens next. §29.1 forbids it, and the reason is
 * §30.7's: a gate is a deterministic rule meeting an answer. A score would be
 * a different kind of claim wearing the same colours, and nobody downstream
 * could tell them apart.
 *
 * So every mark here is an event that HAPPENED, each names the rule behind it,
 * and there is no trend line, no projection and no summary verdict.
 */
export function EventTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return null;

  return (
    <div>
      <ol className="flex gap-6 overflow-x-auto pb-2">
        {events.map((e, i) => {
          const m = MARK[e.mark];
          return (
            <li key={`${e.date}-${i}`} className="flex min-w-32 flex-col items-center text-center">
              {/* The word, not only the colour. */}
              <span className="text-xs font-semibold tracking-wide" style={{ color: m.color }}>
                {m.label}
              </span>
              <span className="relative mt-2 flex h-4 w-full items-center justify-center">
                {i > 0 && <span aria-hidden className="absolute right-1/2 h-px w-full bg-ground/15" />}
                {i < events.length - 1 && (
                  <span aria-hidden className="absolute left-1/2 h-px w-full bg-ground/15" />
                )}
                <span
                  aria-hidden
                  className="relative h-3.5 w-3.5 rounded-full"
                  style={{ backgroundColor: m.color }}
                />
              </span>
              <span className="mt-2 text-xs text-olive">{e.date}</span>
              <span className="measure mt-1 text-xs text-ground">{e.detail}</span>
              {e.version && (
                <span className="mt-0.5 font-mono text-[10px] text-olive">{e.version}</span>
              )}
            </li>
          );
        })}
      </ol>

      <p className="mt-5 text-sm font-medium text-state-support">
        No predictive risk score. The rule, the result, the support offered and the human
        response all stay visible.
      </p>
    </div>
  );
}

/** Shared frame, matching the aggregate charts' Figure. Summary and footnote
 *  are required for the same reason there: a chart with no stated window and
 *  no accessible summary is unreadable to half its audience. */
export function ClinicalFigure({
  title, summary, footnote, children,
}: {
  title: string;
  summary: string;
  footnote: string;
  children: ReactNode;
}) {
  return (
    <figure className="m-0">
      <figcaption>
        <span className="text-sm font-semibold text-app-ink">{title}</span>
        <span className="sr-only"> — {summary}</span>
      </figcaption>
      <div className="mt-4">{children}</div>
      <p className="mt-4 text-xs text-olive">{footnote}</p>
    </figure>
  );
}
