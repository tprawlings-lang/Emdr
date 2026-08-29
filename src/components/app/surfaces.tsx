// The surfaces the twenty page examples repeat (§28), typed as §30.5's shared
// component contracts.
//
// Reading all twenty mockups end to end, the same four pieces carry almost
// every screen, in almost every order:
//
//   1. a tinted banner naming what changed or what stopped;
//   2. a row of three summary cards — the current state, in three numbers;
//   3. a wide white panel holding the chart, list or table;
//   4. a narrow tinted card beside it that says how to read the panel.
//
// Piece 4 is the one worth naming carefully. It is not a sidebar and not a
// tip: it is §25's "meaning" layer rendered next to the evidence it explains,
// and every mockup ends it with the boundary of what the panel does NOT prove
// ("One session does not prove outcome change", "No causal claim", "Not
// observed savings"). Building it as a generic aside loses that, so `note`
// takes a required `boundary`.
//
// Tone reuses the semantic state tokens rather than raw brand colors, so
// tests/contrast.test.ts keeps covering the text that sits on these tints.

import type { ReactNode } from "react";

export type Tone = "safe" | "info" | "caution" | "support" | "review" | "unknown";

const TONE: Record<Tone, { bg: string; fg: string }> = {
  safe: { bg: "bg-state-safe-bg", fg: "text-state-safe" },
  info: { bg: "bg-state-info-bg", fg: "text-state-info" },
  caution: { bg: "bg-state-caution-bg", fg: "text-state-caution" },
  support: { bg: "bg-state-support-bg", fg: "text-state-support" },
  review: { bg: "bg-state-review-bg", fg: "text-state-review" },
  unknown: { bg: "bg-state-unknown-bg", fg: "text-state-unknown" },
};

/**
 * The tinted callout the mockups put directly under the title: "What changed:
 * PHQ-9 increased 5 points in 14 days. Review due today."
 *
 * `label` is not decoration. §27.4 orders a person overview identity → what
 * changed → why it matters, and the label is what makes the second of those
 * legible as a category rather than as a sentence someone happened to write.
 */
export function Callout({
  tone = "caution",
  label,
  children,
  className = "",
}: {
  tone?: Tone;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <div className={`rounded-2xl ${t.bg} px-5 py-4 ${className}`}>
      <p className="text-sm">
        <span className={`font-semibold ${t.fg}`}>{label}:</span>{" "}
        <span className="text-ground">{children}</span>
      </p>
    </div>
  );
}

export type SummaryCard = {
  label: string;
  /** The number or short phrase. Kept to one line — three cards, three facts. */
  value: string;
  /** The denominator, the comparison, or the freshness. §29.1: never a
   *  percentage without its numerator and denominator in the same view. */
  detail?: string;
};

/**
 * The row of three. Every mockup that has one has exactly three, which is not
 * a coincidence — §30.5's ChangeSummary caps at "maximum three
 * decision-relevant changes", and §27.4 caps the person overview at "maximum
 * three high-signal items". More than three is a dashboard, and a dashboard is
 * what this product is trying not to be.
 */
export function SummaryCards({ cards }: { cards: SummaryCard[] }) {
  if (cards.length > 3) {
    // The cap is three (see the note above). A fourth card means the screen
    // has not decided what matters.
    throw new Error(
      `SummaryCards takes at most three cards; got ${cards.length}.`,
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-2xl border border-ground/10 bg-app-surface px-5 py-4"
        >
          <p className="text-sm font-semibold text-app-ink">{c.label}</p>
          <p className="mt-6 text-sm text-ground">{c.value}</p>
          {c.detail && <p className="text-sm text-olive">{c.detail}</p>}
        </div>
      ))}
    </div>
  );
}

/**
 * The wide white card. `footnote` is the small grey line the mockups put under
 * every chart — the scale, the window, or what the numbers are counted from.
 * §29.1 requires it ("always show the time window, baseline or comparison
 * anchor and refresh time"), so it is a parameter rather than something a
 * page may forget.
 */
export function Panel({
  title,
  footnote,
  children,
  className = "",
}: {
  title?: string;
  footnote?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-ground/10 bg-app-surface px-5 py-5 ${className}`}
    >
      {title && <h2 className="text-sm font-semibold text-app-ink">{title}</h2>}
      <div className={title ? "mt-4" : ""}>{children}</div>
      {footnote && <p className="mt-4 text-xs text-olive">{footnote}</p>}
    </section>
  );
}

/**
 * The narrow tinted card beside the panel — the meaning layer.
 *
 * `boundary` is required and rendered last, because that is what it is for:
 * the mockups never let a chart stand without the sentence saying what it does
 * not prove. Making it optional would make it the first thing dropped.
 */
export function Note({
  tone = "safe",
  title,
  children,
  boundary,
  owner,
  due,
}: {
  tone?: Tone;
  title: string;
  children?: ReactNode;
  /** What this panel does NOT establish. Required by design. */
  boundary: string;
  /** Who is accountable for acting on this. §26's organization purpose is
   *  "see network change AND ACCOUNTABLE ACTION", and the page examples end
   *  every one of these cards with an owner and a due date. A finding with no
   *  owner is a fact nobody is responsible for, which is how an operations
   *  screen becomes wallpaper. */
  owner?: string;
  due?: string;
}) {
  const t = TONE[tone];
  return (
    <div className={`flex h-full flex-col rounded-2xl ${t.bg} px-5 py-5`}>
      <h2 className={`text-sm font-semibold ${t.fg}`}>{title}</h2>
      {children && <div className="mt-3 text-sm text-ground">{children}</div>}
      <div className="mt-auto pt-6">
        {(owner || due) && (
          <p className="mb-2 text-xs text-ground">
            {owner && <span className="block"><span className="font-medium">Owner:</span> {owner}</span>}
            {due && <span className="block"><span className="font-medium">Due:</span> {due}</span>}
          </p>
        )}
        <p className="text-xs text-ground/80">{boundary}</p>
      </div>
    </div>
  );
}

/**
 * The zebra key/value table: the evidence drawer (p63) and the audit lineage
 * (p71) are the same component with different rows.
 *
 * A definition list rather than a table, because these are attributes of one
 * record, not a grid — and a screen reader should hear "Source: validated
 * self-report completed today", not a two-column table with no header.
 */
export function RecordRows({
  rows,
}: {
  rows: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="divide-y divide-ground/5 overflow-hidden rounded-xl border border-ground/10">
      {rows.map((r, i) => (
        <div
          key={r.label}
          className={`grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4 ${
            i % 2 === 1 ? "bg-moss/40" : "bg-app-surface"
          }`}
        >
          <dt className="text-sm font-medium text-app-ink">{r.label}</dt>
          <dd className="min-w-0 text-sm text-ground">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The two-column body: panel on the left, meaning card on the right. */
export function WithNote({
  children,
  note,
}: {
  children: ReactNode;
  note: ReactNode;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_15rem]">
      <div className="min-w-0">{children}</div>
      {note}
    </div>
  );
}
