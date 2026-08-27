// Evidence-linked clinical summary (Phase 4; workflow spec §4).
//
// This is the highest-leverage and highest-risk surface in the clinical
// product: it saves the most clinician time, and it is where an unreviewable
// fabrication would do the most damage. The contract is therefore strict and
// enforced in code rather than in a prompt.
//
//   EVERY CLAIM CITES THE EVENTS IT RESTS ON. A claim that cannot cite is not
//   displayed — it is dropped and counted. `validateSummary` is the gate, and
//   it does not trust the generator to have behaved.
//
//   CITATIONS MUST RESOLVE. A claim citing an event id that is not in the
//   evidence set is treated as a fabrication, not a typo, and is dropped.
//
//   RECONSTRUCTED HISTORY IS NOT EVIDENCE. Genesis events are excluded from the
//   citable set (ADR 0010: never presented as original evidence).
//
//   THE SUMMARY IS NEVER THE RECORD. It is a reading aid over the timeline, and
//   the timeline is authoritative. Approving a summary records that a human read
//   it; it does not make the summary evidence.
//
// GENERATION IS DETERMINISTIC AT T0/T1. Claims are composed from events by
// code, not drafted by a model. That is a deliberate choice for the
// demonstration tier: it makes summaries reproducible for a scripted demo, and
// it means the citation contract is proven against a generator that cannot
// hallucinate before it is trusted with one that can. Swapping in a
// model-drafted generator changes `provenance.generator` and nothing else —
// validateSummary stays exactly as strict.

import type { Timeline, TimelineEntry } from "./timeline";
import { originalEvidence } from "./timeline";

export const SUMMARY_GENERATOR_VERSION = "deterministic-v1";

export type ClaimKind =
  | "state_trend"   // how the member has been
  | "engagement"    // what they have done
  | "risk"          // safety-relevant observation
  | "care_activity" // sessions and outcomes
  | "gap";          // what is missing or unknown

export interface Claim {
  kind: ClaimKind;
  text: string;
  /** Event ids this claim rests on. Empty is invalid and will be dropped. */
  citations: string[];
}

export interface SummaryProvenance {
  generator: string;
  policyVersion: string;
  /** Every event id the generator was allowed to see. */
  retrievalScope: string[];
  windowFrom: string | null;
  windowTo: string | null;
  /** What the generator did NOT look at, stated rather than implied. */
  excluded: string[];
}

export interface ClinicalSummary {
  personId: string;
  claims: Claim[];
  /** Claims the generator produced that failed validation, with the reason.
   *  Surfaced, not swallowed: a suppressed claim is a signal about the
   *  generator, and hiding it would hide a defect. */
  omitted: { text: string; reason: string }[];
  /** Coverage the clinician needs in order to weigh the summary. */
  coverage: {
    eventsConsidered: number;
    reconstructedExcluded: number;
    withheldByPolicy: number;
  };
  provenance: SummaryProvenance;
}

// ---------------------------------------------------------------------------
// Validation — the gate, independent of the generator
// ---------------------------------------------------------------------------

/** Enforce the citation contract against a set of permitted evidence.
 *
 *  Deliberately separate from generation and deliberately suspicious of it:
 *  the contract must hold for a model-drafted generator exactly as it holds for
 *  the deterministic one, and the only way to be sure is to validate output
 *  rather than trust the producer. */
export function validateSummary(
  claims: Claim[], evidence: TimelineEntry[]
): { kept: Claim[]; omitted: { text: string; reason: string }[] } {
  const known = new Set(evidence.map((e) => e.eventId));
  const kept: Claim[] = [];
  const omitted: { text: string; reason: string }[] = [];

  for (const claim of claims) {
    if (claim.citations.length === 0) {
      omitted.push({ text: claim.text, reason: "no citation — a claim that cannot cite is not displayed" });
      continue;
    }
    const unresolved = claim.citations.filter((id) => !known.has(id));
    if (unresolved.length > 0) {
      omitted.push({
        text: claim.text,
        reason:
          `cites ${unresolved.length} event(s) not in the evidence set ` +
          `(${unresolved.slice(0, 3).join(", ")}) — treated as fabricated, not as a typo`,
      });
      continue;
    }
    kept.push(claim);
  }
  return { kept, omitted };
}

