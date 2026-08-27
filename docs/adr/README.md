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
| [0010](0010-event-sourced-longitudinal-spine.md) | Event-sourced longitudinal spine; current tables become projections | **Proposed** |
| [0011](0011-tenancy-and-person-account-separation.md) | Tenancy from day one; person identity separate from account | **Proposed** |
| [0012](0012-ai-gateway.md) | All model calls route through a Steady AI Gateway | **Proposed** |

## Handoff A prerequisites

ADRs 0010, 0011, and 0012 are the architectural decisions the A→E governing rule requires
**before** Handoff A code lands ("no phase may make a local implementation choice that
blocks a downstream requirement without a written ADR"). They are not independent:

- **0010 (event spine)** and **0011 (tenancy + person/account)** rewrite the same 29
  tables and should ship as **one migration** — doing them separately pays the cost twice.
- **0012 (AI Gateway)** consumes both: it needs 0010 for provenance records and 0011 for
  purpose-scoped, tenant-aware retrieval.

Cost of delay is highest for 0011 — a tenancy retrofit after enterprise data exists is
both expensive and a cross-tenant PHI risk.

See [`../docs-triage.md`](../docs-triage.md) for the full documentation status.
