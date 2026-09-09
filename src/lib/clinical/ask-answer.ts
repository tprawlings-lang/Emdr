// Ask Steady's answer (Thoughts spec v2.1 §12; Phase 5).
//
// §12 is six bullets, and three of them are refusals:
//
//   "Every answer is READ-ONLY. It may surface clinician-created follow-ups or
//    offer a link to create one, but it DOES NOT WRITE CLINICAL MEMORY from the
//    answer itself."
//   "Return a SOURCE LIST AND CLAIM-TO-SOURCE MAPPING."
//   "If evidence is INSUFFICIENT OR CONFLICTING, SAY SO. DO NOT SMOOTH
//    CONFLICTING HISTORY INTO ONE ANSWER."
//
// THE LAST ONE IS THE INTERESTING REQUIREMENT and it is the reason this module
// exists as something other than a prompt. Smoothing is what a language model
// does well: given two records that disagree, the fluent answer is the one that
// reconciles them, and it is wrong in the specific way that matters here —
// a clinician reading "sleep has been improving" cannot tell that two of the
// four sources said the opposite. So the conflict is detected in code, over the
// retrieved set, BEFORE anything is composed, and an answer that has one is
// shaped differently rather than worded differently.
//
// PHASE 4'S DISCIPLINE, REUSED. Every claim carries citations, a claim that
// cites nothing is dropped rather than shown, and the validator takes the
// authorized id set rather than deriving it — the same shape as
// `validateClaims` in session-prep.ts, for the same reason.
//
// NO IMPORTS BEYOND THE RETRIEVAL TYPES. Pure over what it is handed.

import type { Scored, SourceType } from "./ask-retrieval";

export const ASK_VERSION = "ask-steady.1.0.0";

/**
 * What an answer can be.
 *
 * Four shapes rather than one, because §12's refusals are not caveats on an
 * answer — they are different answers. A reader can tell them apart at a
 * glance, which is the point.
 */
export const ANSWER_KINDS = ["answered", "insufficient", "conflicting", "out_of_scope"] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

/** One statement, with the records that support it. §12: "claim-to-source
 *  mapping". */
export interface AskClaim {
  text: string;
  /** Record ids. Empty is invalid and dropped by `validate` below. */
  citations: string[];
  /** What kind of record this came from.
   *
   *  CARRIED BECAUSE OF WHAT A THREAD LOOKS LIKE WITHOUT IT. A thread's text is
   *  its canonical label — "sleep", "her sister" — and rendered as a claim it
   *  reads as a one-word sentence somebody wrote. Naming the kind turns it back
   *  into what it is: a grouping the clinician made, not an observation. */
  sourceType: SourceType;
}

export interface EvidenceRef {
  id: string;
  type: SourceType;
  occurredAt: string;
  /** A short quotation the clinician can recognise, so "View source" is a
   *  confirmation rather than an expedition. */
  excerpt: string;
}

export interface AskAnswer {
  kind: AnswerKind;
  /** The question, kept verbatim. An answer whose question was normalised is
   *  an answer to a question nobody asked. */
  question: string;
  /** Present for every kind. On `insufficient` it says what was looked for and
   *  not found; on `conflicting` it says the history disagrees and does not
   *  pick a side. */
  summary: string;
  claims: AskClaim[];
  sources: EvidenceRef[];
  /** Claims produced and refused, with the reason. Surfaced rather than
   *  swallowed — an answer that silently dropped half its content is a
   *  shorter answer with no explanation. */
  omitted: Array<{ text: string; reason: string }>;
  /** The disagreements found, when there are any. Named individually: "the
   *  evidence conflicts" is not usable, "these two records disagree about
   *  sleep" is. */
  conflicts: Array<{ topic: string; sides: Array<{ citation: string; says: string }> }>;
  provenance: {
    askVersion: string;
    retrievalPolicyVersion: string;
    /** Whether a semantic scorer was in play. An answer computed without one
     *  is not worse, but it is different, and a reader comparing two answers
     *  deserves to know which they are looking at. */
    semanticScoring: boolean;
    /** How many authorized documents the ranker could see. */
    candidates: number;
    evidenceCutoff: string;
  };
}

