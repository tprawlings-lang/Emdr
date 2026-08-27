# Steady — security package

**Phase 2 deliverable** (Platform Readiness Review, 2026-08-27). This is also **item 10**,
the security-review handoff packet: it is the cover document an external reviewer should
read first.

**Version:** draft 1, 2026-08-27. Not yet reviewed by anyone external.

---

## Read this first

Three facts frame everything in this package. A reviewer who reads nothing else should read
these.

1. **Steady holds no real patient, payer, or employee health data, anywhere.** All
   development, demonstration, and testing runs on fabricated data, and this is a standing
   constraint through the entire build period (ADR 0013 gate **G10**).
2. **Steady is not HIPAA compliant, is nobody's Business Associate, and has no BAAs.** It is
   *architected toward* the clinical lane; the lane decision itself
   ([ADR 0009](../adr/0009-clinical-lane-reclassification.md)) is Proposed and **counsel has
   not been engaged.**
3. **The tenant-isolation controls are built and adversarially tested but are not on the
   request path.** The repository contains tenant-safe building blocks; the running SQLite
   application does not enforce end-to-end tenant isolation. This package says so in every
   place it is relevant, and any document that says otherwise is wrong.

This package describes **current controls and planned controls separately**. Every planned
control carries an owner, a target phase, and an acceptance test, because a planned control
without an acceptance test is an intention.

---

## Contents

| # | Document | Covers |
|---|---|---|
| 1 | [System context and trust boundaries](01-system-context-and-trust-boundaries.md) | Context diagram, seven trust boundaries, exactly what crosses the model boundary, assets ranked by consequence, actor reach |
| 2 | PHI data-flow across the six governance zones | In [`../architecture/current-vs-target.md`](../architecture/current-vs-target.md) §5–6 — data classification, the flow, and the **complete egress list** |
| 3 | [Threat model and abuse cases](03-threat-model-and-abuse-cases.md) | STRIDE per boundary, nine behavioural-health abuse cases, ten ranked findings |
| 4 | [HIPAA Security Rule risk register](04-hipaa-security-risk-register.md) | Safeguard-by-safeguard state with acceptance tests |
| 5 & 6 | [Vendor register and BAA status](05-vendor-register-and-baa-status.md) | Ten vendors derived from the code, data-access map, required BAA terms |
| 7 | [Identity, tenant, and privilege model](07-identity-tenant-and-privilege-model.md) | Authentication, the four isolation layers and which are live, escalation paths, audit coverage |
| 8 | [Logging and monitoring plan](08-logging-and-monitoring-plan.md) | What is logged, what must never be, signals to build, retention |
| 9 | [Incident and breach response update](09-incident-and-breach-response-update.md) | Clinical-lane supplement to [`../incident-response.md`](../incident-response.md) |
| 10 | This document | Handoff packet |

### Supporting evidence in the repository

| Artefact | What it proves |
|---|---|
| [`scripts/verify-rls.sh`](../../scripts/verify-rls.sh) | Twelve cross-tenant attack cases against a **real Postgres cluster**, CI-blocking |
| `tests/tenant-isolation.test.ts` | Eighteen application-layer isolation attack cases |
| `tests/tenant-transaction.test.ts` | Twelve transaction, tenant-binding, and atomicity cases |
| `tests/safety-redteam.test.ts`, `tests/bls-redteam.test.ts` | Adversarial safety cases |
| `.github/workflows/safety.yml` | Blocking gates: safety suite, tenant isolation, e2e + axe, build |
| `.github/workflows/gitleaks.yml` | Secret scanning |
| [`../adr/`](../adr/) 0002, 0005, 0006, 0008, 0011, 0013 | Encryption, audit chain, sessions, CSP, tenancy, cutover |

---

## The ten findings, ranked

From [item 3](03-threat-model-and-abuse-cases.md) Part C. Risk ratings assume the **pilot**
state (real participants); today's actual member exposure is nil because there are no
members.

