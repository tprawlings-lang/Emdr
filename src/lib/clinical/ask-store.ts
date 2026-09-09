// Building Ask Steady's retrieval documents (Thoughts spec v2.1 §10, §12; Phase 5).
//
// This is the layer that turns an authorized read into retrieval documents, and
// its whole responsibility is the ordering §10 and §12 both insist on: SCOPE
// FIRST, RETRIEVE SECOND.
//
// Every reader called here already takes a `TenantContext` and a person id and
// enforces both — `approvedMemory`, `listThoughts`, `currentTranscript`. The
// documents this produces are therefore authorized by construction rather than
// by a filter applied afterwards, and `assertScope` in ask-retrieval.ts checks
// that claim rather than assuming it. A cross-person document reaching the
// ranker throws instead of being quietly dropped, because a filter that removes
// it leaves the bug that produced it in place.
//
// WHAT IS RETRIEVED, per §10: "approved clinical memory, formal notes the user
// may access, relevant check-ins/assessments, and selected patient activity
// according to purpose." Three of those four exist in this build as first-class
// records and are read here. Check-ins and assessments are in the ledger and
// reach a clinician through the timeline; they are NOT included yet, and the
// answer says so rather than implying the search was exhaustive.

import type { TenantContext } from "../repository";
import { approvedMemory } from "./memory-store";
import { listThoughts, currentTranscript } from "./thought-store";
import { listThreads } from "./thread-store";
import type { RetrievalDoc } from "./ask-retrieval";

/** What a document's concepts come from, per record type. Never inferred from
 *  the text here — a retrieval layer that derived its own concepts would be a
 *  second, unreviewed extractor sitting behind a search box. */
function memoryConcepts(item: { normalizedLabel: string | null; itemType: string }): string[] {
  return [item.normalizedLabel, item.itemType].filter((v): v is string => !!v);
}

/**
 * Everything the asking clinician may read about this person, as documents.
 *
 * The context carries the tenant and the person; nothing here takes an id from
 * a caller and looks it up. That is what makes "no cross-patient or
 * cross-tenant retrieval" a property of the shape rather than of the care taken
 * at each call site.
 */
export async function retrievalDocs(
  ctx: TenantContext,
  personId: string
): Promise<RetrievalDoc[]> {
  const docs: RetrievalDoc[] = [];

  // Approved clinical memory. Approved only: a candidate is a machine's
  // suggestion that no clinician has accepted, and answering a question from
  // one would give an unreviewed inference the standing of a record.
  for (const item of await approvedMemory(ctx, personId)) {
    docs.push({
      id: item.id,
      personId: item.personId,
      tenantId: ctx.tenantId,
      type: "memory",
      text: item.displayText,
      occurredAt: item.approvedAt ?? item.createdAt,
      concepts: memoryConcepts(item),
      excluded: null,
    });
  }

  // The clinician's own saved notes, in the version they may read — a
  // corrected transcript where one exists. Saved only, for the reason Session
  // Prep gives: a thought still in review is a draft of a judgement, and
  // answering from one shows somebody their own unfinished thinking as though
  // they had settled it.
  for (const t of await listThoughts(ctx, personId, 50)) {
    if (t.status !== "saved") continue;
    const transcript = await currentTranscript(ctx, t);
    if (!transcript) continue;
    docs.push({
      id: t.id,
      personId,
      tenantId: ctx.tenantId,
      type: "note",
      text: transcript.text,
      occurredAt: t.recordedAt,
      concepts: [],
      excluded: null,
    });
  }

  // Threads, as their canonical label plus what they are about. A thread is
  // the clinician's own statement that several observations belong together,
  // which makes it strong retrieval evidence for "what have I written about…".
  for (const thread of await listThreads(ctx, personId)) {
    docs.push({
      id: thread.id,
      personId,
      tenantId: ctx.tenantId,
      type: "thread",
      text: thread.canonicalLabel,
      occurredAt: thread.lastSeenAt ?? thread.createdAt,
      concepts: [thread.canonicalLabel],
      // §10: exclude what the clinician has already rejected. A resolved
      // thread is not rejected — it is finished, and finished history is
      // exactly what somebody asking "when did this start" wants.
      excluded: null,
    });
  }

  return docs;
}
