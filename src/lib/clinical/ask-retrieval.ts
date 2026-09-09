// Authorized hybrid retrieval for Ask Steady (Thoughts spec v2.1 §10, §12; Phase 5).
//
// §10 opens with the rule that decides this module's shape: "Ask Steady and
// thread matching SHOULD NOT USE EMBEDDINGS ALONE. FIRST ENFORCE AUTHORIZATION
// AND PATIENT SCOPE, THEN retrieve from structured and narrative sources."
//
// SCOPE BEFORE RETRIEVAL, NOT AFTER GENERATION. §12 says it again in its own
// words, and the ordering is the entire security property. A pipeline that
// retrieves broadly, generates, and then filters has already put another
// person's record into a prompt — and the filter is now protecting the reader
// from an answer that was computed from material the reader was never allowed
// to see. So `candidates` takes the authorized set as an argument and has no
// way to widen it: there is no loader in this module, no database call, and
// no person id to look anything up with.
//
// AND SIMILARITY IS NOT A CLINICAL RELATIONSHIP. §10's last bullet: "never let
// similarity itself create a clinical relationship." Ranking decides what a
// clinician READS; it never decides what is true, what is connected, or what
// belongs to a thread. That is why this file ranks and cites and does nothing
// else.
//
// NO IMPORTS. Pure over records handed in, so a test can describe a retrieval
// without a database and so the ranking cannot quietly acquire a reader.

/** Where a piece of evidence came from. §10: "retrieve approved clinical
 *  memory, formal notes the user may access, relevant check-ins/assessments,
 *  and selected patient activity according to purpose." */