| # | Finding | Risk | Blocks |
|---|---|---|---|
| 1 | No BAA with the model provider, which receives full decrypted trauma transcripts | High | Any real participant |
| 2 | Tenant isolation controls not on the request path | High | Any second tenant |
| 3 | Data key and session secret co-located in the application environment | High | Any real participant |
| 4 | Backup restore never rehearsed | High | Pilot (gate G6) |
| 5 | Clinicians can read every member; no caseload scoping | High | Pilot |
| 6 | `main` unprotected; unreviewed code can reach deploy | High | **Nothing — fixable today** |
| 7 | Consent withdrawal vs immutable history undecided | High | Any real participant |
| 8 | Operator database access unaudited | Medium-High | Pilot |
| 9 | Rate limiting does not survive horizontal scale | Medium | Multi-instance deploy |
| 10 | Coerced-member / shared-device abuse case unaddressed | Medium-High | Pilot |

**Finding 1 gates the most and is the least technical** — it is a contract. **Finding 6
costs nothing** and is a repository setting.

---

## What is strong, stated fairly

A package that only lists gaps misrepresents the system. What a reviewer should credit:

- **Encryption, audit integrity, and session control are genuinely built and tested.** The
  audit log is hash-chained and verifiable; sessions carry idle *and* absolute expiry with
  epoch revocation; free-text fields are AES-256-GCM encrypted.
- **Isolation is proven adversarially, not asserted** — 42 attack cases across three suites,
  including against a real Postgres cluster in CI. The controls fail *closed*: no tenant
  means no rows, never all rows.
- **Immutability is enforced at the privilege level**, not by convention — the application
  role is granted only `SELECT, INSERT` on the event and audit logs.
- **Safety is deterministic and human-authored.** No model decides member access; the
  autonomous engine runs in shadow and governs nothing.
- **The gaps are documented rather than discovered.** This package was written before an
  external review, which is the cheaper order.

The honest shape: **technical safeguards are the strongest category; administrative and
organizational safeguards are the weakest** (item 4). That asymmetry is typical of an
engineering-led build, and it cuts both ways — the expensive, hard-to-retrofit half is
largely done, and the cheap half is entirely undone.

---

## What is NOT in this repository, deliberately

Per the readiness review, the public repository may hold public-safe architecture only.
These require controlled storage:

- Executed BAAs, contracts, and vendor security questionnaires
- Account identifiers, tenant IDs, infrastructure names, billing detail
- Penetration test and security review reports
- Participant lists and clinical protocols with identifiable content
- Incident records containing member detail

This package contains no credentials, account identifiers, or executed-agreement content.

---

## For the external reviewer

**Suggested reading order:** this document → item 1 (boundaries) → item 3 (threat model) →
item 7 (isolation, if that is your focus) → item 4 (compliance framing).

**What would be most useful from you:**

1. **Is the threat model's scope framing right?** It treats findings as pre-emptive because
   no real data exists. If you think any finding is already active, say so.
2. **Finding 1** — is a BAA plus zero-retention sufficient for sending trauma narratives to
   a third-party model, or does the architecture need to change?
3. **Abuse case A1** (coerced member, shared device) has no technical control. We would
   value a view on whether it is adequately addressed by product design alone.
4. **Abuse case A7** — immutable history versus erasure rights. We have flagged it for
   counsel; tell us if we have the tension wrong.
5. **What is missing entirely?** The blind spots we cannot see are the reason to ask.

**What we are not asking for yet:** a penetration test. The application will change
materially at the Postgres cutover (Phase 3), and testing the current SQLite single-tenant
build would test something that is about to be replaced.

---

## Open decisions blocking this package

| # | Decision | Owner | Blocks |
|---|---|---|---|
| 1 | Name a Security Official | Founder | §164.308(a)(2) — free, and blocks nothing else |
| 2 | Engage healthcare/privacy counsel and a security reviewer | Founder | ADR 0009, item 4, external review |
| 3 | Confirm the vendor list is complete — including anything with no trace in the codebase | Founder | Item 5; an unlisted vendor is an unassessed one |
| 4 | Hosting, Postgres provider, and secret manager | Founder + Ops | Findings 3, 4; Phase 3 window |
| 5 | Public repository vs controlled workspace split | Founder | Where the rest of this package lives |
| 6 | Protect `main`, require PRs and green checks | Founder | Finding 6 |
| 7 | Consent-withdrawal policy vs immutable history | Counsel + Engineering | Finding 7 |

Decisions 1 and 6 cost nothing and can be closed today.
