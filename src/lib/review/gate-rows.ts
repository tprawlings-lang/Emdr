// The release gates, resolved once (17 September handoff, P5).
//
// TWO SCREENS NOW ASK THE SAME QUESTION. The release screen has always built
// its rows inline: resolve the evidence, fingerprint each gate's facts, find
// the decision in force at that fingerprint, and fall back to the last decision
// recorded against an older one. The reviewer's landing page needs exactly that
// to answer "what blocks release" — and a second copy of a forty-line loader is
// two answers to one question, which on a release console is the failure the
// whole console exists to prevent.
//
// So it lives here, and both read it.

import { getDb } from "../db";
import {
  RELEASE_GATES, resolveEvidence, fingerprint, type ResolveOptions,
} from "./gates";
import { decisionsAt, decisionHistory, type ReviewDecision } from "./decisions";
import type { GateRow } from "./release-readiness";

export interface ResolvedGate {
  row: GateRow;
  /** The fingerprint the decision, if any, is in force at. */
  fingerprint: string;
  summary: string;
  href?: string;
}

/**
 * Every gate with its evidence and the decision standing against it.
 *
 * A DECISION IS IN FORCE ONLY AT THE CURRENT FINGERPRINT. One recorded against
 * an earlier evidence state comes back as `superseded` rather than being
 * silently absent: "nobody has reviewed this" and "somebody reviewed this and
 * then the evidence moved" are different situations, and only one of them is
 * anybody's fault.
 */
export async function resolvedGates(opts: ResolveOptions = {}): Promise<ResolvedGate[]> {
  const evidence = resolveEvidence(getDb(), opts);
  return Promise.all(
    RELEASE_GATES.map(async (gate) => {
      const ev = evidence.get(gate.id)!;
      const fp = fingerprint(ev.facts);
      const atCurrent = await decisionsAt("release_gate", fp);
      const inForce = atCurrent.get(gate.id) ?? null;
      let superseded: ReviewDecision | null = null;
      if (!inForce) {
        const history = await decisionHistory("release_gate", gate.id);
        superseded = history.length ? history[history.length - 1] : null;
      }
      return {
        row: {
          gateId: gate.id,
          name: gate.name,
          status: ev.status,
          evidenceClass: gate.evidenceClass,
          inForce,
          superseded,
        },
        fingerprint: fp,
        summary: ev.summary,
        href: ev.href,
      };
    })
  );
}
