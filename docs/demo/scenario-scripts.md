# Guided demonstration scripts

**Demo-First handoff §5, §8, §9, §14.** Scripted journeys for the three reviewer audiences,
with expected states, reset steps, and known limitations.

> **Every environment these run in shows `DEMO — FABRICATED DATA — NOT CLINICAL CARE`.**
> Every person, record, and clinician is invented. Nothing here is a real member, real
> health information, or approved care.

---

## 0. Before any demonstration

```bash
npm run demo -- health      # environment is in the state a demo expects
npm run demo -- reset       # return to the versioned baseline
npm run demo -- baseline    # record the hash you are demonstrating against
```

`reset` removes every row of synthetic activity — including anything a previous viewer
created — and rebuilds from `demo-2026-08-v1`. Two resets produce the same baseline hash;
that is asserted in `tests/demo-reset.test.ts` and re-provable at any time with
`npm run demo -- verify`.

**Personas** (password `demo1234` for all):

| Persona | Account | Role |
|---|---|---|
| Alex Rivera | `demo@example.com` | Member, three weeks in, improving |
| Sam Okafor | `demo2@example.com` | Member, screening tripped the urgent queue |
| Dr. Maya Chen | `clinician@example.com` | Clinician |

**If something goes wrong mid-demo:** `npm run demo -- reset` and resume. Say so out loud
rather than working around it — a reset is a feature of this environment, not an
embarrassment.

---

## 1. Investor journey (T0)

**Claim being demonstrated:** one coherent platform, not disconnected features.
**Runtime:** 12–15 minutes.

| # | Step | What to show | Expected state |
|---|---|---|---|
| 1 | Land on `/` | The product story and pricing | Demo banner visible at the top of every page |
| 2 | Sign in as Alex | Dashboard | Three weeks of history; today's check-in already present |
| 3 | Daily check-in | Enter values; watch the routing decision | The recommendation is **deterministic** — same inputs, same outcome, every time |
| 4 | Grounding / SOS | Open the SOS panel | Never gated by tier, subscription, or a successful write |
| 5 | Companion | A short exchange | Memory is member-controlled; the companion never claims a human is watching |
| 6 | A session | Start Calm Place, rate SUDS, complete | Pre/peak/post captured; post-session check follows |
| 7 | Switch to Dr. Chen | Clinician dashboard | Pending unlock request; a reviewed hard-stop with a documented note |
| 8 | Autonomous console | `/clinician/autonomous` | The engine's parallel decision, logged and **governing nothing** |
| 9 | Event history | `npm run demo -- replay` | Projections rebuilt from events, byte-identical |

**Say this, in these words:** built for demonstration · synthetic review environment ·
planned control.

**Never say:** clinically validated · HIPAA compliant · secure · approved · production-ready ·
in pilot · in use by clinicians.

**Known limitations to state, not hide:**
- Runs on SQLite; the Postgres cutover has not happened, so row-level security is dormant.
- Tenant isolation is built and attack-tested but **not on the request path**.
- The clinician surface is the existing console, not the Phase 4 clinical prototype.
- No BAAs exist. No real data exists anywhere.

---

## 2. Clinician synthetic testing (T1)

**Purpose:** let a clinician exercise the workflow and disagree with it.
**Runtime:** 45–60 minutes. Bring [`../clinical/steady-clinical-workflow.md`](../clinical/steady-clinical-workflow.md)
and its eight open decisions.

The eight synthetic scenarios the handoff §9 requires:

| # | Scenario | Exercises | Reviewer question |
|---|---|---|---|
| S1 | Routine progress, no alert, fully cited summary | Timeline, citations | Is the timeline enough to act on? |
| S2 | An uncitable AI claim is suppressed before display | Summary contract | Is suppression the right behaviour, or should it show with a warning? |
| S3 | Immediate alert inside, then outside, configured coverage hours | Alert ownership, coverage | What should happen at 3am? |
| S4 | Companion excerpt access allowed, denied, later audited | Companion visibility policy | Which mode is right — `never`, `escalation_excerpt`, `member_shared`, `always`? |
| S5 | Primary clinician unavailable; coverage pool takes ownership | Caseload model | Owned, pooled, or hybrid? |
| S6 | Processing paused, member uses grounding, re-entry approved or denied | Alert consequence, re-entry | What must be true before someone resumes? |
| S7 | Cross-tenant access attempt and privilege change attempt | Isolation | Is the denial behaviour and its audit trail sufficient? |
| S8 | BLS Part 6 simulation reaching a stop or escalation | Part 6 workflow | Are the stop conditions right? |

**Comparing policy modes.** Restart with a different configuration and re-run the relevant
scenario:

