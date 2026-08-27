# 1 — System context and trust boundaries

**Phase 2 security package**, item 1 of 10. See [`README.md`](README.md) for the index and
what is deliberately not in this repository.

**Status:** Current-state description, accurate as of 2026-08-27. Where a control is planned
rather than present it is marked **PLANNED** with an owner, phase, and acceptance test.

---

## 1. What Steady is, for threat-modelling purposes

A single Next.js application, deployed as one container, that stores trauma-related
behavioural health data about its members and calls one external model provider to generate
supportive conversational replies. It has no real users, no real health data, and no
Business Associate Agreements. Everything below describes the system as built so the threat
model (item 3) has an accurate subject.

The most security-relevant fact about the current architecture is its smallness: **one
process, one datastore, one privilege level.** There is no service mesh to compromise
laterally and no internal API to spoof — but equally, there is no compartment boundary
inside the application. Anything that achieves code execution in the Next.js process has the
database key, the session secret, and the model provider credential.

---

## 2. Context diagram

```
   ┌─────────────┐        ┌─────────────┐        ┌──────────────┐
   │   Member    │        │  Clinician  │        │  Platform    │
   │  (browser   │        │  (browser)  │        │  admin       │
   │   or iOS)   │        │             │        │  (browser)   │
   └──────┬──────┘        └──────┬──────┘        └──────┬───────┘
          │  TLS                 │  TLS                 │  TLS
══════════╪══════════════════════╪══════════════════════╪═══════════ TB-1 (public edge)
          │                      │                      │
   ┌──────▼──────────────────────▼──────────────────────▼───────┐
   │                    Next.js application                     │
   │  proxy.ts: CSP nonce, security headers                     │
   │  auth.ts:  stateless HMAC session cookie                   │
   │  gating.ts: 14-step checkModuleAccess (governs members)    │
   │  safety/:  deterministic engine (SHADOW — governs nothing) │
   │  crypto.ts: AES-256-GCM field encryption                   │
   │  audit.ts: hash-chained append-only log                    │
   └───┬──────────────────┬───────────────────┬────────────┬────┘
       │                  │                   │            │
  TB-2 │             TB-3 │              TB-4 │       TB-5 │
 ══════╪══════════════════╪═══════════════════╪════════════╪══════
       │                  │                   │            │
  ┌────▼─────┐    ┌───────▼────────┐   ┌──────▼─────┐  ┌───▼──────┐
  │ SQLite   │    │ Anthropic API  │   │ Object     │  │ Resend   │
  │ (local   │    │ (model         │   │ storage    │  │ (email — │
  │  file)   │    │  provider)     │   │ (backups)  │  │  alerts) │
  └──────────┘    └────────────────┘   └────────────┘  └──────────┘
       │
  PLANNED: Postgres with RLS (ADR 0007 + 0011)
```

---

## 3. Trust boundaries

