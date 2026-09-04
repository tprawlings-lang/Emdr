// The three model tasks for Return-to-Life goals (handoff 01 §7, Phase 3).
//
// Phase 3's definition of done is two lines:
//
//   No model candidate changes a level automatically.
//   Every summary statement cites observation IDs.
//
// The first is already structural — `recordObservation` writes model_candidate
// as proposed and the fold reads only accepted — so nothing in this module can
// break it however it is called. That is the point of having put it there
// rather than here.
//
// The second is enforced the same way Session Prep enforces its own: by
// validating the OUTPUT against the accepted observations, rather than by
// asking the model to cite and hoping. A summary sentence with no resolvable
// observation behind it is dropped, and the drop is reported.
//
// THE LADDER DRAFTER REFUSES RATHER THAN FALLING BACK, and it is the only task
// in this codebase that does. There is no deterministic way to write five
// observable rungs for "I want to be able to drive on the freeway again", and
// a template that produced "Cannot do X / Partly does X / Does X" would be a
// ladder nobody could recognise themselves in — §3 asks for levels "a person
// can report or a clinician can recognise". A drafter with nothing to say says
// nothing, and the manual path (Phase 1) is complete without it.

import { invoke } from "../ai-gateway";
// GOAL_MATCH_EVIDENCE is registered but not imported here: the matcher below is
// deterministic and does not invoke it, for the reasons in `matchEvidence`. The
// registry entry exists so a deployment with an embedding index has the
// contract and the task's identity is versioned from the start.
import { GOAL_DRAFT_LADDER } from "../ai-gateway/registry";
import { GOAL_LEVELS, type GoalLadderRung, type GoalLevel, type GoalObservation, type Goal } from "./return-to-life";
import { lexicalMatch, RETRIEVAL_POLICY_VERSION } from "./retrieval-policy";
import type { TenantContext } from "../repository";

// ---------------------------------------------------------------------------
// Ladder drafting
// ---------------------------------------------------------------------------

export interface LadderDraft {
  ok: boolean;
  rungs: GoalLadderRung[];
  /** Why there is no draft. Empty on success. */
  reason: string;
  /** Always true for a draft. §12: model-drafted language is not patient-owned
   *  until confirmed, and the flag travels so a surface cannot forget. */
  modelDrafted: true;
  /** The machine reason, for a log. Never rendered to a person: `reason` is
   *  what they read. */
  detail?: string;
}

const LADDER_SYSTEM = [
  "You turn a person's own statement of a life goal into five observable levels.",
  "",
  "Rules:",
  "- The five levels are -2, -1, 0, 1, 2. Level 0 is the meaningful target the person named.",
  "- Level -2 describes where someone might currently be. It is DESCRIPTIVE, never a judgement, and never worded as failure.",
  "- Every level describes something a person could report or a clinician could recognise. No internal states, no scores.",
  "- One dimension only. Do not combine separate goals into one ladder.",
  "- Use the person's own vocabulary where they gave you one.",
  "- Do not decide what the goal is. You are wording levels for the goal they stated.",
  "",
  "Return only a JSON object: {\"levels\":[{\"level\":-2,\"description\":\"...\"}, ...]} with all five levels.",
].join("\n");

/**
 * Propose five rungs for a stated goal.
 *
 * The statement is the INPUT and is never rewritten — §1: AI "can help draft
 * measurable wording but cannot choose what matters to the patient". What comes
 * back is a draft of the ladder only.
 */
export async function draftLadder(
  ctx: TenantContext,
  args: { personId: string; title: string; patientStatement: string; domain: string }
): Promise<LadderDraft> {
  const result = await invoke({
    task: GOAL_DRAFT_LADDER.id,
    scope: {
      tenantId: ctx.tenantId, personId: args.personId,
      purpose: "return_goal_ladder_draft", actorId: ctx.personId ?? null,
    },
    system: LADDER_SYSTEM,
    messages: [{
      role: "user",
      content:
        `Goal title: ${args.title}\n` +
        `Domain: ${args.domain}\n` +
        `In their words: ${args.patientStatement}\n\n` +
        "Return the five levels.",
    }],
  });

  if (result.outcome !== "answered") {
    return {
      ok: false, rungs: [], modelDrafted: true,
      // OUR words, not the gateway's. Its reason is "no provider configured",
      // which is true, is the right thing in a log, and tells the person in
      // front of the screen nothing they can act on. A refusal that does not
      // say what to do instead is a dead end.
      reason: "Steady could not draft the levels. You can write the five yourself — that is the ordinary path, not a fallback.",
      detail: result.reason,
    };
  }
  const rungs = parseLadder(result.text);
  if (!rungs) {
    return {
      ok: false, rungs: [], modelDrafted: true,
      reason: "The draft did not come back as five usable levels. You can write them yourself.",
      detail: "ladder parse failed",
    };
  }
  return { ok: true, rungs, reason: "", modelDrafted: true };
}

/** Parse and validate a ladder draft. Returns null unless all five levels are
 *  present with non-empty descriptions — a partial ladder is not a draft a
 *  person can correct, it is one they have to finish while believing it was
 *  drafted. */
export function parseLadder(text: string): GoalLadderRung[] | null {
  let parsed: unknown;
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const levels = (parsed as { levels?: unknown }).levels;
  if (!Array.isArray(levels)) return null;

  const byLevel = new Map<number, string>();
  for (const raw of levels) {
    if (!raw || typeof raw !== "object") continue;
    const l = (raw as { level?: unknown }).level;
    const d = (raw as { description?: unknown }).description;
    if (typeof l !== "number" || typeof d !== "string" || !d.trim()) continue;
    if (!(GOAL_LEVELS as readonly number[]).includes(l)) continue;
    byLevel.set(l, d.trim());
  }
  if (byLevel.size !== GOAL_LEVELS.length) return null;
  return GOAL_LEVELS.map((level) => ({ level, description: byLevel.get(level)! }));
}

