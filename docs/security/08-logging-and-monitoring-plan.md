# 8 — Logging and monitoring plan

**Phase 2 security package**, item 8 of 10.

**Current state in one line:** Steady has an excellent *audit* log and almost no
*operational* logging or monitoring. Those are different things and the distinction matters —
the audit log proves what happened after someone asks; monitoring is what causes someone to
ask.

---

## 1. What exists today

| Stream | Where | Content | Retention | Gap |
|---|---|---|---|---|
| **Audit log** | `audit_log` table, hash-chained (ADR 0005) | 8 families: clinical, billing, identity, specialist_action, safety, module_runtime, consent, security | Retained with the database | **Nobody reviews it on a schedule** |
| Application logs | `console.*` → platform log stream (17 call sites) | Backup status, model-call failures, spine failures during dual-write | Platform default | Unstructured; no correlation id; not searchable in a useful way |
| Longitudinal events | `longitudinal_events` | Domain history | Permanent | Not a security stream, but useful corroboration |
| Backup alerts | Email via Resend | Backup success/failure | — | The **only** proactive alert in the system |
| CI gates | GitHub Actions | Safety suite, RLS attacks, e2e, `npm audit`, gitleaks, banned vocabulary | 90 days | Blocking, which is the right design |

**There is exactly one alert in the entire system**, and it fires on backup failure. Nothing
alerts on authentication anomalies, safety events, error rates, or anything a security
reviewer would consider monitoring.

---

## 2. What must be logged, and what must never be

### Must be logged

| Event | Why | Exists |
|---|---|---|
| Authentication success and failure, with source | Credential stuffing detection | ◐ audited, not alerted |
| Session revocation (`token_epoch` bump) | Incident response evidence | ✅ |
| Consent granted and withdrawn, with scope and version | Legal defensibility | ✅ |
| Clinician decisions, overrides, and their reasons | Clinical accountability | ✅ |
| Cross-tenant access with its stated reason | The escape hatch must be reviewable | ✅ |
| Safety events: hard stops, crisis routing, escalation | Adverse event tracking | ✅ |
| **Reads of a member record by a clinician** | "Who saw this?" is auditable in clinical care | ❌ **Missing** |
| **Model calls with provenance** | Reconstructing what an AI statement rested on | ❌ Missing (ADR 0012) |
| **Administrative access to the database** | The operator bypass path | ❌ Missing |
| Configuration and kill-switch changes | Safety-relevant state changes | ❌ Missing |

### Must never be logged

Stated explicitly because a logging *improvement* is the most common way PHI acquires a new
egress path:

- Member free text of any kind — companion messages, trigger notes, safety-plan fields
- Instrument item-level answers
- Credentials, session tokens, API keys, or the data key
- Full request bodies on any member-facing route
- **Stack traces containing member data** — the reason no error-reporting service has been
  added is that adding one without scrubbing would create exactly this

**Acceptance test for this section:** a CI check that fails if a member-content column name
appears within a `console.*` call, plus a review requirement on any new logging library.
(**Engineering, Phase 2**)

---

## 3. Monitoring and alerting to build

Grouped by what a signal actually tells you. Each needs an owner before it is built — an
alert with no owner is a notification.

### Security

| Signal | Threshold | Owner | Why |
|---|---|---|---|
| Failed logins per account and per source | Burst above baseline | Security | Credential stuffing |
| Successful login from a new source for a clinician/admin | Any | Security | Highest-value accounts |
| Cross-tenant access invocations | **Any** | Security | Should be near-zero; every one is reviewable |
| Tenant-context failures | **Any** | Engineering | A request reaching the data layer without a tenant is a bug that would have been a breach in the other failure direction |
| Audit chain verification failure | **Any** | Security | Tampering or corruption |
| Authorization denials | Sustained rise | Security | Probing |

### Data integrity (ADR 0013 §8)

| Signal | Threshold | Owner |
|---|---|---|
| Event append failure rate | Any, once authoritative | Engineering |
| Projection failure rate | Any | Engineering |
| **Replay drift** — scheduled `verifyProjections()` finding any diff | **Any** | Engineering |
| Event-log growth vs command volume | Ratio shift | Engineering |
| Backup success, age, and **restore rehearsal recency** | Miss, or > 90 days since rehearsal | Ops |

Replay drift is the cheapest to skip and the most consequential to miss: it is the
difference between believing the log is authoritative and checking that it is.

### Safety and clinical

| Signal | Threshold | Owner |
|---|---|---|
| Hard-stop rate and reasons | Weekly review | Clinical lead |
| Crisis routing invocations | Any | Clinical lead |
| Unclosed Immediate/High alerts | Past deadline | Named supervisor |
| **Alert dismissal rate by category** | Sustained high | Clinical lead |
| Companion guard rejections | Rate change | Engineering + Clinical |
| Shadow-vs-live engine divergence | Weekly review | Engineering + Clinical |

Alert dismissal rate is a safety metric, not an operational one: bulk dismissal means a
category is miscalibrated, and recalibrating a clinical threshold is a clinical decision.

### Availability and cost

| Signal | Threshold | Owner |
|---|---|---|
| Error rate, latency, saturation | Standard | Ops |
| Model spend | Daily cap | Ops |
| Rate-limit rejections | Burst | Engineering |

---

## 4. Retention

| Stream | Retention | Basis |
|---|---|---|
| Audit log | **6 years minimum** | §164.316(b)(2)(i); never deleted, append-only by construction |
| Longitudinal events | Permanent | System of record; corrections supersede rather than delete |
| Application logs | 90 days | Operational need; contains no member content by policy |
| Security alerts and incident records | 6 years | Incident documentation |
| Backups | `BACKUP_RETENTION_DAYS` | Balance recovery against exposure |

**Open tension, flagged rather than resolved:** permanent event retention conflicts with
erasure rights (item 3, abuse case A7). What consent withdrawal deletes, tombstones, or
retains — and on what basis — is a **counsel decision**, not an engineering one, and it is
cheaper to make now while all history is fabricated.

---

## 5. Sequencing

| Phase | Work | Acceptance |
|---|---|---|
| **2** | Structured logging with correlation ids; the never-log CI check; audit review cadence with a named owner; security alerts for cross-tenant access, audit-chain failure, and tenant-context failure | Alerts fire in a test; a review has actually happened and is recorded |
| **3** | Data-integrity signals (ADR 0013 §8) including scheduled replay drift; database-level access auditing; backup restore rehearsal | Gate **G8**; gate **G6** |
| **4** | Read auditing on the clinical surface; model-call provenance via the AI Gateway; clinical and safety monitoring with named owners | A clinician view produces an audit entry; every inference has provenance |
| **5** | Adverse-event reporting route; monitoring responsibilities in the pilot protocol | Signed pilot protocol |

**Read auditing must ship with the clinical surface, not after it.** Retrofitting it leaves
the pilot's own access history permanently unreconstructable — which is exactly the question
a reviewer will ask about the pilot.
