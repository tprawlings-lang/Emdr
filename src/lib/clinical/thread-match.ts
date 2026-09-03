// Thread matching (§9's `clinician.thread.match`, §10, Phase 3).
//
// Takes an APPROVED memory item and asks which existing threads it might belong
// to. It proposes; it never connects. §10's last rule is the one this module is
// built around: "never let similarity itself create a clinical relationship."
//
// WHY THIS IS DETERMINISTIC AND NOT A MODEL CALL, in this deployment.
//
// §9 registers `clinician.thread.match` as a gateway task, and the task is
// registered — a deployment with an embedding index and a model should use it,
// and the contract is there for that. But the scoring §10 specifies is four
// parts arithmetic and one part semantic similarity, and this deployment has no
// embedding index. Running a language model to produce the four arithmetic
// parts would be slower, non-reproducible, and would put a model's name on a
// number that a spreadsheet computes exactly.
//
// So the matcher computes what it can compute, says which components it used,
// and records the retrieval policy version on every proposal. When the semantic
// component arrives, the same proposals become comparable to these only if the
// policy version says they were made the same way — which is the whole reason
// §10 asks for the version.
//
// WHAT IT REFUSES TO PROPOSE:
//
//   A pair the clinician has already decided, in either direction. A rejected
//   link stays rejected; an accepted one is already connected.
//   Anything below the policy threshold, rather than the top N — five weak
//   suggestions because five is the page size is how a queue teaches people to
//   click through it.
//   More than the policy cap from any one item.
//   An item that is not approved. A candidate nobody kept has no business
//   joining a longitudinal pattern.

import type { TenantContext } from "../repository";
import type { MemoryItem } from "./memory-store";
import { decidedPairs, listThreads, proposeMembership, type Membership, type Thread } from "./thread-store";
import { recordConnectionProposed } from "./thoughts";
import {
  combine, lexicalMatch, structuredConceptMatch, recencySignal, sourceReliability,
  PROPOSE_THRESHOLD, MAX_PROPOSALS_PER_ITEM, RETRIEVAL_POLICY_VERSION,
  type ScoreBreakdown,
} from "./retrieval-policy";

export interface ThreadCandidate {
  thread: Thread;
  breakdown: ScoreBreakdown;
  /** Why this was offered, in a sentence a clinician can disagree with.
   *  §10 requires evidence for every candidate; a bare number is not a reason. */
  because: string;
}

/** Score one item against one thread. Exported for tests and for the review
 *  screen, which shows the reason next to the suggestion. */
export function scoreThread(item: MemoryItem, thread: Thread, now: number): ThreadCandidate {
  const lexical = lexicalMatch(item.displayText, thread.canonicalLabel);
  const structured = structuredConceptMatch(item.normalizedLabel, thread.canonicalLabel);
  const recency = recencySignal(thread.lastSeenAt, now);
  const reliability = sourceReliability(item.statementClass);

  const breakdown = combine({
    lexical_match: lexical,
    structured_concept_match: structured,
    recency_signal: recency,
    source_reliability_weight: reliability,
  });

  // The reason names the strongest structured signal, because that is the one a
  // clinician can check. "Scored 0.71" is not something anyone can disagree
  // with; "its label is sleep, and so is this thread's" is.
  let because: string;
  if (structured >= 1) {
    because = `Both are labelled “${thread.canonicalLabel}”.`;
  } else if (structured > 0) {
    because = `Its label overlaps this thread's (“${item.normalizedLabel}” / “${thread.canonicalLabel}”).`;
  } else if (lexical > 0) {
    because = `Its wording shares terms with this thread's name.`;
  } else {
    because = `This thread was active recently.`;
  }

  return { thread, breakdown, because };
}

export interface MatchResult {
  candidates: ThreadCandidate[];
  /** Proposals actually written. Empty when every candidate was below the
   *  threshold or already decided. */
  proposed: Membership[];
  policyVersion: string;
  /** Threads skipped because this pair already has a decision. Reported so a
   *  clinician wondering why an obvious link was not offered has an answer,
   *  rather than concluding the matcher missed it. */
  alreadyDecided: number;
}

/**
 * Propose thread connections for one approved item.
 *
 * Writes `proposed` memberships only. Nothing here can accept one — the store's
 * `proposeMembership` has no status parameter, so "no auto-link in v1" is a
 * property of the call rather than of this function remembering.
 */
export async function matchItemToThreads(
  ctx: TenantContext,
  item: MemoryItem,
  now = Date.now()
): Promise<MatchResult> {
  const empty: MatchResult = {
    candidates: [], proposed: [], policyVersion: RETRIEVAL_POLICY_VERSION, alreadyDecided: 0,
  };
  // A candidate nobody kept has no business joining a longitudinal pattern.
  if (item.status !== "approved") return empty;

  const threads = await listThreads(ctx, item.personId, "active");
  if (threads.length === 0) return empty;

  const decided = await decidedPairs(ctx, item.personId);
  let alreadyDecided = 0;

  const scored: ThreadCandidate[] = [];
  for (const thread of threads) {
    if (decided.has(`${thread.id}::${item.id}`)) {
      alreadyDecided++;
      continue;
    }
    scored.push(scoreThread(item, thread, now));
  }
  scored.sort((a, b) => b.breakdown.score - a.breakdown.score);

  const worth = scored
    .filter((c) => c.breakdown.score >= PROPOSE_THRESHOLD)
    .slice(0, MAX_PROPOSALS_PER_ITEM);

  const proposed: Membership[] = [];
  for (const c of worth) {
    const m = await proposeMembership(ctx, {
      personId: item.personId,
      threadId: c.thread.id,
      memoryItemId: item.id,
      proposedBy: "system",
    });
    // The score AND the policy version that produced it. §10 puts the weights
    // behind a version so evaluation can change them; without the version on
    // the event, a proposal made under today's weights is indistinguishable
    // from one made under next quarter's, and the evaluation §10 is asking for
    // is impossible after the fact.
    await recordConnectionProposed({
      membershipId: m.id,
      threadId: c.thread.id,
      memoryItemId: item.id,
      tenantId: ctx.tenantId,
      personId: item.personId,
      proposedBy: "system",
      score: c.breakdown.score,
      policyVersion: c.breakdown.policyVersion,
    });
    proposed.push(m);
  }

  return { candidates: scored, proposed, policyVersion: RETRIEVAL_POLICY_VERSION, alreadyDecided };
}

/** Match every item a save just approved.
 *
 *  §3.2: suggestions "appear after the main review". This is what runs at that
 *  point — after Save Thoughts, not during it, so a clinician deciding what is
 *  true is never simultaneously deciding what it connects to. */
export async function matchApprovedItems(
  ctx: TenantContext, items: MemoryItem[], now = Date.now()
): Promise<MatchResult> {
  const all: ThreadCandidate[] = [];
  const proposed: Membership[] = [];
  let alreadyDecided = 0;
  for (const item of items) {
    const r = await matchItemToThreads(ctx, item, now);
    all.push(...r.candidates);
    proposed.push(...r.proposed);
    alreadyDecided += r.alreadyDecided;
  }
  return { candidates: all, proposed, policyVersion: RETRIEVAL_POLICY_VERSION, alreadyDecided };
}