// ---------------------------------------------------------------------------
// Evidence matching
// ---------------------------------------------------------------------------

export interface EvidenceCandidate {
  sourceType: string;
  sourceId: string;
  text: string;
  score: number;
  /** Why this was offered, in a sentence a clinician can disagree with. */
  because: string;
}

/** Below this, a candidate is not worth proposing. Same reasoning as thread
 *  matching: offering weak links because the page has room is how a review
 *  queue teaches people to click through it. */
export const GOAL_MATCH_THRESHOLD = 0.3;

/**
 * Which authorized records might relate to a goal.
 *
 * DETERMINISTIC, like thread matching and for the same reasons: there is no
 * embedding index here, the lexical and structured signals are computable
 * exactly, and a model call would put a model's name on a number a function
 * computes. §7's task is registered for a deployment that has the index.
 *
 * It returns CANDIDATES. Nothing here writes an observation — the caller does,
 * through `proposeModelEvidence`, which writes proposed. Splitting it that way
 * means this function cannot be the thing that accidentally accepts one.
 */
export function matchEvidence(
  goal: Goal,
  ladder: GoalLadderRung[],
  sources: Array<{ sourceType: string; sourceId: string; text: string }>
): EvidenceCandidate[] {
  // The goal's own language, plus the ladder's — a person's word for the thing
  // ("the big Tesco") is as likely to appear in a note as the title is.
  const goalText = [goal.title, goal.patientStatement, ...ladder.map((r) => r.description)].join(" ");

  const scored = sources.map((s) => {
    const score = lexicalMatch(goalText, s.text);
    return {
      ...s,
      score,
      because: `Its wording overlaps this goal's — “${goal.title}”.`,
    };
  });

  return scored
    .filter((c) => c.score >= GOAL_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Progress summary
// ---------------------------------------------------------------------------

export interface ProgressStatement {
  text: string;
  /** Accepted observation ids. §7: "every statement cites accepted observation
   *  IDs." Empty is invalid. */
  observationIds: string[];
}

export interface ProgressSummary {
  statements: ProgressStatement[];
  /** Statements produced and refused, with the reason. Reported rather than
   *  swallowed — a summary that quietly drops a sentence looks identical to one
   *  that never made it. */
  omitted: { text: string; reason: string }[];
  policyVersion: string;
}

/**
 * Validate progress statements against accepted observations.
 *
 * Separate from producing them, and given the ACCEPTED set rather than a way to
 * look observations up. Two consequences, both intended: a statement citing a
 * proposed observation is refused, so a model candidate cannot reach a summary
 * before a person has accepted it; and no caller can widen the evidence by
 * passing a different loader.
 */
export function validateProgress(
  statements: ProgressStatement[], accepted: GoalObservation[]
): ProgressSummary {
  const known = new Set(
    accepted.filter((o) => o.status === "accepted").map((o) => o.id)
  );
  const kept: ProgressStatement[] = [];
  const omitted: { text: string; reason: string }[] = [];

  for (const s of statements) {
    if (s.observationIds.length === 0) {
      omitted.push({ text: s.text, reason: "no observation cited — §7 requires every statement to cite one" });
      continue;
    }
    const unresolved = s.observationIds.filter((id) => !known.has(id));
    if (unresolved.length > 0) {
      omitted.push({
        text: s.text,
        reason: `cites ${unresolved.length} observation(s) that are not accepted evidence for this goal`,
      });
      continue;
    }
    kept.push(s);
  }
  return { statements: kept, omitted, policyVersion: RETRIEVAL_POLICY_VERSION };
}

/**
 * The deterministic progress summary — what ships today.
 *
 * Says only what accepted observations establish, and cites each one. §1's
 * "achievement is not cure" is why there is no sentence here about improvement,
 * recovery, or what the change means: a function changed, and that is the whole
 * claim.
 */
export function summarizeProgress(
  goal: Goal, ladder: GoalLadderRung[], observations: GoalObservation[]
): ProgressSummary {
  const accepted = observations
    .filter((o) => o.status === "accepted" && o.observedLevel !== null)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  if (accepted.length === 0) {
    return { statements: [], omitted: [], policyVersion: RETRIEVAL_POLICY_VERSION };
  }

  const describe = (l: GoalLevel | null) =>
    l === null ? "not recorded" : ladder.find((r) => r.level === l)?.description ?? "not described";

  const first = accepted[0];
  const last = accepted[accepted.length - 1];
  const statements: ProgressStatement[] = [];

  statements.push({
    text: `First recorded: ${describe(first.observedLevel)}.`,
    observationIds: [first.id],
  });

  if (accepted.length > 1 && last.observedLevel !== first.observedLevel) {
    statements.push({
      // Direction, not judgement. "Improved" is a claim about the person;
      // "now records" is a claim about the record.
      text: `Now records: ${describe(last.observedLevel)}.`,
      observationIds: [first.id, last.id],
    });
  }

  const byClass = new Map<string, number>();
  for (const o of accepted) byClass.set(o.evidenceClass, (byClass.get(o.evidenceClass) ?? 0) + 1);
  if (byClass.size > 1) {
    // §1: the sources stay separate, including in a summary of them. A count
    // that merged patient report and clinician observation would be the one
    // place the distinction was lost.
    statements.push({
      text:
        `Evidence: ` +
        [...byClass].map(([c, n]) => `${n} ${c.replace(/_/g, " ")}`).join(", ") + ".",
      observationIds: accepted.map((o) => o.id),
    });
  }

  return validateProgress(statements, accepted);
}

export { RETRIEVAL_POLICY_VERSION };
