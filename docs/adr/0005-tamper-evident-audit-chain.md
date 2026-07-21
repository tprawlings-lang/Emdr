# 0005 — Tamper-evident audit log via hash chain

**Status:** Accepted

## Context
The audit log was append-only by convention (INSERT-only) but not
tamper-evident: a row edit or deletion by anyone with DB access was undetectable.

## Decision
Hash-chain every row (`src/lib/audit.ts`): `entry_hash = sha256(prev_hash +
canonical(row))`. `verifyAuditChain()` recomputes the chain and reports the
first broken link. Covered by `tests/audit-chain.test.ts` (edit and delete both
detected).

## Consequences
- Retroactive tampering is now detectable, not prevented — pair with periodic
  off-box export of `entry_hash` checkpoints for stronger non-repudiation
  (future work).
- Chain assumes a single writer (see ADR 0004); concurrent writers would need a
  serialized append.
