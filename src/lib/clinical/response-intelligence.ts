// The model's role in the response fingerprint (expansion handoff 02 §8,
// Phase 4).
//
// Phase 4's definition of done is one sentence: "AI cannot change statistics or
// causal semantics." Everything in this file is arranged so that sentence is
// true of the CODE rather than of the prompt.
//
// THE PROMPT IS A REQUEST; THE GUARD IS THE RULE. Asking a model not to invent
// a number works most of the time, and most of the time is not a property. So
// the summariser is handed an already-computed summary, its output is checked
// against the numbers that summary actually contains, and anything that fails
// is discarded in favour of the deterministic sentence — which is what ships
// today, because no provider is configured in this deployment.
//
// THREE THINGS THE OUTPUT IS CHECKED FOR, from §8's "not allowed" column:
//
//   RECALCULATED STATISTICS. Every number in the returned text must be one the
//   summary already carries. A model that rounds -3.5 to -4, or helpfully
//   averages two windows, produces a number nobody can trace to evidence — and
//   §13 requires every summary to be reproducible from evidence plus policy
//   version.
//
//   INVENTED CAUSATION. §6 bars "works", "effective treatment", "caused
//   improvement" and "contraindicated" without an independent
//   clinician-authored judgement, and the surrounding causal vocabulary goes
//   with them. A sentence that says grounding "helped" has made the claim the
//   whole feature is built to withhold.
//
//   SUPPRESSED ADVERSE OBSERVATIONS. If the summary carries a recovery-burden
//   or adverse count, the wording must still carry it. A concise summary that
//   quietly drops the difficult half is the most plausible failure here,
//   because dropping it is what makes a summary concise.
//
// AND THE NORMALIZER PROPOSES, ALWAYS. §8: the model may "map clinician wording
// to candidate canonical intervention" and may not "auto-create clinical
// intervention identity without review when ambiguous". `proposeNormalization`
// returns candidates and writes nothing; `confirmInstance` and `remapInstance`
// in interventions.ts are the only paths that change an identity, and both take
// a clinician id.

import { invoke } from "../ai-gateway";
import { RESPONSE_SUMMARIZE_PATTERN } from "../ai-gateway/registry";
import type { TenantContext } from "../repository";
import { listDefinitions, normalizeCanonicalKey } from "./interventions";
import type { InterventionDefinition } from "./interventions";
import {
  fingerprintLine, type FingerprintSummary,
} from "./response-fingerprint";
import { PATTERN_STATE_LABEL } from "./response-fingerprint-policy";

// ---------------------------------------------------------------------------
// The forbidden vocabulary (§6)
// ---------------------------------------------------------------------------

/** Words that turn an observation into a claim about the intervention. Checked
 *  against model output, and checked in the tests against every deterministic
 *  string this feature renders — one list, both jobs, so the two can never
 *  drift into permitting different things. */
export const CAUSAL_VOCABULARY = [
  "works", "worked", "working",
  "effective", "effectiveness", "efficacy", "efficacious",
  "caused", "causes", "causing", "cause of",
  "because of", "thanks to", "due to", "led to", "resulted in",
  "contraindicated", "contraindication",
  "helped", "helping", "helps",
  "treats", "treatment for", "cure", "cured",
  "proves", "proven", "demonstrates that",
  "responds well to", "responder",
] as const;

/** Every causal word the text contains, lowercased. Empty means clean. */
export function causalWordsIn(text: string): string[] {
  const haystack = text.toLowerCase();
  return CAUSAL_VOCABULARY.filter((w) => haystack.includes(w));
}

/** Every number the text contains, as written. Used to check that a model
 *  reworded rather than recomputed. */
export function numbersIn(text: string): string[] {
  return (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));
}

/** The numbers a summary legitimately contains — the only ones its wording may
 *  use. Built from the summary object rather than from its rendered sentence,
 *  so a reworded version cannot smuggle in a figure by being phrased
 *  differently. */