/**
 * What this build does NOT search, stated so an answer can say it.
 *
 * §12 requires an answer to say when evidence is insufficient. An answer that
 * reports "not enough in the record" while never having looked at half the
 * record is making a claim about the person that is really a claim about the
 * search. Naming the gap turns the first into the second.
 *
 * IT LIVES HERE RATHER THAN BESIDE THE READERS, and the reason is a build
 * failure rather than a preference: the query box is a client component, and
 * importing this from ask-store.ts pulled that module's memory and thought
 * readers — and through them better-sqlite3, fs and dns — into the browser
 * bundle. Same trap this repository has hit before with vocabulary modules.
 * This file imports nothing but a type, so a client component may read it.
 */
export const NOT_YET_SEARCHED: ReadonlyArray<{ source: string; why: string }> = [
  {
    source: "Check-ins and assessments",
    why: "They live in the event ledger and reach a clinician through the timeline. Retrieval over them needs the same scope guarantee as the records above, and it is not built yet.",
  },
  {
    source: "Session narration and in-session records",
    why: "Held under the session's own authorization, which is narrower than the record view this box reads from.",
  },
];

/** Below this, an answer is `insufficient` rather than thin. Two sources is
 *  the floor for saying anything about a pattern; one is an anecdote. */
export const MIN_EVIDENCE = 2;

// ---------------------------------------------------------------------------
// §12's conflicting-evidence rule
// ---------------------------------------------------------------------------

/**
 * Words that carry a direction, paired with their opposites.
 *
 * DELIBERATELY SMALL AND DELIBERATELY BLUNT. This is not sentiment analysis
 * and must not become it: the job is to notice that two records point opposite
 * ways on the same topic and hand both to the clinician, not to decide which
 * is right or how strongly either is stated. A bigger lexicon would find more
 * conflicts and start being wrong about them; this one finds the obvious ones
 * and says so.
 */
export const DIRECTION_PAIRS: ReadonlyArray<[string[], string[]]> = [
  [["better", "improving", "improved", "easier", "settled", "calmer", "steadier"],
   ["worse", "worsening", "harder", "deteriorating", "unsettled", "disrupted"]],
  [["sleeping", "rested", "slept"], ["insomnia", "awake", "waking", "sleepless"]],
  [["helping", "helped", "works", "working", "useful"],
   ["unhelpful", "stopped", "avoided", "avoiding", "refused"]],
  [["increased", "more", "rising"], ["decreased", "less", "falling", "reduced"]],
];

export function directionOf(text: string): "up" | "down" | null {
  const t = text.toLowerCase();
  let up = 0;
  let down = 0;
  for (const [positive, negative] of DIRECTION_PAIRS) {
    if (positive.some((w) => new RegExp(`\\b${w}\\b`).test(t))) up += 1;
    if (negative.some((w) => new RegExp(`\\b${w}\\b`).test(t))) down += 1;
  }
  if (up > 0 && down === 0) return "up";
  if (down > 0 && up === 0) return "down";
  return null;
}

/**
 * Find records that point opposite ways on the same topic.
 *
 * "The same topic" is a shared structured concept, not a shared word. Two notes
 * that both mention Tuesday are not about the same thing; two that both carry
 * the `sleep` concept are. Concepts come from the extraction layer, so this
 * does not invent a topic model of its own.
 */
export function findConflicts(evidence: ReadonlyArray<Scored>): AskAnswer["conflicts"] {
  const byConcept = new Map<string, Array<{ citation: string; says: string; dir: "up" | "down" }>>();

  for (const s of evidence) {
    const dir = directionOf(s.doc.text);
    if (!dir) continue;
    for (const concept of s.doc.concepts) {
      const list = byConcept.get(concept) ?? [];
      list.push({ citation: s.doc.id, says: excerpt(s.doc.text), dir });
      byConcept.set(concept, list);
    }
  }

  const conflicts: AskAnswer["conflicts"] = [];
  for (const [topic, entries] of byConcept) {
    const up = entries.filter((e) => e.dir === "up");
    const down = entries.filter((e) => e.dir === "down");
    if (up.length > 0 && down.length > 0) {
      conflicts.push({
        topic,
        sides: [...up, ...down].map((e) => ({ citation: e.citation, says: e.says })),
      });
    }
  }
  conflicts.sort((a, b) => a.topic.localeCompare(b.topic));
  return conflicts;
}

