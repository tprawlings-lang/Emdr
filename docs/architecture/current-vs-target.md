# Current versus target architecture

**Phase 1 deliverable** (Platform Readiness Review, 2026-08-27). Covers the five items the
review names for this phase: current-versus-target architecture, the user and role map, the
PHI data flow, data classification, and the claims boundary. The Steady Clinical workflow —
the sixth — is [`../clinical/steady-clinical-workflow.md`](../clinical/steady-clinical-workflow.md).

**Audience:** security reviewers, clinical reviewers, counsel, and diligence. It is written
to be read by someone who has not seen the code and must decide what they can rely on.

> **The one sentence that governs this document.** Steady today is a single-tenant SQLite
> wellness prototype with tenant-safe building blocks that are not yet on the request path.
> It is *architected toward* a multi-tenant clinical platform. Anything below marked
> **Target** does not exist in the running system, and no claim to the contrary may be made
> to any audience.

---

## 1. What runs today

```
Browser / iOS ──► Next.js 16 (App Router)          ── single container, single instance
                    │
                    ├─ Server Actions (web)   ──┐
                    ├─ /api/mobile/v1/*       ──┤── shared deterministic core
                    │                           │   (gating, safety, scoring, content)
                    │                           │
                    ├─ lib/gating.ts            │   14-step checkModuleAccess gate chain
                    ├─ lib/safety/*             │   deterministic engine — SHADOW ONLY
                    ├─ lib/spine.ts             │   dual-write: event + current-state row
                    ├─ lib/audit.ts             │   hash-chained, append-only
                    ├─ lib/crypto.ts            │   AES-256-GCM field encryption
                    │                           │
                    └─ lib/data.ts ─────────────┘── SQLite (better-sqlite3), one file
```

| Property | Today |
|---|---|
| Datastore | **SQLite**, single file, single writer |
| Deployment | Single container (Render); ~30–60s of `502`s per deploy |
| Tenancy | `tenant_id` present on 27 tables, every row on the platform tenant. **No second tenant exists in any running environment.** |
| Isolation enforcement | `Repository` + `TenantContext` exist and are attack-tested; **product call sites do not use them** |
| Row-level security | Written, forced on 33 tables, 12 attack cases CI-blocking — **against a schema nothing in production runs** |
| Event log | Written on every instrumented path; **advisory** — the current-state write is what the app depends on |
| Sessions | Stateless HMAC cookie (ADR 0006); revocation via `token_epoch` |
| Field encryption | AES-256-GCM at the application layer (ADR 0002) |
| Audit | Hash-chained, append-only, verifiable (ADR 0005) |
| Model calls | Direct from application code — **no AI gateway** (ADR 0012 unimplemented) |
| Real health data | **None, anywhere.** Demo and test data is fabricated. |

### The gate chain is the thing that actually governs members

Every claim about member safety today rests on one function, `checkModuleAccess`
(`src/lib/gating.ts`), and its 14 ordered gates: kill switch → subscription → tier →
consent → program-fit screener → baseline screening → profile completeness → today's
check-in → check-in routing → readiness track → safety plan → prerequisites → unlock →
cooldowns and caps. It is deterministic, human-authored, and fully covered by the `@safety`
suite. The autonomous engine (`lib/safety/`) computes a parallel verdict and logs it; it
governs nothing.

---

## 2. Target architecture

```
Clients ──► Next.js app ──► AI Gateway (ADR 0012) ──► model providers
                │              └─ purpose + tenant + zone scoped retrieval,
                │                 provenance recorded per call
                │
                ├─ Authoritative command path (ADR 0013)
                │     withTenantTransaction ─► appendEvent ─► applyProjection
                │
                └─ Postgres (ADR 0007)
                      ├─ longitudinal_events  ← system of record
                      ├─ projections          ← rebuilt from events, verified
                      └─ RLS active: app.tenant_id per transaction,
                         application role is non-owner and non-superuser
```

| Property | Target |
|---|---|
| Datastore | Postgres, managed, with backup/restore proven by rehearsal |
| Tenancy | Multi-tenant; every request carries authenticated tenant context; RLS enforced at the database |
| Write path | Event append and projection commit in one transaction; a failed append fails the command |
| History | Corrections append and supersede; nothing is erased |
| Model calls | All through the gateway; every inference has recorded provenance |
| Clinical surface | Steady Clinical — caseload, timeline, evidence-linked summaries, review actions |
| Enterprise | Organization administration, eligibility, population workflows, reporting |

---

## 3. The delta, with owners and acceptance tests

Every planned control needs an owner, a target phase, and a test that decides whether it
landed. A control without an acceptance test is an intention.