export function permittedNumbers(summary: FingerprintSummary): Set<string> {
  const out = new Set<string>();
  // BOTH THE SIGNED VALUE AND ITS MAGNITUDE. "-4" and "fell by 4 points" are
  // the same fact, and English carries the sign in the verb. A guard that
  // rejected the second would reject every honest rewording — and a guard that
  // always rejects is a guard nobody notices has stopped catching anything.
  const add = (n: number | null | undefined) => {
    if (n === null || n === undefined || !Number.isFinite(n)) return;
    out.add(String(n));
    out.add(String(Math.abs(n)));
  };
  add(summary.supportCount);
  add(summary.missingFollowupCount);
  add(summary.mixedCount);
  add(summary.recoveryBurdenCount);
  for (const w of summary.windows) {
    add(w.observedOn);
    add(w.medianChange);
    add(w.range?.min);
    add(w.range?.max);
    add(w.iqr?.q1);
    add(w.iqr?.q3);
    add(w.towardSettled);
    add(w.awayFromSettled);
    add(w.unchanged);
  }
  for (const st of summary.strata) {
    add(st.supportCount);
    add(st.medianChange);
    add(st.range?.min);
    add(st.range?.max);
  }
  // Numbers that appear inside the limitation sentences the projection already
  // wrote — the thresholds, mostly. They are the projection's own words.
  for (const l of summary.limitations) for (const n of numbersIn(l)) out.add(n);
  return out;
}

export interface WordingResult {
  text: string;
  /** Where the sentence came from. The surface says so, because §11 of the
   *  Thoughts spec and §9 here both require a reader to be able to tell a
   *  machine-composed line from an assembled one. */
  origin: "deterministic" | "model";
  /** Empty when the model's answer was used. Otherwise why it was not. */
  rejectedFor: string;
}

const SUMMARY_SYSTEM = [
  "You reword a response summary that has already been computed. You are not analysing anything.",
  "",
  "Hard rules:",
  "- Use only the numbers given to you. Do not compute, round, combine or infer any number.",
  "- Never say an intervention worked, helped, was effective, caused anything, or is contraindicated.",
  "  The summary describes what was observed after exposures. It is not a claim about cause.",
  "- If the summary mentions difficulty, delayed burden, adverse observations or missing follow-up,",
  "  your wording must still mention them. Never drop the difficult half to be concise.",
  "- Keep the support count in the sentence. A description without its denominator is a conclusion.",
  "- Two sentences at most. Plain clinical English.",
  "",
  "Return the sentences only, with no preamble and no JSON.",
].join("\n");

/**
 * Word a pattern the projection already computed.
 *
 * THE DETERMINISTIC SENTENCE IS THE ANSWER UNLESS THE MODEL'S SURVIVES EVERY
 * CHECK. Not "unless the model fails" — unless it passes. The difference
 * matters: a model that returns something plausible but unverifiable loses, and
 * the caller is never in a position to render an unchecked sentence, because
 * this function returns text and not an outcome to interpret.
 */
export async function summarizePattern(
  ctx: TenantContext, personId: string, summary: FingerprintSummary
): Promise<WordingResult> {
  const deterministic = fingerprintLine(summary);

  const result = await invoke({
    task: RESPONSE_SUMMARIZE_PATTERN.id,
    scope: {
      tenantId: ctx.tenantId, personId,
      purpose: "response_pattern_summary", actorId: ctx.personId ?? null,
    },
    system: SUMMARY_SYSTEM,
    messages: [{
      role: "user",
      content: [
        `Intervention: ${summary.definition.displayName}`,
        `State: ${PATTERN_STATE_LABEL[summary.patternState]}`,
        `Recorded exposures: ${summary.supportCount}`,
        `Exposures whose windows disagreed: ${summary.mixedCount}`,
        `Exposures with difficulty afterwards: ${summary.recoveryBurdenCount}`,
        `Exposures with a window nobody recorded: ${summary.missingFollowupCount}`,
        ...summary.windows.map(
          (w) =>
            `Window ${w.windowType}/${w.outcomeType}: observed on ${w.observedOn}` +
            (w.medianChange === null ? "" : `, median change ${w.medianChange}`) +
            `, ${w.towardSettled} toward settled, ${w.awayFromSettled} away`
        ),
        ...summary.limitations.map((l) => `Limitation: ${l}`),
        "",
        "Reword this as at most two sentences.",
      ].join("\n"),
    }],
  });

  if (result.outcome !== "answered" || !result.text.trim()) {
    return { text: deterministic, origin: "deterministic", rejectedFor: result.reason || "no answer" };
  }

  const text = result.text.trim();
  const check = checkWording(text, summary);
  if (check) {
    return { text: deterministic, origin: "deterministic", rejectedFor: check };
  }
  return { text, origin: "model", rejectedFor: "" };
}

/**
 * §8's three refusals, as a function.
 *
 * Exported and pure so the tests can drive it directly with the sentences a
 * model would plausibly return — which is the only way to know the guard
 * catches them, since no provider is configured here and a test that had to
 * reach one would not run.
 *
 * Returns the reason to reject, or null when the wording is usable.
 */