| ID | Boundary | Crosses it | Controls today | Gaps |
|---|---|---|---|---|
| **TB-1** | Public internet → application | Every member, clinician, and admin request | TLS; HSTS `max-age=63072000; includeSubDomains`; nonce-based CSP (ADR 0008); `X-Frame-Options: DENY`; `Referrer-Policy: strict-origin-when-cross-origin`; Permissions-Policy; httpOnly + SameSite=Lax + Secure session cookie; HMAC-signed stateless session with idle and 30-day absolute expiry; per-account login lockout; in-process rate limiting on the model-backed endpoint | Rate limiting is **in-process** and does not survive multi-instance deploy (ADR 0004). No WAF. No bot/abuse detection. |
| **TB-2** | Application → datastore | All member data | Application-layer AES-256-GCM on free-text fields (ADR 0002); parameterised queries throughout; tenant-scoped repository **available but not on the request path** | **RLS is dormant** — SQLite has none, and the app does not yet set `app.tenant_id`. Single privilege level: the app has full read/write on every row. |
| **TB-3** | Application → model provider | Member conversation content — see §4 | TLS; server-side API key never exposed to the client; deterministic memory injection (the model cannot request memories it was not given); prompt-injection instruction treating member data as data, not instructions; kill switch `EMDR_KILL_GENERATIVE`; output validated by `safety/companion-guard` before display | **No BAA.** No AI Gateway (ADR 0012) — calls are made directly from application code, so purpose/zone scoping is by construction rather than enforced. No zero-retention agreement. |
| **TB-4** | Application → object storage | Full database backups | `age` encryption before upload; credentials in environment only; retention policy | **No BAA.** Restore has **not** been rehearsed against a production-shaped dataset (gate G6). |
| **TB-5** | Application → email | Backup failure alerts only — **no member content** | TLS; API key in environment | **No BAA.** Sender domain authentication (SPF/DKIM/DMARC) not verified in this repository. |
| **TB-6** | Operator → hosting platform | Deploy, environment variables, disk snapshots, logs | Platform account controls | **MFA enforcement and access review not evidenced here.** The hosting account is the highest-privilege object in the system and has the least documented control. |
| **TB-7** | Contributor → source repository | All code and CI configuration | Branch pushes require green CI (`safety`, `tenant-isolation`, `e2e`, `gitleaks`) | `main` is **not** a protected branch and PRs are not required (founder action #7). Any push can reach the deploy branch. |

**TB-6 and TB-7 are the two most under-controlled boundaries**, and both are administrative
rather than technical. That is worth saying plainly: the application's cryptography is in
better shape than the account that can redeploy it.

---

## 4. What actually crosses TB-3 (the model boundary)

This is the boundary that most often gets described inaccurately, so it is enumerated
against the code (`src/lib/companion-ai.ts`).

**Sent to the model provider on a companion turn:**

| Content | Source | Notes |
|---|---|---|
| System prompt | Code-defined | Static policy and safety instructions |
| Member memories | `ai_memory_items`, decrypted | Only model-exposable classes; **never** SafetyAudit or Account classes; nothing at all if the member disabled memory |
| Goals, trauma areas, restricted topics | `user_profiles`, parsed | Member-authored during onboarding |
| **Full conversation history for the thread** | `ai_messages`, **decrypted** | The complete prior transcript of that conversation |
| The member's current message | Request | Verbatim |

> **Correction to an earlier statement.** `docs/architecture/current-vs-target.md` originally
> described this egress as "coded memory + policy text; never raw transcripts." That was
> wrong: a conversational companion necessarily sends the conversation, and
> `loadHistory()` decrypts stored messages before the call. The corrected description is
> above and has been fixed in that document. **This is the single largest PHI egress in the
> system** and the threat model should treat it as such.

**Not sent:** instrument item-level answers, check-in rows, session SUDS trails, safety-plan
free text, clinician notes, credentials, or any other member's data.

**Field encryption does not protect this boundary.** AES-256-GCM at the application layer
protects data at rest in the datastore and in backups. Content sent to the model is
decrypted by definition. Any claim that "member content is encrypted" must be qualified
with "at rest" or it is misleading.

---

## 5. Assets, ranked by consequence of loss

| Rank | Asset | Where | Consequence if disclosed |
|---|---|---|---|
| 1 | Companion conversation content and memories | `ai_messages`, `ai_memory_items` (encrypted at rest); model provider in transit and in their retention | Trauma narratives in a member's own words. The most sensitive content in the system and the least protected in transit. |
| 2 | Clinical record: instruments, check-ins, sessions, risk flags | `screenings` (answers encrypted), `checkins`, `therapy_sessions` (coded, in clear) | Mental-health status inference for a named individual |
| 3 | Safety plans and trigger maps | `safety_plans`, `user_triggers` (free text encrypted) | Directly exploitable for targeted harm |
| 4 | `EMDR_DATA_KEY` | Environment | Decrypts everything in assets 1–3, including all backups |
| 5 | `EMDR_SESSION_SECRET` | Environment | Forge any session, including clinician and admin |
| 6 | `ANTHROPIC_API_KEY` | Environment | Cost abuse; not a data-disclosure path by itself |
| 7 | Audit log | `audit_log` | Integrity asset, not a confidentiality one — its value is being trustworthy |

**Assets 4 and 5 live in the same environment as each other and as the code.** A single
environment-variable disclosure (a leaked dashboard session, a misconfigured log, a
compromised dependency reading `process.env`) yields both the ability to decrypt data and
the ability to impersonate any user. Splitting them into a secret manager with separate
access paths is a Phase 2 item (**PLANNED** — Ops, Phase 2; acceptance: neither key is
readable from the application's own environment at rest, and rotation is rehearsed).

---

## 6. Actors and their maximum reach

| Actor | Authenticated as | Maximum reach today |
|---|---|---|
| Anonymous | — | Public pages, crisis resources, signup, login |
| Member | Session cookie | Their own records only |
| Clinician | Session cookie + `role = clinician` | **All members in the instance.** Caseload scoping does not exist yet (see the clinical workflow spec §1) |
| Admin | Session cookie + `role = admin` | Everything the application exposes |
| Platform admin (cross-tenant) | `crossTenantContext()` | All tenants — audited on every use, and on Postgres gated by a database role the application role cannot assume |
| Operator | Hosting account | Everything, including keys and the disk |
| Model provider | — | Whatever crosses TB-3 (§4), under their retention terms |

**The clinician row is the most important line in this table.** A clinician account today can
read every member in the instance. That is acceptable for a single-tenant prototype with
fabricated data and is **not** acceptable for a pilot. Caseload scoping is a prerequisite
for any real participant (**PLANNED** — Engineering + Clinical, Phase 4; acceptance: a
clinician request for a member outside their caseload returns not-found and is audited).

---

## 7. What is out of scope for this document

Physical security of the hosting provider, the member's own device security, and the model
provider's internal controls. Each is addressed by contract (BAA and security addendum)
rather than by design, and each is tracked in the vendor register (item 5).
