# Architecture Decision Records

Short records of the decisions that shape Steady. Each is immutable once
accepted; supersede rather than edit.

**Reading the Status column.** "Accepted" means *the decision is settled* — it does **not**
mean the work is finished or the control is active. Where an ADR is accepted but only
partly executed, the Status column says so and the ADR's own header states exactly what is
and is not running. This distinction is load-bearing for anyone diligencing the repository:
ADR 0007 is accepted and the application still runs on SQLite; ADR 0011's row-level
security is written and CI-tested and is **dormant** until that cutover happens.

| # | Decision | Status |
|---|---|---|
| [0001](0001-wellness-lane-posture.md) | Launch in the wellness lane, not the medical/HIPAA lane | **Superseded by 0009** |
| [0002](0002-app-layer-field-encryption.md) | App-layer AES-256-GCM field encryption + fail-fast secrets | Accepted |
| [0003](0003-security-headers-and-csp.md) | Security headers & CSP (`'unsafe-inline'` now, nonce later) | **Superseded by 0008** |
| [0004](0004-single-instance-architecture.md) | Single-instance runtime; in-process scheduler & rate limiter | **Superseded by 0007, 0009** |
| [0005](0005-tamper-evident-audit-chain.md) | Tamper-evident audit log via hash chain | Accepted |
| [0006](0006-stateless-hmac-sessions.md) | Stateless HMAC sessions; revocation via account status | Accepted |
| [0007](0007-scaling-and-zero-downtime-deploys.md) | Sequenced path to zero-downtime deploys & horizontal scale | Accepted — **not executed; still on SQLite** |
| [0008](0008-nonce-based-csp.md) | Nonce-based CSP; drop `'unsafe-inline'` from scripts | Accepted |
| [0009](0009-clinical-lane-reclassification.md) | Reclassify to the clinical/PHI lane; environment tiers govern un-gating | **Proposed — counsel not yet engaged** |
| [0010](0010-event-sourced-longitudinal-spine.md) | Event-sourced longitudinal spine; current tables become projections | Accepted — **steps 1–4 shipped; step 5 held** |
| [0011](0011-tenancy-and-person-account-separation.md) | Tenancy from day one; person identity separate from account | Accepted — **layer shipped; not yet on the request path** |
| [0012](0012-ai-gateway.md) | All model calls route through a Steady AI Gateway | **Proposed — not implemented** |
| [0013](0013-event-authoritative-writes.md) | Event-authoritative writes: scope, atomicity, failure policy, rollback | **Proposed — the Step 5 specification; 10 gates** |

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

**0013** is the specification for ADR 0010's final step, held by the Platform Readiness
Review of 2026-08-27 pending ten go/no-go gates. It is where the current-versus-target
distinction is stated most precisely, and it is the right entry point for a security
reviewer asking "what is actually enforced today?"

Nothing in this repository runs against real patient, payer, or employee health data, and
nothing may until ADR 0009's counsel review and the clinical pilot gates complete.

See [`../docs-triage.md`](../docs-triage.md) for the full documentation status.