| # | Gap | Phase | Owner | Acceptance test |
|---|---|---|---|---|
| 1 | Postgres cutover; SQLite retired | 3 | Engineering + Ops | Synthetic migration, backup, restore, audit-chain verification, and rollback all pass (ADR 0013 **G6**) |
| 2 | RLS active in the running app | 3 | Security | `verify-rls.sh` green against the deployed schema **and** every request path sets `app.tenant_id` (**G4**) |
| 3 | Product call sites behind `TenantContext` | 3 | Engineering | No product write reaches `data()` outside `withTenantTransaction`; enforced by test, not review (**G3**) |
| 4 | Event-authoritative writes | 3 | Engineering | The eight commands in ADR 0013 §1 fail closed on append failure (**G2**) |
| 5 | Threat model, risk register, BAA register | 2 | Security + Founder | Security package complete and reviewed by the named external reviewer |
| 6 | Secret management | 2 | Ops | No credential in source or environment file; rotation procedure rehearsed |
| 7 | AI Gateway (ADR 0012) | 4 | Engineering | Every model call carries tenant, purpose, zone, and provenance; direct SDK calls fail lint |
| 8 | Steady Clinical surface | 4 | Product + Clinical | Synthetic clinician testing against the workflow spec |
| 9 | Autonomous engine governs | Post-4 | Clinical + Counsel | Reviewer conditions met; divergence report walked; staged flag flip |
| 10 | Counsel lane decision (ADR 0009) | 2 | Founder + Counsel | Written determination on file |
| 11 | Interventions versioned | 4 | Engineering | `interventionVersion` is a real version, not `"unversioned"` |
| 12 | Safety state as a typed machine | 4 | Engineering | Transitions are data, and illegal transitions are unrepresentable |

---

## 4. User and role map

### Today

Three roles on a single column, `users.role ∈ (member, clinician, admin)`. One role per
account, globally. A clinician at two organizations is unrepresentable; a person without an
account is unrepresentable.

### Target

Identity is split three ways (ADR 0011), and **role is a relationship, not an attribute**:

| Entity | Meaning | Cardinality |
|---|---|---|
| **Person** | A human Steady holds data about | May have **zero** accounts — the covered-population case (Handoff C3) |
| **Account** | A login | Optional; belongs to exactly one Person |
| **Tenant** | A governance boundary | Always present; consumers sit on the platform tenant |
| **RoleAssignment** | `(person, tenant, role, scope, effective_from, effective_to)` | Many per person; time-bounded |

Roles the schema accepts today (`role_assignments.role`):

| Role | Sees | Does not see |
|---|---|---|
| `member` | Their own record entirely | Anything of anyone else's |
| `clinician` | Assigned caseload within one tenant: timeline, alerts, scores, coded flags | Members outside the caseload; other tenants; raw companion transcripts except where escalated |
| `care_manager` | Coordination-level view within one tenant | Clinical decision authority |
| `admin` | Tenant administration | Clinical content by default — administration is not care |

**Platform administration is deliberately outside this table.** Cross-tenant access exists
only through `crossTenantContext()`, which is a named function, greppable in review, audited
with a stated reason on every use, and — on Postgres — gated by a database *role* the
application role cannot assume. A session variable cannot grant it.

