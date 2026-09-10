// Performance budgets, per surface class (handoff 06 §31.2 wave 6).
//
// Wave 6 lists performance beside accessibility, security, telemetry, export
// parity and disaster behaviour, and its exit condition is "release criteria
// and clinical/security sign-offs complete". The load gate this codebase
// already has (scripts/loadcheck.mjs, docs/load-test/README.md) measures ONE
// path — the public home page — under concurrency. That answers "does the
// server stand up", which is a different question from "is this screen fast
// enough for what somebody is doing on it".
//
// A BUDGET IS A CLINICAL STATEMENT HERE, NOT A TECHNICAL ONE, which is why the
// classes below are named for who is waiting and why rather than for how much
// work the server does. §3.4's finding about the old Today was that it "makes
// the member decide what matters now. On a hard day, that choice load is
// exactly what the system should reduce" — and a screen somebody opens because
// they are activated, which takes two seconds to say anything, has added to
// that load rather than reduced it. The aggregate consoles genuinely aggregate,
// and nobody opens one mid-crisis; they get a looser budget for a stated
// reason rather than because they happen to be slow.
//
// EVERY NUMBER HERE IS A DECISION SOMEBODY MADE, so each class says what it is
// for. A budget with no rationale is a number the next person will move.

export type BudgetClass = "support" | "decision" | "record" | "aggregate" | "review";

export interface Budget {
  cls: BudgetClass;
  /** Time to the server's first byte, in milliseconds, at the stated percentile. */
  ttfbMs: number;
  /** The percentile the budget is set at. A median budget is a budget most
   *  people meet and the worst day misses, which is the day that matters. */
  percentile: 95;
  why: string;
}

export const BUDGETS: Record<BudgetClass, Budget> = {
  support: {
    cls: "support",
    ttfbMs: 400,
    percentile: 95,
    why:
      "Grounding, crisis resources and the panic panel. Somebody opens these because they " +
      "are activated, and there is no version of this product in which they wait. The " +
      "tightest budget goes to the screens that carry the least data, which is the right " +
      "way round.",
  },
  decision: {
    cls: "decision",
    ttfbMs: 800,
    percentile: 95,
    why:
      "The member's day and the clinician's queue: the two screens that answer 'what do I " +
      "do now'. Slow here does not lose a page view, it adds to the choice load that these " +
      "surfaces exist to reduce.",
  },
  record: {
    cls: "record",
    ttfbMs: 1200,
    percentile: 95,
    why:
      "One person's chart. Read deliberately, with a reason, by somebody who will stay on " +
      "it — so it can afford to assemble more than a queue row. It cannot afford to feel " +
      "broken while a clinician is with a member.",
  },
  aggregate: {
    cls: "aggregate",
    ttfbMs: 2000,
    percentile: 95,
    why:
      "Organization and payer consoles, which really do aggregate: denominators, cohorts " +
      "and periods over a whole population. Nobody opens one mid-crisis. The looser budget " +
      "is a stated allowance, not an observed number that was rounded up to meet.",
  },
  review: {
    cls: "review",
    ttfbMs: 2000,
    percentile: 95,
    why:
      "The review console. Read by somebody doing an audit, who is not waiting on a decision " +
      "and would rather have the whole record than a fast half of it.",
  },
};

/** The class a route belongs to, from its path. Declared as rules rather than a
 *  per-route list so a route added tomorrow gets a budget without anybody
 *  remembering to give it one. */
export function budgetClassFor(routePath: string): BudgetClass {
  if (/^\/(crisis|sos)/.test(routePath) || routePath === "/app/ground") return "support";
  if (/^\/(organization|payer)/.test(routePath)) return "aggregate";
  if (/^\/review/.test(routePath)) return "review";
  if (/^\/clinician\/member\//.test(routePath)) return "record";
  return "decision";
}

export function budgetFor(routePath: string): Budget {
  return BUDGETS[budgetClassFor(routePath)];
}

export interface Measurement {
  path: string;
  cls: BudgetClass;
  /** Samples taken, in milliseconds, sorted. */
  samples: number[];
  p95Ms: number;
  budgetMs: number;
  withinBudget: boolean;
}

/** The 95th percentile of a sample set, nearest-rank.
 *
 *  Nearest-rank rather than interpolated, because interpolating between two
 *  samples reports a number that was never measured — which is the wrong habit
 *  for a figure a release gate reads. */
export function p95(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function measure(path: string, samples: number[]): Measurement {
  const budget = budgetFor(path);
  const value = p95(samples);
  // ONE READ OF THE BUDGET, used for both the number reported and the verdict.
  // These were two reads of `budget.ttfbMs`, and a mutation that changed the
  // reported one left the verdict untouched — so a measurement could show a
  // budget it had not been judged against, which is exactly the shape of thing
  // a release gate must not be able to say.
  const budgetMs = budget.ttfbMs;
  return {
    path,
    cls: budget.cls,
    samples: [...samples].sort((a, b) => a - b),
    p95Ms: value,
    budgetMs,
    withinBudget: value <= budgetMs,
  };
}

/**
 * How many samples a percentile needs before it means anything.
 *
 * A p95 over five samples is the largest of five, which is not a percentile. The
 * gate refuses a measurement below this rather than reporting a confident
 * number from too little — the same rule the aggregate consoles apply to a
 * small cell, for the same reason.
 */
export const MIN_SAMPLES = 20;

export function measurable(samples: number[]): boolean {
  return samples.length >= MIN_SAMPLES;
}

export interface PerformanceRun {
  /** When the run happened, and against what. A measurement with no conditions
   *  is a number somebody will quote in a year. */
  takenAt: string;
  conditions: string;
  measurements: Measurement[];
  breaches: string[];
}
