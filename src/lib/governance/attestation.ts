// Reading back the sign-off a reviewer already gave.
//
// `resolveEvidence` returned `unavailable` for all three attested gates
// unconditionally, with a summary saying the attestation was "recorded with a
// reference to the evidence". IT WAS. `signOffGate` requires a reviewer,
// computes the gate's fingerprint, REFUSES a sign-off made against a stale
// one, records the decision with its evidence reference, and audits it. The
// form has been on the release console the whole time. Nothing read it back.
//
// THE THIRD INSTANCE OF ONE DEFECT IN A WEEK, which is the reason to write it
// down rather than just fix it: `requestUnlock` and `decideUnlock` were built,
// tested and called by nothing; `assignWork` recorded an owner the queue never
// read, so the product answered "Recorded X as the owner" over a row that said
// Unassigned; and here a reviewer signs a gate and the gate goes on saying
// nobody has. Each was a write with no reader, each looked complete from the
// writing end, and none of them is visible in a diff of the module that is
// wrong — the missing half is somewhere else by definition.
//
// A FIRST ATTEMPT AT THIS BUILT A SECOND TABLE. `gate_attestations`, with an
// id, a fingerprint, an attester, an evidence reference and a date — every
// column of which `review_decisions` already had, including the fingerprint
// binding that makes a sign-off expire. Building a store for something that
// exists is the failure the work register was written to catch, so it was
// deleted rather than kept alongside.

import { decisionsAt, type ReviewDecision } from "../review/decisions";
import { fingerprint } from "../review/gates";
import { dependencyFacts } from "../review/release-readiness";

/** The three p99 gates a machine cannot check for itself. */
export const ATTESTED_GATES: readonly string[] = [
  "authorization", "accessibility", "analytics_integrity",
];

export type AttestationState =
  /** Signed off as approved, against what is true now. */
  | { status: "current"; decision: ReviewDecision; evidenceRef: string | null }
  /** A reviewer looked and did not approve. Distinct from unsigned, because
   *  "nobody has reviewed this" and "a reviewer blocked it" are opposite
   *  facts that would otherwise render identically. */
  | { status: "refused"; decision: ReviewDecision }
  /** Nobody has signed it against what is true now. Includes the case where an
   *  older sign-off exists against versions that have since moved — which
   *  `signOffGate` already refuses to create, so it can only arise by the
   *  versions moving afterwards, which is exactly when it should stop counting. */
  | { status: "unsigned" };

/** What this gate's sign-off is bound to, right now. */
export function currentFingerprint(gateId: string): string {
  return fingerprint(dependencyFacts(gateId));
}

export function isAttestedGate(gateId: string): boolean {
  return ATTESTED_GATES.includes(gateId);
}

function evidenceRefOf(d: ReviewDecision): string | null {
  const raw = d.evidence.evidenceRef;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/**
 * Every attested gate's state.
 *
 * KEYED ON THE CURRENT FINGERPRINT, which is what makes a sign-off expire
 * without anybody remembering to revoke it. `decisionsAt` selects decisions
 * made against one version, so a decision recorded against versions that have
 * since moved is simply not returned — and the per-gate fingerprint means a
 * decorative change to an unrelated version does not reopen an attestation
 * about keyboard and screen-reader paths.
 */
export async function allAttestations(): Promise<Map<string, AttestationState>> {
  const out = new Map<string, AttestationState>();
  for (const gateId of ATTESTED_GATES) {
    const at = await decisionsAt("release_gate", currentFingerprint(gateId));
    const d = at.get(gateId);
    if (!d) {
      out.set(gateId, { status: "unsigned" });
    } else if (d.decision === "approved") {
      out.set(gateId, { status: "current", decision: d, evidenceRef: evidenceRefOf(d) });
    } else {
      out.set(gateId, { status: "refused", decision: d });
    }
  }
  return out;
}

/** One gate, for a caller that wants only one. */
export async function attestationState(gateId: string): Promise<AttestationState> {
  if (!isAttestedGate(gateId)) return { status: "unsigned" };
  return (await allAttestations()).get(gateId) ?? { status: "unsigned" };
}