**Not yet modelled, needed before pilot:** supervisor (reviews a clinician's decisions),
researcher (de-identified analytics only, no clinical record), and support (operational
troubleshooting with no PHI). Each needs its zone access decided before it exists, not
after.

---

## 5. Data classification and the six governance zones

ADR 0011 §5 and ADR 0009 §1 define six zones. Zone travels with the record, and retrieval is
`(tenant, zone, purpose)` — which is what makes "minimum necessary" mechanical rather than
aspirational.

| Zone | Contains | Today's tables | Retention posture |
|---|---|---|---|
| **Operational** | Accounts, subscriptions, payments, sessions-as-in-logins, audit | `users`, `accounts`, `subscriptions`, `payments`, `audit_log` | Business records; audit is append-only and never deleted |
| **Patient memory** | Companion memory, member-authored notes, triggers, safety plan | `ai_memory_items`, `ai_messages`, `user_triggers`, `safety_plans` | Member-controlled; correction and deletion are member rights |
| **Clinical record** | Instruments, scores, check-ins, sessions, unlock decisions | `screenings`, `checkins`, `therapy_sessions`, `module_unlocks`, `alerts` | Longest retention; corrections append and never erase |
| **Analytics** | Aggregate, de-identified | *(none yet)* | No re-identification path |
| **Research** | Consented, separately governed | *(none yet)* | Requires explicit, separate consent |
| **Model development** | Evaluation sets, prompt/version records | *(none yet)* | **Never contains member content without separate consent** |

### Classification of what exists today

| Class | Examples | Handling |
|---|---|---|
| **Sensitive-encrypted** | Screening item answers, companion message text, memory values, safety-plan free text, trigger notes, clinician sign-off notes | AES-256-GCM at the application layer (ADR 0002); the key is never in source; **never carried in a longitudinal event**. ⚠ "Encrypted" means **at rest**: companion messages and memories are decrypted when sent to the model provider (security/01 §4). |
| **Sensitive-coded** | Scores, risk flags, SUDS, recommended action, unlock status | Stored in clear so the deterministic gates can read them; carried in events |
| **Identifying** | Email, name, date of birth | Operational zone; `users`/`accounts` only |
| **Credential** | Password hashes, session secrets | Operational; **never event-sourced, never logged, never in a projection** |
| **Public** | Module catalog, lessons, practices, policy text | Code-defined, reviewable in one place |

The split between *sensitive-encrypted* and *sensitive-coded* is the single most important
line in this document, because it is what the event spine is built around: **events carry
coded structure and never protected content.** That is why `screenings`, `ai_memory_items`,
and `users` are partial projections and are excluded from ADR 0013's authoritative scope.

---

## 6. PHI data flow

Today there is **no PHI**, because there is no real patient data and no BAA. This section
describes where PHI *would* flow once the lane decision and pilot gates are complete, so the
threat model (Phase 2) has a subject.

```
   MEMBER                        STEADY                          THIRD PARTIES
   ──────                        ──────                          ─────────────
   check-in ──────────► [clinical record] ──┐
   instrument ────────► [clinical record] ──┤
   session SUDS ──────► [clinical record] ──┼──► deterministic gates (in-process,
   companion message ─► [patient memory] ───┤     no egress, no model call)
   safety plan ───────► [patient memory] ───┘
                                  │
                                  ├─ companion reply ──► AI Gateway ──► model provider ⚠ BAA
                                  │      (system prompt + model-exposable memories +
                                  │       goals/trauma areas + THE FULL DECRYPTED
                                  │       CONVERSATION TRANSCRIPT + current message.
                                  │       Not sent: item-level answers, check-ins,
                                  │       SUDS trails, safety-plan text, clinician notes.
                                  │       See security/01 §4 — this is the largest
                                  │       PHI egress in the system.)
                                  │
                                  ├─ alert ───────────► clinician (same tenant only)
                                  ├─ audit entry ─────► [operational, append-only]
                                  └─ backup ──────────► object storage ⚠ BAA

   CLINICIAN ─────────► caseload / timeline / decisions ──► [clinical record]
                        every read and write audited
```

**Egress points — the complete list, because a data-flow diagram is only useful if it is
exhaustive:**

| # | Egress | Carries | Control required before real PHI |
|---|---|---|---|
| 1 | Model provider | Companion context **including the full decrypted conversation transcript** — see security/01 §4 | BAA; gateway enforcing zone and purpose; zero-retention terms |
| 2 | Object storage (backups) | Full database | BAA; encryption at rest; tested restore; key custody |
| 3 | Error reporting | Stack traces | Scrubbing proven by test, or no PHI-capable service at all |
| 4 | Email | Notifications | BAA; no clinical content in message bodies |
| 5 | Hosting provider | Everything at rest and in flight | BAA; region commitment |
| 6 | Analytics | Aggregates only | No member-level export; de-identification reviewed |

Items 1–6 are the vendor list the BAA register (Phase 2) must cover. **Any egress not on
this list is a finding**, and that is the property the threat model should test.

---

## 7. Claims boundary

What may be said, to whom, today. This is the list that turns into a compliance finding
when someone gets it wrong in a deck.

### May be said

- "A deterministic, clinician-ratified safety gate chain governs every session."
  ✅ True and tested — with the qualifier that ratification was **with conditions** and the
  autonomous engine runs in shadow.
- "Architected for HIPAA: tenancy, event-sourced history, data zones, field encryption, and
  a hash-chained audit log." ✅ True as architecture.
- "Cross-tenant isolation is tested with attack cases in CI." ✅ True at the database and
  repository layers.
- "A member's history is reconstructable from original evidence." ✅ True for the six
  projected tables, verified byte-identically.

### May **not** be said

- ❌ "HIPAA compliant." No BAAs, no risk analysis, no counsel determination.
- ❌ "Tenant isolation is enforced." The building blocks are; the running application is
  not. Say "built and tested, not yet on the request path."
- ❌ "Clinically validated," "clinically proven," "treats PTSD," "therapy," "cure."
  Enforced automatically by the banned-vocabulary CI gate.
- ❌ "In use by clinicians" / "in pilot." No pilot has begun; no real participant exists.
- ❌ "The AI is supervised by clinicians in real time." It is not. Human oversight is the
  alert and review workflow, asynchronously.
- ❌ Anything implying the autonomous safety engine governs access. It computes and logs.

### The standing constraint

**No real patient, payer, or employee health data enters any environment** until the
clinical, security, privacy, legal, and operational gates complete (ADR 0013 gate **G10**).
This holds for demos, investor sessions, and clinician walkthroughs without exception —
a demonstration is not an exemption.

---

## 8. What a reviewer should read next

| Question | Document |
|---|---|
| What is enforced today? | §1 above, and the enforced-versus-dormant table in the root `README.md` |
| What is the cutover plan and its gates? | [`../adr/0013`](../adr/0013-event-authoritative-writes.md) |
| Why is the architecture shaped this way? | [`../adr/0009`](../adr/0009-clinical-lane-reclassification.md)–[`0012`](../adr/0012-ai-gateway.md) |
| What does the clinician actually do? | [`../clinical/steady-clinical-workflow.md`](../clinical/steady-clinical-workflow.md) |
| Where is the security package? | **It does not exist yet** — Phase 2. Its contents are listed in the root `README.md`. |
