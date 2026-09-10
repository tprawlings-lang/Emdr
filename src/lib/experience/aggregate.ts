// The aggregate presentation contract (handoff 09 §6, §8.5, §10 Package 5).
//
// Package 5's exit evidence: "Screen and export parity. Aggregate-only,
// denominator, and observed/modelled guards pass."
//
// THE ONE SENTENCE THIS MODULE EXISTS TO MAKE STRUCTURAL is §6's:
//
//   "Observed and modelled are visually separate. Unit, period, denominator,
//    and material lag sit beside the value. A user must never have to open a
//    drawer to learn a number is modelled."
//
// A drawer is where this always ends up. The value goes on the card, and the
// method — how it was derived, what it assumes, whether anybody measured it —
// goes behind a disclosure, because the card is small and the method is long.
// Then a buyer screenshots the card. So `ValueView` cannot be constructed
// without its provenance, its unit, its period and its denominator, and a
// modelled one cannot be constructed without the word `modelled` in the label
// that renders beside it. The drawer still exists, and §6 still wants it — it
// carries the method. It just cannot be the only place the word appears.
//
// AND SUPPRESSION IS A DIFFERENT ANSWER FROM ZERO. §6: "Suppression shows as
// withheld, never as zero, and the state survives export." `presentValue`
// returns a discriminated union, so a suppressed cell has no `value` field to
// read — a renderer cannot accidentally format it as 0, and neither can an
// export writer, because both consume the same function. That is what "screen
// and export parity" means here: not two implementations that agree, one
// implementation that both use.
//
// Client-safe: no imports at all.

// ---------------------------------------------------------------------------
// §6 — the scope strip
// ---------------------------------------------------------------------------

/**
 * What every aggregate screen is scoped to.
 *
 * §6: "Organization, period, and data freshness travel together in a scope
 * strip, carried into every drilldown, with a warning before change and an
 * obvious reset."
 *
 * TRAVEL TOGETHER IS THE POINT. These three are one object rather than three
 * query parameters because the failure they prevent is a drilldown that keeps
 * the organization and silently widens the period — which produces a chart
 * that is not comparable with the one it was opened from, with nothing on
 * screen saying so.
 */
export interface Scope {
  /** Which organization or payer book. Never a person, ever. */
  organizationId: string;
  organizationLabel: string;
  /** The reporting window, inclusive. */
  period: { start: string; end: string; label: string };
  /** When the underlying data was last rebuilt. §6 puts it in the strip
   *  because a fresh-looking chart over stale data is the quiet failure.
   *
   *  NULL WHEN NOTHING HAS BEEN BUILT, rather than a sentence. A resolver that
   *  returned "not yet built" produced "rebuilt not yet built" once the strip
   *  prefixed it, which is what putting copy in a data layer costs. The strip
   *  decides how to say it. */
  freshness: { refreshedAt: string | null; dataVersion: string };
}

export class AggregateError extends Error {}

/** The parameters a drilldown must carry. Named once so a link cannot invent
 *  its own spelling and drop the period on the way. */
export const SCOPE_PARAMS = ["org", "from", "to", "v"] as const;

export function scopeToParams(scope: Scope): Record<string, string> {
  return {
    org: scope.organizationId,
    from: scope.period.start,
    to: scope.period.end,
    v: scope.freshness.dataVersion,
  };
}

/** A drilldown href with the scope attached. Exported so a component links
 *  through this rather than by string-building — the whole mechanism fails on
 *  the one link somebody writes by hand. */
export function drilldownHref(href: string, scope: Scope): string {
  const params = new URLSearchParams(scopeToParams(scope));
  return `${href}${href.includes("?") ? "&" : "?"}${params.toString()}`;
}

/** Whether a link carries the scope. The guard walks rendered hrefs with it. */
export function carriesScope(href: string): boolean {
  const q = href.split("?")[1];
  if (!q) return false;
  const has = new URLSearchParams(q);
  return SCOPE_PARAMS.every((p) => has.get(p) !== null && has.get(p) !== "");
}

export interface ScopeChange {
  field: "organization" | "period" | "dataVersion";
  from: string;
  to: string;
  /** What the reader loses by making this change. §6 asks for "a warning
   *  before change" — a warning that does not say what changes is a
   *  confirmation dialog, which people click through. */
  consequence: string;
}

/** What changing the scope would do. Empty when nothing changes. */
export function scopeChanges(from: Scope, to: Scope): ScopeChange[] {
  const out: ScopeChange[] = [];
  if (from.organizationId !== to.organizationId) {
    out.push({
      field: "organization",
      from: from.organizationLabel,
      to: to.organizationLabel,
      consequence:
        "Every number on this screen is recomputed for a different population. Nothing you are " +
        "looking at now can be compared with what replaces it.",
    });
  }
  if (from.period.start !== to.period.start || from.period.end !== to.period.end) {
    out.push({
      field: "period",
      from: from.period.label,
      to: to.period.label,
      consequence:
        periodDays(from.period) === periodDays(to.period)
          ? "The window moves. Counts are comparable; anything seasonal is not."
          : "The window is a different LENGTH, so counts are not comparable with the ones on " +
            "screen. Rates remain comparable where the denominator moved with it.",
    });
  }
  if (from.freshness.dataVersion !== to.freshness.dataVersion) {
    out.push({
      field: "dataVersion",
      from: from.freshness.dataVersion,
      to: to.freshness.dataVersion,
      consequence:
        "A different dataset build. Figures may move for reasons that have nothing to do with " +
        "the population.",
    });
  }
  return out;
}

