// The role-home projection (handoff 09 §10 Package 1; §4.1, §5).
//
// Every role's home answers one operating question, and §5 states the
// clinician's outright: "who needs me today, why, what changed, and what should
// I do next?" The member's, from §4.1's own heading, is "What would help
// today?"
//
// SO A ROLE HOME IS ONE QUESTION, ONE PRIMARY ACTION, AND HONEST COVERAGE —
// and this type is those three things. What it deliberately does not have is a
// list of cards: §8.2 says "one page title, a short purpose statement only
// where needed, one strongest action. Use whitespace and dividers before adding
// another card", and a projection shaped as `cards: Card[]` is a projection
// that invites a seventh card.
//
// COVERAGE IS A REQUIRED FIELD, not an optional warning. §5: "Coverage failure
// is visible, not silent. Name which providers failed and the last good
// reading. Partial coverage must never render as full coverage." A home whose
// coverage is optional is a home that renders as complete when it is not, and
// the failure is silent — which is the worst property this screen could have.
//
// AND THE PRIMARY ACTION MAY BE ABSENT. §4.1's day states include Stabilizing
// ("present the day as complete") and Crisis ("stop the processing flow"),
// where the strongest action is not an activity. `primary: null` is a real
// answer rather than a gap, and the note says which.

import type { Audience } from "../app/route-register";
import type { NavigationManifest } from "./navigation";

/** What the role came here to answer. One sentence, in their terms. */
export interface OperatingQuestion {
  question: string;
  /** The orienting line under it. §4.1: "One supportive orienting sentence
   *  describing the day without score, band, track name, or performance
   *  judgment." */
  orienting: string;
}

export interface PrimaryAction {
  label: string;
  href: string;
  /** What it is, for somebody deciding whether to press it. */
  description: string;
  /** §4.1: "an approximate duration". Absent for roles where it is meaningless. */
  approximateMinutes?: number;
  /** §4.1: "a clear pause promise". Required wherever the action is an
   *  activity a person could need to stop partway through. */
  pausePromise?: string;
}

/**
 * Which sources fed this home, and which did not.
 *
 * `failed` carries the last good reading per source, because §5 asks for it and
 * because "this source is down" and "this source has been down since Tuesday"
 * are different pieces of information to a clinician deciding whether to trust
 * the queue.
 */
export interface Coverage {
  ran: string[];
  failed: Array<{ source: string; reason: string; lastGoodAt: string | null }>;
  /** True when everything that should have run did. */
  complete: boolean;
}

export interface RoleHome<Item = never> {
  audience: Audience;
  asking: OperatingQuestion;
  /** Null is a real answer. See the header. */
  primary: PrimaryAction | null;
  /** Why there is no primary action, when there is not. Required in that case:
   *  §8.4 forbids an absence that implies a healthy state. */
  primaryAbsentNote?: string;
  /** The work, for roles that have a list of it. Typed per role by the caller
   *  — §9's "no generic renderer: use typed role projections". */
  items: Item[];
  /** How many items there are in total, which is not always `items.length`:
   *  a home shows the first page and the count is the whole. §5: a filter must
   *  not make an obligation disappear, so the total is always reported. */
  totalItems: number;
  coverage: Coverage;
  navigation: NavigationManifest;
  generatedAt: string;
}

export class RoleHomeError extends Error {}

/**
 * Refuse a home that would render dishonestly.
 *
 * Three checks, and each one has a failure behind it: a home with no question
 * is a screen nobody can orient on; a home with no primary action and no
 * explanation reads as "nothing to do"; and partial coverage reported as
 * complete is the silent failure §5 names.
 */
export function assertRoleHome<I>(home: RoleHome<I>): RoleHome<I> {
  if (!home.asking.question.trim()) {
    throw new RoleHomeError("A role home must name the question it answers.");
  }
  if (!home.primary && !home.primaryAbsentNote?.trim()) {
    throw new RoleHomeError(
      "A home with no primary action must say why in words. §8.4: an absence must never imply a healthy or low-risk state."
    );
  }
  if (home.coverage.complete && home.coverage.failed.length > 0) {
    throw new RoleHomeError(
      "Coverage is marked complete with failed sources listed. §5: partial coverage must never render as full coverage."
    );
  }
  if (home.totalItems < home.items.length) {
    throw new RoleHomeError(
      "A home reports fewer total items than it is showing, which would let a filter hide an obligation (§5)."
    );
  }
  return home;
}

export function fullCoverage(ran: string[]): Coverage {
  return { ran, failed: [], complete: true };
}

export function partialCoverage(
  ran: string[], failed: Coverage["failed"]
): Coverage {
  return { ran, failed, complete: failed.length === 0 };
}

/** The sentence a surface shows when coverage is partial. §5's requirement,
 *  built once so every role home says it the same way. */
export function coverageNote(c: Coverage): string | null {
  if (c.complete) return null;
  const names = c.failed.map((f) => f.source).join(", ");
  const lastGood = c.failed
    .map((f) => (f.lastGoodAt ? `${f.source} last read ${f.lastGoodAt.slice(0, 10)}` : null))
    .filter(Boolean)
    .join("; ");
  return (
    `Some sources are unavailable: ${names}. This view may be incomplete.` +
    (lastGood ? ` ${lastGood}.` : "")
  );
}