export const SOURCE_TYPES = [
  "memory",
  "note",
  "assessment",
  "checkin",
  "session",
  "thread",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * §10's source_reliability_weight, made explicit per source type.
 *
 * A clinician's own written note is the most reliable thing in this store
 * because a person wrote it on purpose; an activity record is the least,
 * because it is a by-product. These are retrieval weights and nothing else —
 * they do not make a note more TRUE than an assessment, they make it more
 * likely to be what somebody asking a question wants to read.
 */
export const SOURCE_RELIABILITY: Record<SourceType, number> = {
  note: 1.0,
  memory: 0.9,
  assessment: 0.8,
  session: 0.6,
  checkin: 0.5,
  thread: 0.7,
};

/** §10: "cap evidence per source type". One kind of record cannot crowd out
 *  every other kind just by being numerous. */
export const PER_SOURCE_CAP = 3;

/** How many pieces of evidence an answer may rest on. A cap rather than a
 *  target: an answer citing twelve records is not better evidenced, it is
 *  harder to check. */
export const MAX_EVIDENCE = 8;

/**
 * §10's weights, versioned.
 *
 * The document is explicit that these are "implementation defaults, not
 * clinical truth" and asks for them "behind versioned retrieval policy so
 * evaluation can change them without changing the meaning of stored records".
 * The version travels on every answer for exactly that reason.
 */
export const RETRIEVAL_POLICY_VERSION = "ask-retrieval.1.0.0";

export const WEIGHTS = {
  semantic: 0.35,
  lexical: 0.25,
  structured: 0.2,
  recency: 0.1,
  reliability: 0.1,
} as const;

/**
 * A record the asking clinician is already authorized to read.
 *
 * `personId` and `tenantId` are on the type so the assertion below can be made
 * at all. They are not used to FETCH anything — by the time a document exists,
 * the fetch has happened and the scope was applied to it.
 */
export interface RetrievalDoc {
  id: string;
  personId: string;
  tenantId: string;
  type: SourceType;
  /** The text a lexical match runs against. Already the version the clinician
   *  may read — a corrected transcript rather than the raw one, an approved
   *  memory item rather than a candidate. */
  text: string;
  occurredAt: string;
  /** Structured concepts already attached to the record by the extraction
   *  layer. Never derived here: a retrieval layer that inferred concepts would
   *  be a second, unreviewed extractor. */
  concepts: string[];
  /** §10: "exclude rejected candidates, dismissed inferences, expired
   *  temporary intelligence". Carried on the document so the exclusion is
   *  visible in the data rather than implied by which loader was called. */
  excluded: null | "rejected" | "dismissed" | "expired" | "unauthorized_zone";
}

export class ScopeViolation extends Error {}

/**
 * The assertion that makes the ordering enforceable.
 *
 * Called before ranking, on every candidate. It cannot repair a bad set — a
 * document from another person is a programming error upstream, and continuing
 * with it filtered out would leave the same bug in place for the next caller.
 * So it throws, and Phase 5's definition of done ("no cross-patient or
 * cross-tenant retrieval") becomes a property somebody has to break loudly.
 */
export function assertScope(
  docs: ReadonlyArray<RetrievalDoc>,
  scope: { tenantId: string; personId: string }
): void {
  for (const d of docs) {
    if (d.tenantId !== scope.tenantId) {
      throw new ScopeViolation(
        `retrieval candidate ${d.id} belongs to tenant ${d.tenantId}, not ${scope.tenantId}`
      );
    }
    if (d.personId !== scope.personId) {
      throw new ScopeViolation(
        `retrieval candidate ${d.id} belongs to another person`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// The embedding abstraction (Phase 5: "create retrieval documents and
// embedding abstraction")
// ---------------------------------------------------------------------------

/**
 * Semantic similarity, as an interface rather than an implementation.
 *
 * NONE IS SUPPLIED, AND THE RANKING WORKS WITHOUT ONE. There is no embedding
 * provider in this build, and inventing a fake similarity that returns
 * plausible numbers would be worse than having none: the scores would look
 * like retrieval quality and be noise. §10 asks for the abstraction and warns
 * against embeddings alone, so what ships is the other four signals — which
 * §10 itself weights at 0.65 of the total — and a named seam.
 *
 * When a provider arrives it satisfies this interface, `semanticWeightApplied`
 * starts returning 0.35, and the version above is bumped so answers computed
 * under the two policies are distinguishable.
 */
export interface SemanticScorer {
  /** 0..1 similarity between a query and a document's text. */
  score(query: string, text: string): number;
}

export const NO_SEMANTIC_SCORER: SemanticScorer | null = null;

/**
 * The weight actually applied to semantic similarity, given the scorer in
 * hand. Zero without one — and the missing weight is NOT redistributed across
 * the other signals, because that would silently change what the remaining
 * signals mean relative to each other. A score computed without a scorer is
 * simply on a smaller scale, and every score in the same answer is on it.
 */
export function semanticWeightApplied(scorer: SemanticScorer | null): number {
  return scorer ? WEIGHTS.semantic : 0;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "is", "was", "are", "were", "been",
  "of", "to", "in", "on", "for", "with", "about", "how", "what", "when", "why",
  "has", "have", "had", "i", "she", "he", "they", "her", "his", "them", "it",
  "been", "getting", "does", "did", "do", "my", "our",
]);

export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Proportion of the query's meaningful terms that appear in the document. */
export function lexicalMatch(query: string, text: string): number {
  const q = terms(query);
  if (q.length === 0) return 0;
  const hay = new Set(terms(text));
  return q.filter((w) => hay.has(w)).length / q.length;
}

/** Proportion of the query's terms that match a structured concept already
 *  attached to the record. Concepts are not inferred here. */
export function structuredMatch(query: string, concepts: ReadonlyArray<string>): number {
  const q = terms(query);
  if (q.length === 0 || concepts.length === 0) return 0;
  const hay = new Set(concepts.flatMap((c) => terms(c)));
  return q.filter((w) => hay.has(w)).length / q.length;
}

/**
 * Recency, as a gentle decay rather than a cliff.
 *
 * Half-weight at 90 days. A clinician asking "when did sleep start getting
 * worse?" is asking about the past on purpose, so recency is a tiebreak at
 * 0.10 rather than a filter — an older record that answers the question
 * directly outranks a recent one that mentions it in passing.
 */
export function recencySignal(occurredAt: string, now: Date): number {
  const t = Date.parse(occurredAt);
  if (Number.isNaN(t)) return 0;
  const days = Math.max(0, (now.getTime() - t) / 86_400_000);
  return 1 / (1 + days / 90);
}

export interface Scored {
  doc: RetrievalDoc;
  score: number;
  /** Every component, kept, so "why did this come back?" is answerable without
   *  re-running the ranker. */
  parts: { semantic: number; lexical: number; structured: number; recency: number; reliability: number };
}

/**
 * Rank authorized candidates.
 *
 * Takes the scope and asserts it rather than trusting the caller, then excludes
 * what §10 excludes, then scores. The order of those three is the point.
 */
export function rank(args: {
  query: string;
  docs: ReadonlyArray<RetrievalDoc>;
  scope: { tenantId: string; personId: string };
  now: Date;
  scorer?: SemanticScorer | null;
}): Scored[] {
  assertScope(args.docs, args.scope);
  const scorer = args.scorer ?? NO_SEMANTIC_SCORER;
  const semanticWeight = semanticWeightApplied(scorer);

  const scored: Scored[] = [];
  for (const doc of args.docs) {
    // §10: rejected candidates, dismissed inferences, expired temporary
    // intelligence and unauthorized zones are excluded — before scoring, so a
    // high-scoring rejected candidate cannot come back on rank.
    if (doc.excluded !== null) continue;

    const parts = {
      semantic: scorer ? scorer.score(args.query, doc.text) : 0,
      lexical: lexicalMatch(args.query, doc.text),
      structured: structuredMatch(args.query, doc.concepts),
      recency: recencySignal(doc.occurredAt, args.now),
      reliability: SOURCE_RELIABILITY[doc.type],
    };
    const score =
      semanticWeight * parts.semantic +
      WEIGHTS.lexical * parts.lexical +
      WEIGHTS.structured * parts.structured +
      WEIGHTS.recency * parts.recency +
      WEIGHTS.reliability * parts.reliability;
    scored.push({ doc, score, parts });
  }

  scored.sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id));
  return scored;
}

/** §10: "deduplicate near-identical sources". Two records with the same
 *  meaningful terms in the same order are one piece of evidence presented
 *  twice, and citing both makes an answer look better supported than it is. */
export function dedupe(scored: ReadonlyArray<Scored>): Scored[] {
  const seen = new Set<string>();
  const out: Scored[] = [];
  for (const s of scored) {
    const key = `${s.doc.type}:${terms(s.doc.text).slice(0, 12).join(" ")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** §10: "cap evidence per source type", then the overall cap. */
export function capPerSource(scored: ReadonlyArray<Scored>, cap = PER_SOURCE_CAP): Scored[] {
  const count = new Map<SourceType, number>();
  const out: Scored[] = [];
  for (const s of scored) {
    const n = count.get(s.doc.type) ?? 0;
    if (n >= cap) continue;
    count.set(s.doc.type, n + 1);
    out.push(s);
  }
  return out;
}

/**
 * A document that matched NOTHING about the question is not evidence for it.
 *
 * §10's ranking mixes five signals, and two of them — recency and source
 * reliability — say nothing about whether a record bears on what was asked. A
 * recent, reliable note with no term and no concept in common with the question
 * still scores 0.10 × recency + 0.10 × reliability, which was enough to cite it.
 *
 * MEASURED, NOT REASONED ABOUT: asking "how has sleep been?" about the seeded
 * member returned a thread called "her sister" among the sources. Nothing was
 * wrong with the ranking — it was doing what a ranking does. What was wrong was
 * treating a rank as a relevance threshold. An answer must be able to show
 * exactly which records supported each statement (§10's last line), and a record
 * that supported nothing supports no statement.
 */
export function topicallyMatches(s: Scored): boolean {
  return s.parts.lexical > 0 || s.parts.structured > 0 || s.parts.semantic > 0;
}

/** The whole retrieval, in the order §10 specifies. */
export function retrieve(args: {
  query: string;
  docs: ReadonlyArray<RetrievalDoc>;
  scope: { tenantId: string; personId: string };
  now: Date;
  scorer?: SemanticScorer | null;
  max?: number;
}): Scored[] {
  const ranked = rank(args).filter(topicallyMatches);
  return capPerSource(dedupe(ranked)).slice(0, args.max ?? MAX_EVIDENCE);
}