function periodDays(p: { start: string; end: string }): number {
  const a = Date.parse(`${p.start}T00:00:00Z`);
  const b = Date.parse(`${p.end}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

// ---------------------------------------------------------------------------
// §6 — observed and modelled
// ---------------------------------------------------------------------------

export const PROVENANCE = ["observed", "modelled"] as const;
export type Provenance = (typeof PROVENANCE)[number];

/**
 * The word that renders BESIDE the number, not in a drawer.
 *
 * §8.5: "Every modelled number carries the word modelled in the same visual
 * field; observed numbers say observed wherever confusion is plausible."
 *
 * Both are non-empty, which is the deliberate half. An empty string for
 * `observed` would make the label optional in practice — a component would
 * render `{label}` and produce nothing, and the distinction would exist only
 * where somebody remembered it.
 */
export const PROVENANCE_LABEL: Record<Provenance, string> = {
  observed: "observed",
  modelled: "modelled",
};

export const PROVENANCE_NOTE: Record<Provenance, string> = {
  observed: "Counted from records in this dataset.",
  modelled: "Derived from an assumption, not counted. The method drawer says which.",
};

export interface ValueView {
  /** What the number is. */
  label: string;
  /** §6: unit, period, denominator and material lag sit BESIDE the value. */
  unit: string;
  period: string;
  denominator: number;
  /** How long after an event it lands in this figure. §6 names it because a
   *  30-day-lagged number read as current is the most expensive misreading a
   *  buyer can make. Zero is a real answer and is stated as one. */
  materialLagDays: number;
  provenance: Provenance;
  /** The rendered provenance word. Set by `presentValue`, never by a caller —
   *  see the note there. */
  provenanceLabel: string;
}

export type Presented =
  | ({ kind: "value"; value: number } & ValueView)
  | ({ kind: "withheld"; reason: string; below: number } & ValueView)
  | ({ kind: "unavailable"; reason: string } & ValueView);

export interface PresentInput extends Omit<ValueView, "provenanceLabel"> {
  value: number | null;
  /** True when small-cell suppression applies. */
  suppressed?: boolean;
  suppressedBelow?: number;
  /** Set when the figure cannot be shown at all — a missing version, a missing
   *  denominator. Renders as a stated reason rather than as a dash. */
  unavailable?: string | null;
}

/**
 * The only way to put an aggregate number on a screen or in a file.
 *
 * ONE FUNCTION, TWO CONSUMERS — and that is what "screen and export parity"
 * means in this package. The renderer and the CSV writer both call this, so
 * they cannot disagree about whether a cell is withheld: there is no second
 * implementation to drift. §6: "Suppression shows as withheld, never as zero,
 * and the state survives export."
 *
 * A WITHHELD RESULT HAS NO `value` FIELD. Not `value: 0`, not `value: null` —
 * absent, so `presented.value` does not type-check without narrowing the
 * union first. A renderer that formats numbers cannot format this one by
 * accident, which is the failure mode: `{value ?? 0}` in a template, and a
 * suppressed cohort of four people renders as a confident zero.
 */
export function presentValue(input: PresentInput): Presented {
  const base: ValueView = {
    label: input.label,
    unit: input.unit,
    period: input.period,
    denominator: input.denominator,
    materialLagDays: input.materialLagDays,
    provenance: input.provenance,
    // Stamped here rather than accepted from the caller. A caller-supplied
    // label is a label somebody sets to "" for a card that felt cluttered.
    provenanceLabel: PROVENANCE_LABEL[input.provenance],
  };
  if (!base.provenanceLabel) {
    throw new AggregateError(`No provenance label for "${input.provenance}".`);
  }

  if (input.unavailable) {
    return { kind: "unavailable", reason: input.unavailable, ...base };
  }
  if (input.suppressed) {
    return {
      kind: "withheld",
      // §6: withheld, never zero — and the reason says it is a disclosure
      // control rather than an absence of people.
      reason: "Withheld to protect a small group, not a count of zero.",
      below: input.suppressedBelow ?? 0,
      ...base,
    };
  }
  if (input.value === null) {
    return {
      kind: "unavailable",
      reason: "No denominator, so there is no rate to state.",
      ...base,
    };
  }
  return { kind: "value", value: input.value, ...base };
}

/** What a cell says in a CSV. The SAME presentation, rendered as text — so a
 *  withheld cell is the word rather than an empty field, which a spreadsheet
 *  would show as zero. */
export function exportCell(p: Presented): string {
  switch (p.kind) {
    case "value":
      return String(p.value);
    case "withheld":
      return "withheld";
    case "unavailable":
      return "unavailable";
  }
}

/** Whether anything about this figure may be read as a plain number. Exported
 *  so a guard checks the property rather than the rendering. */
export function isNumeric(p: Presented): p is { kind: "value"; value: number } & ValueView {
  return p.kind === "value";
}

// ---------------------------------------------------------------------------
// §6 — comparison limits
// ---------------------------------------------------------------------------

/**
 * §6: "A changed cohort definition, period length, or data source produces a
 * stated limit rather than a silent comparison."
 *
 * SILENT IS THE DANGEROUS WORD. Nobody sets out to compare two incomparable
 * periods; it happens because the screen offers a delta and the delta renders
 * whatever arithmetic allows. So `compare` returns the limits alongside the
 * change, and `mayShowDelta` is false when any limit applies — the arithmetic
 * is still available, and the surface has to decide to print it against a
 * stated reason.
 */
export interface Comparison {
  delta: number | null;
  limits: string[];
  mayShowDelta: boolean;
}

export function compare(args: {
  current: { value: number | null; cohortVersion: string; period: { start: string; end: string }; dataVersion: string };
  previous: { value: number | null; cohortVersion: string; period: { start: string; end: string }; dataVersion: string };
}): Comparison {
  const limits: string[] = [];

  if (args.current.cohortVersion !== args.previous.cohortVersion) {
    limits.push(
      `The cohort definition changed between these periods (${args.previous.cohortVersion} → ` +
        `${args.current.cohortVersion}), so the two figures count different people.`
    );
  }
  const now = periodDays(args.current.period);
  const then = periodDays(args.previous.period);
  if (now !== then) {
    limits.push(
      `These periods are different lengths (${then} days and ${now} days), so counts are not ` +
        "comparable."
    );
  }
  if (args.current.dataVersion !== args.previous.dataVersion) {
    limits.push(
      "These figures come from different dataset builds, so a difference may not describe the " +
        "population."
    );
  }

  const delta =
    args.current.value === null || args.previous.value === null
      ? null
      : args.current.value - args.previous.value;

  return { delta, limits, mayShowDelta: limits.length === 0 && delta !== null };
}

// ---------------------------------------------------------------------------
// §6, §10 — what changed
// ---------------------------------------------------------------------------

export interface Change {
  label: string;
  /** The sentence a reader takes away. §8.5: "Avoid causal language unless the
   *  design supports causal inference. Prefer observed alongside, changed
   *  during, recorded after." */
  statement: string;
  provenance: Provenance;
  /** Where to go to see it. Carries the scope. */
  href: string;
}

/** §6: "Lead with two or three meaningful changes, then the supporting table."
 *
 *  THE CAP IS THE FEATURE. A "what changed" list of eleven items is the
 *  supporting table with a different heading, and it puts the reader back to
 *  deciding what matters — which is the job this framing exists to do for
 *  them. Three, and the surface says how many others there were. */
export const MAX_LEADING_CHANGES = 3;

export function leadWith(changes: readonly Change[]): { leading: Change[]; remaining: number } {
  return {
    leading: changes.slice(0, MAX_LEADING_CHANGES),
    remaining: Math.max(0, changes.length - MAX_LEADING_CHANGES),
  };
}

/** Words that assert a cause. §8.5 rules them out unless the design supports
 *  causal inference, and no aggregate screen in this product does. */
export const CAUSAL_WORDS = [
  "caused", "causes", "causing", "because of", "due to", "led to", "drove",
  "resulted in", "responsible for", "thanks to", "improved by", "reduced by",
];

export function causalLanguage(text: string): string[] {
  const lower = text.toLowerCase();
  return CAUSAL_WORDS.filter((w) => lower.includes(w));
}

// ---------------------------------------------------------------------------
// §6 — no decorative ownership
// ---------------------------------------------------------------------------

/**
 * §6: "Do not offer Assign follow-up unless a persisted, authorized ownership
 * workflow exists. An owner chip that implies someone accepted responsibility,
 * when nobody did, is a clinical-safety misstatement wearing a UI costume."
 *
 * A CONSTANT RATHER THAN A CHECK, because there is nothing to check yet. The
 * aggregate consoles have no ownership table, no assignment action and no
 * acceptance record — so this is `false`, the surfaces read it, and the day
 * somebody builds the workflow they change one line and the guard below stops
 * failing. What this prevents is the intermediate state where a chip is added
 * because the design had a space for it.
 */
export const AGGREGATE_OWNERSHIP_EXISTS = false;

export function mayOfferOwnership(): boolean {
  return AGGREGATE_OWNERSHIP_EXISTS;
}

/** What a surface says instead. Naming it here stops each screen inventing a
 *  softer version that still implies somebody is on it. */
export const NO_OWNERSHIP_NOTE =
  "No one is assigned to these figures. This console reports; it does not route work.";