// ---------------------------------------------------------------------------
// Deterministic generation
// ---------------------------------------------------------------------------

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Compose claims from events. Each returns its own citations, so a claim can
 *  never be written without naming what it rests on. */
function composeClaims(evidence: TimelineEntry[]): Claim[] {
  const claims: Claim[] = [];
  const byType = (t: string) => evidence.filter((e) => e.type === t);

  // ---- State trend ----
  const checkins = byType("daily_checkin.completed")
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  if (checkins.length >= 2) {
    const first = num(checkins[0].detail.activation);
    const last = num(checkins[checkins.length - 1].detail.activation);
    if (first !== null && last !== null) {
      const delta = last - first;
      const direction = delta < 0 ? "lower" : delta > 0 ? "higher" : "unchanged";
      claims.push({
        kind: "state_trend",
        text:
          `Across ${checkins.length} check-ins, activation moved from ${first} to ${last} ` +
          `(${direction}${delta !== 0 ? ` by ${Math.abs(delta)}` : ""}).`,
        citations: checkins.map((e) => e.eventId),
      });
    }
  } else if (checkins.length === 1) {
    claims.push({
      kind: "state_trend",
      text: "Only one check-in in this window, so no trend can be stated.",
      citations: [checkins[0].eventId],
    });
  }

  // ---- Risk ----
  const harm = checkins.filter((e) => e.detail.harmUrge === true);
  if (harm.length > 0) {
    claims.push({
      kind: "risk",
      text: `Harm urge reported on ${harm.length} check-in${harm.length === 1 ? "" : "s"}, most recently ${harm[harm.length - 1].occurredAt}.`,
      citations: harm.map((e) => e.eventId),
    });
  }
  const unsafe = checkins.filter((e) => e.detail.feelsSafe === false);
  if (unsafe.length > 0) {
    claims.push({
      kind: "risk",
      text: `Reported not feeling safe on ${unsafe.length} check-in${unsafe.length === 1 ? "" : "s"}.`,
      citations: unsafe.map((e) => e.eventId),
    });
  }

  // ---- Care activity ----
  const hardStops = byType("session.hard_stopped");
  if (hardStops.length > 0) {
    const last = hardStops[hardStops.length - 1];
    claims.push({
      kind: "risk",
      text:
        `${hardStops.length} session hard stop${hardStops.length === 1 ? "" : "s"}; most recent in ` +
        `${last.detail.moduleId} — ${last.detail.hardStopReason ?? "reason not recorded"}.`,
      citations: hardStops.map((e) => e.eventId),
    });
  }
  const completed = byType("session.completed");
  if (completed.length > 0) {
    const withSuds = completed.filter((e) => num(e.detail.preSuds) !== null && num(e.detail.postSuds) !== null);
    if (withSuds.length > 0) {
      const drops = withSuds.map((e) => num(e.detail.preSuds)! - num(e.detail.postSuds)!);
      const mean = drops.reduce((a, b) => a + b, 0) / drops.length;
      claims.push({
        kind: "care_activity",
        text:
          `${completed.length} session${completed.length === 1 ? "" : "s"} completed; ` +
          `mean SUDS change ${mean >= 0 ? "-" : "+"}${Math.abs(mean).toFixed(1)} within session.`,
        citations: withSuds.map((e) => e.eventId),
      });
    }
  }

  // ---- Engagement ----
  const practices = byType("intervention.completed");
  const lessons = byType("lesson.read");
  if (practices.length + lessons.length > 0) {
    claims.push({
      kind: "engagement",
      text: `${practices.length} practice${practices.length === 1 ? "" : "s"} and ${lessons.length} lesson${lessons.length === 1 ? "" : "s"} completed.`,
      citations: [...practices, ...lessons].map((e) => e.eventId),
    });
  }

  // ---- Decisions ----
  const decisions = byType("module_unlock.decided");
  if (decisions.length > 0) {
    claims.push({
      kind: "care_activity",
      text: `${decisions.length} unlock decision${decisions.length === 1 ? "" : "s"} recorded.`,
      citations: decisions.map((e) => e.eventId),
    });
  }

  return claims;
}

