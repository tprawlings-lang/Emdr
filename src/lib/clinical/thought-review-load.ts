"use server";

import { requireClinician } from "../auth";
import { data } from "../data";
import { PLATFORM_TENANT_ID } from "../db";
import type { TenantContext } from "../repository";
import { getThought, currentTranscript } from "./thought-store";
import { listItemsForThought } from "./memory-store";
import { runExtraction } from "./extraction";
import { thoughtsSurfaceAvailable } from "./thoughts-flags";
import type { ReviewTranscript } from "../../components/clinical/ThoughtReview";
import type { CandidateCard } from "../../components/clinical/ThoughtItemCards";

// Reading one thought back for the review step.
//
// EXTRACTED FROM THE THOUGHTS PAGE, WHERE IT WAS AN INLINE SERVER ACTION.
// Session-linked notes gave it a second caller — the session-response screen —
// and this is the one piece of the capture path where a second copy would be
// dangerous rather than merely untidy: it is what re-authenticates and
// re-resolves the tenant for an id the BROWSER sends, so a divergence between
// two copies is a divergence in an authorization check.
//
// A SERVER ACTION RATHER THAN A FETCH, for that same reason. The id arriving
// from the browser is checked against the caller's own scope on every call,
// rather than trusted because a page once rendered for somebody.

/** The shape the review step consumes. Named against the components' own
 *  types rather than re-declared, so a field added to a candidate card reaches
 *  this loader as a type error rather than as a silently missing value. */
export interface ReviewLoad {
  transcript: ReviewTranscript;
  transcriptOnly: boolean;
  candidates: CandidateCard[];
}

export async function loadThoughtForReview(thoughtId: string): Promise<ReviewLoad | null> {
  const who = await requireClinician();
  const cc = await data();
  const row = (await cc.get("SELECT tenant_id FROM users WHERE id = ?", [who.id])) as
    | { tenant_id: string } | undefined;
  const scope: TenantContext = {
    tenantId: row?.tenant_id ?? PLATFORM_TENANT_ID, personId: who.id,
  };

  const thought = await getThought(scope, thoughtId);
  if (!thought) return null;
  const t = await currentTranscript(scope, thought);
  if (!t) return null;

  // ORGANIZING HAPPENS HERE, not in the recorder. The clinician has already
  // stopped speaking and is waiting on one spinner; splitting transcription and
  // extraction into two waits would show them two, for a step they did not ask
  // for separately.
  //
  // Its failure is not this function's failure. An extractor that cannot run
  // leaves a perfectly good transcript, and returning null here would throw
  // that away and tell the clinician their recording could not be loaded —
  // which is untrue and is the one thing they are worried about.
  let candidates: Awaited<ReturnType<typeof listItemsForThought>> = [];
  if (thoughtsSurfaceAvailable("CLINICIAN_THOUGHTS_EXTRACTION")) {
    const existing = await listItemsForThought(scope, thoughtId);
    const alreadyRun = existing.length > 0;
    if (!alreadyRun && thought.status === "processing") {
      await runExtraction(scope, thoughtId);
    }
    candidates = (await listItemsForThought(scope, thoughtId))
      .filter((i) => i.status === "candidate");
  }

  const after = await getThought(scope, thoughtId);
  return {
    transcript: { text: t.text, hash: t.hash, version: t.version, provider: t.provider },
    transcriptOnly: after?.status === "review_transcript_only",
    candidates: candidates.map((i) => ({
      id: i.id,
      itemType: i.itemType,
      statementClass: i.statementClass,
      displayText: i.displayText,
      normalizedLabel: i.normalizedLabel,
      // The quoted span, resolved from the transcript rather than stored twice.
      // A second copy of the words is a second thing that can drift from what
      // the clinician actually said.
      quote: i.span ? t.text.slice(i.span.start, i.span.end) : null,
      numericFacts: i.numericFacts,
    })),
  };
}
