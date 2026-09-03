// Running the extraction task (§9, Phase 2).
//
// Between the transcript and the review cards. What it does NOT do is put
// anything into the clinical record: every item it writes is a candidate, and
// there is no path from here to 'approved'. That is Phase 2's middle line of
// done — "no candidate becomes approved without clinician save" — and it holds
// because this module cannot express the other outcome, not because it is
// careful.
//
// THREE OUTCOMES, AND THEY ARE NOT INTERCHANGEABLE.
//
//   organized       Items were produced. The clinician reviews them.
//   nothing_found   The extractor read the transcript and proposed nothing.
//   unavailable     No extractor could run, or its answer failed validation.
//
// The second and third look identical on a screen that only counts items, and
// they are completely different facts: one says the transcript held nothing
// structured, the other says Steady could not read it. §8.1's state machine
// gives the third its own state — `review_transcript_only` — and §17.4 writes
// the copy for it: "Your transcript is safe. Steady could not organize it yet."
// A feature that collapsed them would tell a clinician their thought was empty
// when the truth was that the model was down.

import { invoke } from "../ai-gateway";
import { THOUGHT_EXTRACT } from "../ai-gateway/registry";
import { fixtureExtraction, FIXTURE_EXTRACTION_MODEL } from "./extraction-fixture";
import { validateExtraction, type ValidationIssue } from "./extraction-contract";
import { createCandidates, clearCandidates, type MemoryItem } from "./memory-store";
import { currentTranscript, getThought, transitionThought } from "./thought-store";
import { recordExtractionCompleted } from "./thoughts";
import type { TenantContext } from "../repository";

export type ExtractionOutcome = "organized" | "nothing_found" | "unavailable";

export interface ExtractionResult {
  outcome: ExtractionOutcome;
  items: MemoryItem[];
  /** Why nothing could be produced. Empty when something was. */
  reason: string;
  /** Items the payload proposed and the contract refused, with the reason for
   *  each. Carried out of here rather than dropped: a model that keeps
   *  proposing speculation-as-fact is a fact about the task, and the only way
   *  anyone learns it is if the refusals are visible. */
  rejected: ValidationIssue[];
  /** Citations that did not survive being checked against the transcript. */
  droppedCitations: number;
  /** Which extractor ran, for the record. */
  source: "fixture" | "gateway" | null;
}

/** §9.2, as the system prompt. Kept here, with the feature that owns the
 *  domain language, rather than in the registry — the registry versions a
 *  prompt, it is not where clinical prose is written. */
const SYSTEM_PROMPT = [
  "You turn a clinician's spoken post-session thought into candidate memory items for that clinician to review.",
  "",
  "Rules, all of which matter more than completeness:",
  "- Extract only what the transcript supports. If it is not in the transcript, it does not exist.",
  "- Do not diagnose.",
  "- Do not turn clinician speculation into patient fact. A hedge stays a hedge.",
  "- Preserve negation. 'did not want to talk about it' must never become 'talked about it'.",
  "- Preserve uncertainty. Use clinician_hypothesis and clinician_uncertainty for thinking-aloud.",
  "- Separate patient report from clinician observation. Quoted speech is patient_report.",
  "- Keep numeric values exactly as stated, and set approximate:true when the transcript hedges ('about', 'maybe', 'around').",
  "- Do not propose thread relationships or connections between items. That is a different task.",
  "- Return source offsets only when you are certain of them. Return null rather than inventing offsets.",
  "",
  "Return only the JSON object described by the schema. No prose.",
].join("\n");

/**
 * Extract candidates for a thought's current transcript.
 *
 * Existing candidates are cleared first, so re-running against a corrected
 * transcript replaces the proposal rather than doubling it (§16). Approved
 * items are never touched by that — `clearCandidates` cannot reach them.
 */
/** Move a thought whose extraction could not run into the state §8.1 gives it.
 *
 *  `review_transcript_only` exists precisely so that "we could not organize
 *  this" is a state a clinician can be shown, rather than a thought sitting in
 *  `processing` forever with a spinner on it. Leaving the status alone would
 *  make an interrupted run indistinguishable from one still going — and Phase
 *  1's definition of done is that an interrupted run never loses a completed
 *  transcript. */
async function markUnorganized(ctx: TenantContext, thoughtId: string, status: string): Promise<void> {
  if (status !== "processing") return;
  try {
    await transitionThought(ctx, thoughtId, "extraction_failed");
  } catch {
    // A transition that is not legal from the current state is not worth
    // failing the read path for; the caller is already returning "unavailable".
  }
}