/** Gaps are stated rather than smoothed: "three check-ins missing" is more
 *  useful to a clinician than a confident sentence covering the hole.
 *
 *  These cite the events that establish the window, so they satisfy the same
 *  contract as every other claim — a gap claim with no evidence of a window
 *  would be an assertion about nothing. */
function composeGapClaims(evidence: TimelineEntry[]): Claim[] {
  const claims: Claim[] = [];
  const checkins = evidence.filter((e) => e.type === "daily_checkin.completed")
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  if (checkins.length < 2) return claims;

  const firstDay = Date.parse(checkins[0].occurredAt.slice(0, 10) + "T00:00:00Z");
  const lastDay = Date.parse(checkins[checkins.length - 1].occurredAt.slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(firstDay) || !Number.isFinite(lastDay)) return claims;

  const span = Math.round((lastDay - firstDay) / 86400000) + 1;
  const distinctDays = new Set(checkins.map((e) => e.occurredAt.slice(0, 10))).size;
  const missing = span - distinctDays;
  if (missing > 0) {
    claims.push({
      kind: "gap",
      text: `${missing} day${missing === 1 ? "" : "s"} in this ${span}-day window have no check-in.`,
      citations: [checkins[0].eventId, checkins[checkins.length - 1].eventId],
    });
  }
  return claims;
}

/** Build a summary over a timeline.
 *
 *  Only original evidence is citable, so the summary rests on what Steady
 *  observed rather than on what it reconstructed afterwards. */
export function buildSummary(timeline: Timeline): ClinicalSummary {
  const evidence = originalEvidence(timeline);
  const proposed = [...composeClaims(evidence), ...composeGapClaims(evidence)];
  const { kept, omitted } = validateSummary(proposed, evidence);

  const excluded: string[] = [];
  if (timeline.reconstructedCount > 0) {
    excluded.push(
      `${timeline.reconstructedCount} reconstructed event(s) — genesis backfill is not original evidence`
    );
  }
  if (timeline.withheld.count > 0) excluded.push(timeline.withheld.reason);
  excluded.push("encrypted content: companion transcripts, instrument item responses, free-text notes");

  const times = evidence.map((e) => e.occurredAt).sort();

  return {
    personId: timeline.personId,
    claims: kept,
    omitted,
    coverage: {
      eventsConsidered: evidence.length,
      reconstructedExcluded: timeline.reconstructedCount,
      withheldByPolicy: timeline.withheld.count,
    },
    provenance: {
      generator: SUMMARY_GENERATOR_VERSION,
      policyVersion: timeline.policyVersion,
      retrievalScope: evidence.map((e) => e.eventId),
      windowFrom: times[0] ?? null,
      windowTo: times[times.length - 1] ?? null,
      excluded,
    },
  };
}

/** One line a clinician can read before deciding whether to trust the rest. */
export function summaryCoverageNote(s: ClinicalSummary): string {
  const parts = [`${s.coverage.eventsConsidered} event(s) considered`];
  if (s.coverage.reconstructedExcluded > 0) parts.push(`${s.coverage.reconstructedExcluded} reconstructed excluded`);
  if (s.coverage.withheldByPolicy > 0) parts.push(`${s.coverage.withheldByPolicy} withheld by policy`);
  if (s.omitted.length > 0) parts.push(`${s.omitted.length} claim(s) suppressed as uncitable`);
  return parts.join(" · ");
}
