// The attention-signal provider registry (expansion handoff 03 §10; Phase 1).
//
// §10's boundary is the point of the whole file:
//
//   "Providers are deterministic or rule-bound and versioned."
//   "A provider may emit review-worthiness, but only existing safety machinery
//    may create safety authority."
//   "Later providers plug into the registry without changing work-queue
//    semantics."
//
// The third is what a registry buys. Handoffs 04 and 05 add a Recovery
// Trajectory provider and a Therapeutic Load provider, and §21's Phase 6
// definition of done is that they "plug in without changing queue semantics or
// data contracts". That is only true if the queue never learns any provider's
// name — so it consumes candidates and this module is the only place the list
// of providers exists.
//
// A PROVIDER CANNOT CREATE SAFETY. There is no band in `AttentionBand` that
// means urgent-safety, and nothing here writes to `alerts`. The strongest thing
// a provider can say is `review_now`, which §2 requires be visibly distinct
// from a safety obligation: "non-safety review_now cannot masquerade as
// safety."
//
// A PROVIDER THAT THROWS DOES NOT TAKE THE QUEUE DOWN. §20: "one provider
// failed → keep other work. Surface partial coverage without exposing PHI in
// telemetry." So `evaluateAll` collects failures by provider ID and returns
// them beside the candidates — the surface says which part of the picture is
// missing rather than showing a quietly shorter list.

import type { TenantContext } from "../../repository";
import type { AttentionSignalCandidate } from "../attention-signals";

export interface AttentionProviderArgs {
  ctx: TenantContext;
  personId: string;
  /** Nothing recorded after this instant may be considered. The cross-feature
   *  invariant against future-data leakage, passed rather than assumed so a
   *  historical view is reconstructable. */
  evidenceCutoff: string;
}

export interface AttentionSignalProvider {
  id: string;
  /** Bumped whenever the rule changes. Recorded on every signal, so a clinician
   *  reading a row from last month can tell whether it was produced under the
   *  rules in force today. */
  version: string;
  /** One line for the audit reader and for the coverage note when this provider
   *  is unavailable. */
  purpose: string;
  evaluate(args: AttentionProviderArgs): Promise<AttentionSignalCandidate[]>;
}

const PROVIDERS = new Map<string, AttentionSignalProvider>();

export function registerProvider(p: AttentionSignalProvider): AttentionSignalProvider {
  const existing = PROVIDERS.get(p.id);
  if (existing && existing.version !== p.version) {
    throw new Error(
      `Attention provider ${p.id} is already registered at version ${existing.version}.`
    );
  }
  PROVIDERS.set(p.id, p);
  return p;
}

export function registeredProviders(): AttentionSignalProvider[] {
  return [...PROVIDERS.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function getProvider(id: string): AttentionSignalProvider | undefined {
  return PROVIDERS.get(id);
}

export interface ProviderCoverage {
  /** Providers that ran and returned. */
  ran: string[];
  /** Providers that threw, by id, with a short reason. NO PHI: §18 forbids
   *  patient text, goal names, thread names or clinical labels leaving in
   *  telemetry, and a failure message is exactly where one would slip out. */
  failed: Array<{ providerId: string; reason: string }>;
}

export interface EvaluationResult {
  candidates: Array<{ providerId: string; candidate: AttentionSignalCandidate }>;
  coverage: ProviderCoverage;
}

/**
 * Run every registered provider for one person.
 *
 * ONE FAILING PROVIDER IS PARTIAL COVERAGE, NOT AN OUTAGE. The alternative —
 * letting a throw propagate — means a bug in the newest, least-exercised
 * provider empties a clinician's queue, and an empty queue reads as "nothing to
 * do today". That is the worst possible failure mode for this surface, and it
 * is the one that looks most like success.
 */
export async function evaluateAll(args: AttentionProviderArgs): Promise<EvaluationResult> {
  const candidates: EvaluationResult["candidates"] = [];
  const coverage: ProviderCoverage = { ran: [], failed: [] };

  for (const provider of registeredProviders()) {
    try {
      const found = await provider.evaluate(args);
      coverage.ran.push(provider.id);
      for (const candidate of found) candidates.push({ providerId: provider.id, candidate });
    } catch (err) {
      coverage.failed.push({
        providerId: provider.id,
        // The constructor name, not the message. A message can contain a goal
        // title, a thread label or a patient's own words; the class of failure
        // is what a coverage note actually needs.
        reason: err instanceof Error ? err.constructor.name : "unknown",
      });
    }
  }
  return { candidates, coverage };
}