export function excerpt(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Validation — the same gate Session Prep uses, for the same reason
// ---------------------------------------------------------------------------

/**
 * Drop every claim whose citations do not resolve to the authorized set.
 *
 * Takes the permitted ids rather than deriving them, so a caller cannot widen
 * the evidence set by passing a different loader. Phase 4's rule — "uncited
 * generated claims are withheld" — applies here unchanged.
 */
export function validate(
  claims: ReadonlyArray<AskClaim>,
  authorized: ReadonlySet<string>
): { kept: AskClaim[]; omitted: Array<{ text: string; reason: string }> } {
  const kept: AskClaim[] = [];
  const omitted: Array<{ text: string; reason: string }> = [];
  for (const c of claims) {
    if (c.citations.length === 0) {
      omitted.push({ text: c.text, reason: "no citation" });
      continue;
    }
    const bad = c.citations.filter((id) => !authorized.has(id));
    if (bad.length > 0) {
      omitted.push({ text: c.text, reason: `cites records outside the authorized set: ${bad.join(", ")}` });
      continue;
    }
    kept.push(c);
  }
  return { kept, omitted };
}

// ---------------------------------------------------------------------------
// Composing the answer
// ---------------------------------------------------------------------------

const INSUFFICIENT_SUMMARY =
  "There is not enough in this person's record to answer that. What was searched is listed below — this is a statement about what has been written down, not about the person.";

const CONFLICTING_SUMMARY =
  "The record disagrees with itself on this, so here are both sides rather than one answer. Deciding which is right is a clinical judgement and Steady does not make it.";

/**
 * Build the answer from retrieved evidence.
 *
 * DETERMINISTIC, AND COMPLETE WITHOUT GENERATION. Every claim here is assembled
 * from a record and cites it. A registered task may later reword this — the
 * same arrangement Session Prep uses — and it cannot introduce a claim, because
 * `validate` runs after it against the same authorized set.
 */
export function compose(args: {
  question: string;
  evidence: ReadonlyArray<Scored>;
  candidates: number;
  semanticScoring: boolean;
  retrievalPolicyVersion: string;
  evidenceCutoff: string;
}): AskAnswer {
  const sources: EvidenceRef[] = args.evidence.map((s) => ({
    id: s.doc.id,
    type: s.doc.type,
    occurredAt: s.doc.occurredAt,
    excerpt: excerpt(s.doc.text),
  }));
  const authorized = new Set(sources.map((s) => s.id));
  const provenance = {
    askVersion: ASK_VERSION,
    retrievalPolicyVersion: args.retrievalPolicyVersion,
    semanticScoring: args.semanticScoring,
    candidates: args.candidates,
    evidenceCutoff: args.evidenceCutoff,
  };

  if (args.evidence.length < MIN_EVIDENCE) {
    return {
      kind: "insufficient",
      question: args.question,
      summary: INSUFFICIENT_SUMMARY,
      claims: [],
      sources,
      omitted: [],
      conflicts: [],
      provenance,
    };
  }

  const conflicts = findConflicts(args.evidence);

  // One claim per retrieved record, each citing exactly the record it came
  // from. That is a deliberately modest answer: it tells a clinician what is in
  // the record about their question and where each part came from, and it never
  // asserts anything the record does not.
  const raw: AskClaim[] = args.evidence.map((s) => ({
    text: excerpt(s.doc.text),
    citations: [s.doc.id],
    sourceType: s.doc.type,
  }));
  const { kept, omitted } = validate(raw, authorized);

  return {
    kind: conflicts.length > 0 ? "conflicting" : "answered",
    question: args.question,
    summary:
      conflicts.length > 0
        ? CONFLICTING_SUMMARY
        : `${kept.length} record${kept.length === 1 ? "" : "s"} in this person's history bear on that question. Each is shown with its source.`,
    claims: kept,
    sources,
    omitted,
    conflicts,
    provenance,
  };
}

/** The answer for a question asked about somebody the clinician may not read.
 *  Shaped like every other answer so a caller cannot forget to handle it. */
export function outOfScope(question: string, provenance: AskAnswer["provenance"]): AskAnswer {
  return {
    kind: "out_of_scope",
    question,
    summary: "That question is about a person outside your access. Nothing was retrieved.",
    claims: [],
    sources: [],
    omitted: [],
    conflicts: [],
    provenance,
  };
}

/**
 * §12: "Every answer is read-only... it does not write clinical memory from the
 * answer itself."
 *
 * A predicate rather than a comment, so the rule is checkable. An answer offers
 * one thing that changes state — a link to create a follow-up the clinician
 * writes themselves — and nothing on this type can become a memory item.
 */
export const ASK_WRITES_NOTHING = true;

export function mayPromoteToMemory(_a: AskAnswer): boolean {
  return false;
}