export async function runExtraction(ctx: TenantContext, thoughtId: string): Promise<ExtractionResult> {
  const empty = { items: [], rejected: [], droppedCitations: 0 };

  const thought = await getThought(ctx, thoughtId);
  if (!thought) return { outcome: "unavailable", reason: "No such thought.", source: null, ...empty };

  const transcript = await currentTranscript(ctx, thought);
  if (!transcript) {
    return { outcome: "unavailable", reason: "This thought has no transcript yet.", source: null, ...empty };
  }

  // --- Get a payload. ------------------------------------------------------
  let raw: unknown = null;
  let source: "fixture" | "gateway" | null = null;
  let inferenceId: string | null = null;

  const fixture =
    process.env.EMDR_DEMO === "1" ? fixtureExtraction(transcript.id, transcript.text) : null;
  if (fixture) {
    raw = fixture;
    source = "fixture";
    // Deliberately NOT an inference id. The fixture is not an inference, and
    // recording one would put a fabricated entry in the ledger that an audit
    // reader would take for a model call that happened.
    inferenceId = null;
  } else {
    const result = await invoke({
      task: THOUGHT_EXTRACT.id,
      scope: {
        tenantId: ctx.tenantId,
        personId: thought.personId,
        purpose: "clinician_thought_extraction",
        actorId: ctx.personId ?? null,
      },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `transcriptId: ${transcript.id}\n\n` +
            `Transcript:\n${transcript.text}\n\n` +
            `Return a ThoughtExtractionV1 JSON object with schemaVersion "1" and this transcriptId.`,
        },
      ],
    });
    if (result.outcome !== "answered") {
      // The task's fallback is "refuse", and this is what refusing looks like
      // from the caller's side: the transcript is untouched and says so.
      await markUnorganized(ctx, thoughtId, thought.status);
      return {
        outcome: "unavailable",
        reason: result.reason || "The extraction service did not answer.",
        source: null,
        ...empty,
      };
    }
    source = "gateway";
    inferenceId = result.inferenceId;
    try {
      raw = JSON.parse(extractJsonObject(result.text));
    } catch {
      await markUnorganized(ctx, thoughtId, thought.status);
      return {
        outcome: "unavailable",
        reason: "The extraction service returned something that was not JSON.",
        source: null,
        ...empty,
      };
    }
  }

  // --- Validate against the transcript it claims to describe. --------------
  const validated = validateExtraction(raw, transcript.id, transcript.text);

  if (validated.items.length === 0) {
    // A payload whose every item was refused is not an empty transcript. Saying
    // "nothing found" there would report the extractor's failure as the
    // clinician's silence.
    if (validated.rejected.length > 0) {
      await markUnorganized(ctx, thoughtId, thought.status);
      return {
        outcome: "unavailable",
        reason: "The extraction did not meet the contract.",
        items: [],
        rejected: validated.rejected,
        droppedCitations: validated.droppedCitations,
        source,
      };
    }
    return {
      outcome: "nothing_found",
      reason: "",
      items: [],
      rejected: [],
      droppedCitations: validated.droppedCitations,
      source,
    };
  }

  // --- Write candidates. ---------------------------------------------------
  await clearCandidates(ctx, thoughtId);
  const items = await createCandidates(ctx, {
    personId: thought.personId,
    thoughtId,
    transcriptId: transcript.id,
    items: validated.items,
  });

  await recordExtractionCompleted({
    thoughtId,
    transcriptId: transcript.id,
    tenantId: ctx.tenantId,
    personId: thought.personId,
    itemIds: items.map((i) => i.id),
    taskVersion: source === "fixture" ? FIXTURE_EXTRACTION_MODEL : THOUGHT_EXTRACT.version,
    aiInferenceId: inferenceId,
  });

  if (thought.status === "processing") {
    await transitionThought(ctx, thoughtId, "extraction_ready");
  }

  return {
    outcome: "organized",
    reason: "",
    items,
    rejected: validated.rejected,
    droppedCitations: validated.droppedCitations,
    source,
  };
}

/** Pull the JSON object out of a reply that may be fenced or prefaced.
 *
 *  Tolerant of the wrapper, strict about the content: this only finds the
 *  outermost braces, and everything inside still goes through the validator. */
function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return text;
  return text.slice(start, end + 1);
}