```bash
EMDR_CLINICAL_POLICY=privacy_maximal    npm run start   # clinician never sees companion content
EMDR_CLINICAL_POLICY=clinician_maximal  npm run start   # full transcripts, pooled caseload
EMDR_CLINICAL_POLICY=staffed_24h        npm run start   # 24-hour coverage, timed re-entry
EMDR_CLINICAL_POLICY=engine_recommend   npm run start   # engine recommends rather than only logs
```

The member-facing coverage sentence is **derived from** the configured schedule, so
switching coverage changes what members are told. That is deliberate: the failure mode is a
product promising round-the-clock monitoring while the rota is business hours.

**State at the start of every clinician session:** these defaults are demonstration
assumptions, not clinical approval. `beta-clinrev-2026-07` ratified the *consumer* product
and does not extend to any of this. The packet seeking ratification is
[`clinical-pilot-2026-09`](../clinical/clinical-pilot-2026-09.md), and it is unsubmitted.

**Capture from every session:** which scenario, which policy mode, the clinician's verdict,
and any disagreement — feedback is only useful if it is attached to the configuration that
produced it.

---

## 3. Security audit environment (T1)

**Purpose:** let a reviewer inspect controls, boundaries, logs, and known gaps.
**Runtime:** self-directed. Entry point: [`../security/README.md`](../security/README.md).

| # | Demonstration | Command | Expected |
|---|---|---|---|
| D1 | Cross-tenant and privilege attacks against Postgres RLS | `npm run test:rls` | 12 assertions pass; a real cluster is created and destroyed |
| D2 | Application-layer isolation attacks | `npx tsx --test tests/tenant-isolation.test.ts` | 18 cases pass |
| D3 | Transaction, tenant-binding, atomicity | `npx tsx --test tests/tenant-transaction.test.ts` | 12 cases pass |
| D4 | Event replay reproduces the same state | `npm run demo -- verify` | Deterministic seed, idempotent backfill, byte-identical replay |
| D5 | Secret scanning | `.github/workflows/gitleaks.yml` | Clean |
| D6 | Dependency scan | `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| D7 | Full safety suite | `npm run test:safety` | 355 pass |
| D8 | Reproducible end-to-end | `npm run test:e2e`, run twice | 17/17 both times |

**Follow one alert end to end:** create a harm-urge check-in as Alex → observe the crisis
ceiling and deterministic routing → see the alert in the clinician queue → review and close
it with a documented action → export the sign-off register as CSV → confirm every step
appears in the hash-chained audit log.

**Known gaps, given to the reviewer rather than found by them** — the ten ranked findings in
[`../security/README.md`](../security/README.md). Planned controls are labelled planned and
never demonstrated as active. The largest: no BAA with the model provider, which receives
the full decrypted conversation transcript.

---

## 4. BLS Part 6 (labelled simulation)

Every BLS screen and script states that the workflow is **simulated, uses fabricated data,
and is not approved clinical care.**

| Demonstrate | Do not claim |
|---|---|
| Protocol states and transitions | Clinical effectiveness |
| Eligibility and exclusion simulation | Final participant eligibility |
| Pause, stop, escalation, grounding, re-entry | Autonomous real-person operation |
| Clinician review queue and evidence capture | Approved clinical protocol |

Member-initiated resourcing is live and flag-gated. **Autonomous stimulation stays OFF** —
an explicit condition of the existing sign-off — and no configuration in this repository can
turn it on.

---

## 5. Stop conditions

Halt the demonstration and follow the process if any of these occur:

| Condition | Action |
|---|---|
| **Any real person's information appears** in a T0/T1 environment | Isolate the environment, preserve evidence, notify the named owner, assess exposure, remove the data through the approved process, and do not resume until the cause is corrected |
| A viewer asks to enter their own real health information | Decline. Offer a fabricated persona instead |
| A reviewer asks whether they may use this with a patient | No. T2 requires clinical, privacy, legal, security, consent, and protocol gates, none of which have passed |
| The demo is asked to stand as evidence of compliance or validation | A finished demo is evidence of product execution. It is not evidence of clinical effectiveness, legal compliance, security certification, or production readiness |

---

## 6. What this environment cannot show

Stated up front so nobody discovers it mid-session and reads it as concealment:

- **Postgres and active RLS** — the app runs on SQLite; RLS is proven in CI against a real
  cluster but enforces nothing at runtime.
- **Tenant isolation on the request path** — built, attack-tested, zero product adoption.
- **Event-authoritative writes** — dual-write only; Step 5 is held for its gated window.
- **A second tenant** — the schema supports it; no running environment has one.
- **MFA, caseload scoping, read auditing** — none exist yet.
- **Real outcomes of any kind** — there are no members.
