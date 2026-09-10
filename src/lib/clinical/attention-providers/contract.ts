// The published provider contract (expansion handoff 03 §10, Phase 6).
//
// Phase 6's definition of done is one sentence: "Handoffs 04 and 05 plug in
// without changing queue semantics or data contracts."
//
// That is a promise made to code that does not exist yet, which is the hardest
// kind to keep — the Recovery Trajectory provider and the Therapeutic Load
// provider will be written by someone reading §10 and this file, and the first
// thing they will want to do is the thing §10 forbids. So the contract is
// written down HERE, next to the registry, and `conforms()` below is the
// executable half: a check any provider can be run through, which the test
// suite runs against every registered provider so a new one cannot ship
// breaking a rule the old ones keep.
//
// SIX RULES, AND THE THREE THAT MATTER MOST ARE ABOUT WHAT A PROVIDER MAY NOT
// DO.
//
//   IT MAY NOT CREATE SAFETY AUTHORITY. §10: "a provider may emit
//   review-worthiness, but only existing safety machinery may create safety
//   authority." The band vocabulary has no safety state in it, and the queue
//   sets `safetyAuthority: false` on every signal-derived row — so the rule is
//   already structural. What `conforms()` adds is the check that a provider is
//   not trying to smuggle urgency through its WORDING, which is the one route
//   left open.
//
//   IT MAY NOT DECIDE ORDER. §11: "model output does not sort the queue", and
//   neither does a provider: candidates carry a band and nothing else that the
//   queue reads for position. A provider that returned a rank would find the
//   field does not exist.
//
//   IT MAY NOT LOOK PAST THE CUTOFF. Every evaluation is given an
//   `evidenceCutoff` and a candidate's `evidenceAt` must not exceed it — the
//   cross-feature invariant against future-data leakage, checkable from
//   outside because the cutoff is an argument rather than a clock read inside.
//
// AND THE THREE ABOUT WHAT IT MUST DO: be versioned, be deterministic over the
// same inputs, and cite evidence for anything it asserts.

import type { AttentionSignalCandidate } from "../attention-vocabulary";
import { ATTENTION_BANDS } from "../attention-vocabulary";
import type { AttentionSignalProvider, AttentionProviderArgs } from "./registry";

/** The contract's own version. A provider written against it records which
 *  revision it was built for, so a later change to these rules is a change
 *  somebody can date. */
export const PROVIDER_CONTRACT_VERSION = "attention-provider-contract.1.0.0";

/**
 * Words that would make a candidate's statement do a provider's forbidden work.
 *
 * A provider cannot set a band it is not allowed to set — the type prevents it.
 * What it CAN do is write "urgent: this person needs contact today" into the
 * statement and let the sentence carry the authority the band would not. That
 * is the same failure §2 names for the UI ("non-safety review_now cannot
 * masquerade as safety"), arriving one layer earlier.
 */
const AUTHORITY_WORDS = [
  "urgent", "emergency", "crisis", "immediately", "right now", "safety risk",
  "at risk of harm", "must contact", "escalate", "escalation", "critical",
  "high priority", "top priority", "unsafe",
];

/** Words that make a statement a treatment instruction rather than an
 *  observation. §10's providers describe what was observed; deciding what to do
 *  about it is the clinician's, and §16 keeps even the model out of it. */
const DIRECTIVE_WORDS = [
  "you should", "you must", "recommend", "advise", "prescrib", "diagnos",
  "increase the", "reduce the", "discontinue",
  // "Consider X" is a recommendation wearing a hedge, and "treatment for" is a
  // clinical decision named as one. Both were caught by a test case the first
  // list let through — "consider starting treatment for insomnia" is exactly
  // the sentence §10 keeps out of a provider.
  "consider ", "treatment for", "start treatment",
];

export interface ConformanceIssue {
  rule: string;
  detail: string;
}

/**
 * Check one provider's declaration and its output against the contract.
 *
 * PURE OVER A RESULT, so a test can run it against every registered provider
 * without knowing what any of them do. It returns issues rather than throwing:
 * a provider that breaks a rule should fail a build with a list, not stop at
 * the first problem.
 */
