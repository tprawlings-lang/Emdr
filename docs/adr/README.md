# Architecture Decision Records

Short records of the decisions that shape Steady. Each is immutable once
accepted; supersede rather than edit.

| # | Decision | Status |
|---|---|---|
| [0001](0001-wellness-lane-posture.md) | Launch in the wellness lane, not the medical/HIPAA lane | **Superseded by 0009** |
| [0002](0002-app-layer-field-encryption.md) | App-layer AES-256-GCM field encryption + fail-fast secrets | Accepted |
| [0003](0003-security-headers-and-csp.md) | Security headers & CSP (`'unsafe-inline'` now, nonce later) | **Superseded by 0008** |
| [0004](0004-single-instance-architecture.md) | Single-instance runtime; in-process scheduler & rate limiter | **Superseded by 0007, 0009** |
| [0005](0005-tamper-evident-audit-chain.md) | Tamper-evident audit log via hash chain | Accepted |
| [0006](0006-stateless-hmac-sessions.md) | Stateless HMAC sessions; revocation via account status | Accepted |
| [0007](0007-scaling-and-zero-downtime-deploys.md) | Sequenced path to zero-downtime deploys & horizontal scale | Accepted — start now |
| [0008](0008-nonce-based-csp.md) | Nonce-based CSP; drop `'unsafe-inline'` from scripts | Accepted |
| [0009](0009-clinical-lane-reclassification.md) | Reclassify to the clinical/PHI lane; environment tiers govern un-gating | **Proposed — counsel** |

## Pending — required before Handoff A code lands

Per the A→E governing rule ("no phase may make a local implementation choice that blocks
a downstream requirement without a written ADR"), these three are outstanding:

| # | Decision | Blocks |
|---|---|---|
| 0010 | Event-sourced longitudinal spine | Handoffs B, D, E — replay and point-in-time reconstruction |
| 0011 | Tenancy + person/account separation | Handoff C — population ingestion, tenant isolation |
| 0012 | AI Gateway; no direct provider calls | Handoff A7, B5 evaluation, D5 Learning Ledger |

See [`../docs-triage.md`](../docs-triage.md) for the full documentation status.