export function checkWording(text: string, summary: FingerprintSummary): string | null {
  const causal = causalWordsIn(text);
  if (causal.length > 0) return `causal language: ${causal.join(", ")}`;

  const permitted = permittedNumbers(summary);
  const invented = numbersIn(text).filter((n) => !permitted.has(n));
  if (invented.length > 0) return `numbers not in the summary: ${invented.join(", ")}`;

  // The support count is the denominator. A sentence without it is a conclusion
  // that has lost its evidence, however carefully it is worded.
  if (!numbersIn(text).includes(String(summary.supportCount))) {
    return "the support count is missing";
  }

  // The difficult half must survive, and BOTH the number and a word for what it
  // counts are required. The number alone is not enough: a summary whose median
  // is -4 and whose missing-follow-up count is 4 would pass a numeric-only
  // check on a sentence that mentions only the median. The word alone is not
  // enough either — "some difficulty" and "3 exposures with difficulty" are
  // different claims and only one of them is the summary's.
  //
  // A faithful rewording that reaches for a synonym outside these lexicons is
  // rejected and the deterministic sentence ships instead. That is the safe
  // direction and it costs a plainer sentence, which is the trade §8's
  // deterministic fallback exists to make.
  const missing = (count: number, lexicon: string[], label: string): string | null => {
    if (count === 0) return null;
    const hasNumber = numbersIn(text).includes(String(count));
    const hasWord = lexicon.some((w) => text.toLowerCase().includes(w));
    return hasNumber && hasWord ? null : label;
  };

  return (
    missing(
      summary.recoveryBurdenCount,
      ["difficult", "difficulty", "afterwards", "after the", "adverse", "hard night", "burden"],
      "the adverse count was dropped"
    ) ??
    missing(
      summary.mixedCount,
      ["mixed", "disagree", "both directions", "did not agree"],
      "the mixed count was dropped"
    ) ??
    missing(
      summary.missingFollowupCount,
      ["missing", "not recorded", "nobody recorded", "no follow", "unknown", "not followed"],
      "the missing-follow-up count was dropped"
    )
  );
}

// ---------------------------------------------------------------------------
// Normalization candidates (§8)
// ---------------------------------------------------------------------------

export interface NormalizationCandidate {
  definitionId: string;
  canonicalKey: string;
  displayName: string;
  /** Why this is a candidate, in words a clinician can judge. Never a score
   *  with no explanation — a number a person cannot check is a number they
   *  either trust blindly or ignore. */
  reason: string;
}

/**
 * Which existing interventions a clinician's wording might mean.
 *
 * DETERMINISTIC TODAY, and it stays a proposal either way. The exact-key match
 * is the strong candidate; a shared token is a weak one. It never merges: two
 * definitions that mean the same thing are a clinician's to reconcile, and a
 * wrong merge is evidence nobody can pull apart again.
 *
 * The gateway task (`response.normalize_intervention`) exists and is registered
 * with a deterministic fallback; this function IS that fallback, and it is what
 * runs today. It is not imported from the registry here because nothing in this
 * path invokes it — a registry import that only documented an intention would
 * be an unused symbol claiming a call that does not happen.
 */
export async function proposeNormalization(
  ctx: TenantContext, wording: string
): Promise<NormalizationCandidate[]> {
  const key = normalizeCanonicalKey(wording);
  const tokens = new Set(key.split("_").filter((t) => t.length > 2));
  const definitions = await listDefinitions(ctx);

  const scored: Array<{ d: InterventionDefinition; rank: number; reason: string }> = [];
  for (const d of definitions) {
    if (d.canonicalKey === key) {
      scored.push({ d, rank: 0, reason: "the same wording is already recorded" });
      continue;
    }
    const theirs = new Set(d.canonicalKey.split(/[._]/).filter((t) => t.length > 2));
    const shared = [...tokens].filter((t) => theirs.has(t));
    if (shared.length > 0) {
      scored.push({
        d, rank: 1,
        reason: `shares "${shared.join(", ")}" with an intervention already recorded`,
      });
    }
  }
  scored.sort((a, b) => a.rank - b.rank || a.d.displayName.localeCompare(b.d.displayName));
  return scored.slice(0, 5).map(({ d, reason }) => ({
    definitionId: d.id,
    canonicalKey: d.canonicalKey,
    displayName: d.displayName,
    reason,
  }));
}