export function conforms(
  provider: Pick<AttentionSignalProvider, "id" | "version" | "purpose">,
  candidates: AttentionSignalCandidate[],
  args: Pick<AttentionProviderArgs, "evidenceCutoff">
): ConformanceIssue[] {
  const issues: ConformanceIssue[] = [];

  if (!provider.id.trim()) issues.push({ rule: "identified", detail: "a provider needs an id" });
  if (!/^\d+\.\d+\.\d+$/.test(provider.version)) {
    issues.push({
      rule: "versioned",
      detail: `${provider.id} has version "${provider.version}"; §10 requires providers be versioned so a signal from last month can be attributed`,
    });
  }
  if (!provider.purpose.trim()) {
    issues.push({ rule: "explainable", detail: `${provider.id} has no purpose line` });
  }

  for (const c of candidates) {
    const where = `${provider.id} → ${c.dedupeKey}`;

    if (!(ATTENTION_BANDS as readonly string[]).includes(c.band)) {
      issues.push({ rule: "band_vocabulary", detail: `${where} used band "${c.band}"` });
    }
    if (!c.dedupeKey.trim()) {
      issues.push({
        rule: "one_lineage",
        detail: `${where} has no dedupe key; §12 needs one lineage per concern`,
      });
    }
    if (!c.statement.trim()) {
      issues.push({
        rule: "explainable",
        detail: `${where} has no statement; §4 forbids "an unexplained score"`,
      });
    }
    if (!c.policyVersion.trim()) {
      issues.push({
        rule: "versioned",
        detail: `${where} carries no policy version`,
      });
    }

    // Future-data leakage. The cutoff is an ARGUMENT, which is what makes this
    // checkable from outside — a provider that read a clock internally could
    // not be tested for it.
    if (c.evidenceAt > args.evidenceCutoff) {
      issues.push({
        rule: "no_future_evidence",
        detail: `${where} cited evidence from ${c.evidenceAt}, after the cutoff ${args.evidenceCutoff}`,
      });
    }

    const statement = c.statement.toLowerCase();
    const authority = AUTHORITY_WORDS.filter((w) => statement.includes(w));
    if (authority.length > 0) {
      issues.push({
        rule: "no_safety_authority",
        detail: `${where} used ${authority.join(", ")} — only the safety engine creates safety authority`,
      });
    }
    const directive = DIRECTIVE_WORDS.filter((w) => statement.includes(w));
    if (directive.length > 0) {
      issues.push({
        rule: "no_treatment_direction",
        detail: `${where} used ${directive.join(", ")} — a provider describes; the clinician decides`,
      });
    }

    // A candidate that asserts something about a person and cites nothing is
    // an assertion, and §4's "never an unexplained score" applies to the
    // provider layer as much as to the row. The exception is a signal whose
    // whole content IS an absence — those say so in their limitations, which
    // is why the check is on "evidence or a stated limitation" rather than on
    // evidence alone.
    if (c.evidenceIds.length === 0 && c.limitations.length === 0) {
      issues.push({
        rule: "cites_or_qualifies",
        detail: `${where} cites no evidence and states no limitation`,
      });
    }
  }

  return issues;
}

/**
 * Run a provider twice over the same inputs and check it said the same thing.
 *
 * §10: "providers are deterministic or rule-bound and versioned." A provider
 * that returned different candidates for identical inputs would make the queue
 * shuffle between page loads, and a queue that shuffles is one where "the third
 * row" stops being a thing a clinician can say to a colleague.
 */
export async function isDeterministic(
  provider: AttentionSignalProvider, args: AttentionProviderArgs
): Promise<boolean> {
  const a = await provider.evaluate(args);
  const b = await provider.evaluate(args);
  const key = (list: AttentionSignalCandidate[]) =>
    JSON.stringify(
      [...list]
        .sort((x, y) => x.dedupeKey.localeCompare(y.dedupeKey))
        .map((c) => [c.dedupeKey, c.band, c.statement, c.evidenceAt, [...c.evidenceIds].sort()])
    );
  return key(a) === key(b);
}
