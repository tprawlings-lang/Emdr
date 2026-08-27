# 5 & 6 — Vendor / subprocessor register, BAA status, and data-access map

**Phase 2 security package**, items 5 and 6 of 10. Kept as one document because a vendor
entry is meaningless without what it can reach and whether an agreement covers it.

**Status:** the vendor list is derived **from the code** — every entry below corresponds to
a credential the application reads or a host it calls, verified against `package.json`,
`process.env` references, and outbound request targets. It is not a wish list.

> **No BAA is in place with any vendor.** Executing them is founder action #6 and Phase 2
> work. Until they exist, **no real patient, payer, or employee health data may enter any
> environment** (ADR 0013 gate **G10**).

---

## 1. Register

Legend — **Reaches PHI:** whether the vendor can access member health data in the target
state. **Status:** `IN USE` (called by running code) · `CONFIGURED` (credential read, path
exists) · `PLANNED` (referenced, not integrated).

| # | Vendor | Function | Status | Evidence in repo | Reaches PHI | BAA | Zone |
|---|---|---|---|---|---|---|---|
| V1 | **Anthropic** | Model provider — companion replies | IN USE | `@anthropic-ai/sdk`, `ANTHROPIC_API_KEY`, `src/lib/companion-ai.ts` | **Yes — highest exposure.** Receives the full decrypted conversation transcript, model-exposable memories, goals and trauma areas (item 1 §4) | ❌ None | Patient memory |
| V2 | **Render** | Hosting, compute, persistent disk, environment variables, logs | IN USE | `src/lib/data.ts` SSL branch; deploy target | **Yes — total.** Holds the datastore, both encryption keys, and the runtime | ❌ None | All |
| V3 | **Cloudflare R2** | Object storage for database backups | CONFIGURED | `@aws-sdk/client-s3`, `R2_ACCOUNT_ID`/`R2_BUCKET`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`, `src/lib/backup.ts` | **Yes** — full database, `age`-encrypted before upload | ❌ None | All |
| V4 | **Resend** | Transactional email — backup failure alerts only | CONFIGURED | `RESEND_API_KEY`, `https://api.resend.com/emails` | **No today** — alerts carry backup status, no member content. Becomes Yes if member email is ever sent | ❌ None | Operational |
| V5 | **GitHub** | Source control, CI, dependency and secret scanning | IN USE | `.github/workflows/` | **No** — code and fabricated fixtures only. Would become Yes if a real dataset were ever attached to an issue or CI run | n/a (no PHI) | — |
| V6 | **Stripe** | Payments | **PLANNED — not integrated** | `STRIPE_SECRET_KEY` referenced only to detect demo mode; `src/lib/billing.ts` is demo-only | Payment data, not health data — but *enrolment in a mental-health program* is itself sensitive | ❌ None | Operational |
| V7 | **Managed Postgres** | Primary datastore (target) | **PLANNED** — provider not chosen | `DATABASE_URL`, `scripts/pg-schema.sql` | **Yes — total** | ❌ None | All |
| V8 | **Secret manager** | Key custody | **PLANNED** — not chosen | — | Holds the keys to all PHI | ❌ None | — |
| V9 | **Error reporting / APM** | Observability | **NOT PRESENT** | Logging is `console.*` to platform logs (17 sites) | Would reach PHI if stack traces or request bodies were captured | n/a | — |
| V10 | **Analytics** | Product analytics | **NOT PRESENT** | No analytics SDK in `package.json` | — | n/a | — |

**V9 and V10 are listed precisely because they are absent.** Adding either is the most
likely way PHI would silently acquire a new egress path, and both are commonly added without
a security review. Any addition requires a new trust-boundary row, a register entry, and a
BAA assessment **before** it is called with member data.

---

## 2. Data-access map

What each vendor could read if fully compromised, in the target state.

```
                    ┌──────────────────────────────────────────────┐
                    │  Clinical record  Patient memory  Operational │
                    ├──────────────────────────────────────────────┤
 V2 Render          │       ●               ●               ●      │  total
 V7 Postgres        │       ●               ●               ●      │  total
 V3 R2 (backups)    │       ●               ●               ●      │  total, age-encrypted
 V8 Secret manager  │       — (holds the keys that decrypt all of the above)
 V1 Anthropic       │       ○               ●               ○      │  transcripts + memories
 V4 Resend          │       ○               ○               ◐      │  addresses only, today none
 V6 Stripe          │       ○               ○               ◐      │  billing identity
 V5 GitHub          │       ○               ○               ○      │  no member data
                    └──────────────────────────────────────────────┘
                      ● full   ◐ partial   ○ none
```

**Three vendors hold everything** (V2, V3, V7) and a fourth holds the keys (V8). The
`age`-encryption on backups is the only control that meaningfully separates a storage
compromise from a data compromise — and it is only as good as the custody of
`BACKUP_AGE_IDENTITY`, which is currently an environment variable next to the data it
protects.

---

## 3. What each BAA must contain

Not boilerplate — these are the terms that matter for this system specifically.

| Vendor | Non-negotiable terms |
|---|---|
| **V1 Anthropic** | Zero or minimal retention of prompts and completions; **no training on submitted content**; breach notification timeline; subprocessor disclosure; data-region commitment. This is the vendor receiving trauma narratives in the member's own words — the retention term is the single most important clause in the entire package. |
| **V2 Render** (or successor) | Encryption at rest and in transit; access controls and personnel screening; breach notification; data-region commitment; deletion on termination; audit rights |
| **V3 R2 / storage** | Same as V2, plus object-lock or equivalent so a compromised application credential cannot delete backup history |
| **V4 Resend** | Only required if member-facing email is introduced; until then keep the boundary honest by sending **no** member content |
| **V6 Stripe** | Standard payments terms; confirm what enrolment metadata is transmitted, since program membership is itself sensitive |
| **V7 Postgres provider** | As V2, plus point-in-time recovery and documented restore SLAs |
| **V8 Secret manager** | Access logging, separation from the application's own runtime identity, rotation support |

---

## 4. Decisions required from the founder

These are the inputs that turn this register from derived-from-code into complete. They are
founder actions #4 and #6.

| # | Decision | Blocks |
|---|---|---|
| 1 | Confirm the vendor list is complete — is anything used that leaves no trace in this repository (email, scheduling, support desk, e-signature, spreadsheets holding participant lists)? | The whole register; an unlisted vendor is an unassessed one |
| 2 | Hosting direction and Postgres provider (V2, V7) | Phase 3 infrastructure window (Sep 3–5) |
| 3 | Secret manager choice (V8) | T1.1, T2.3 — the two highest-ranked key-custody findings |
| 4 | Whether error reporting / APM will be introduced (V9) | A new egress path and BAA if yes |
| 5 | Who signs BAAs and where executed agreements are stored | Item 6 evidence |

**Question 1 is the one that most often produces a surprise.** A participant list in a
spreadsheet, a scheduling tool holding appointment reasons, or a support inbox receiving
member replies are all real subprocessors that never appear in a codebase.

---

## 5. Controlled storage — what must not live in this repository

Per the readiness review: the public repository may hold public-safe architecture. The
following belong in a private security and clinical workspace, not here:

- Executed BAAs and contracts
- Vendor security questionnaires and SOC 2 / HITRUST reports
- Account identifiers, tenant IDs, billing details
- Penetration test and security review reports
- Participant lists, clinical protocols with identifiable content
- Incident records and postmortems containing member detail

This document deliberately contains no credentials, no account identifiers, and no
executed-agreement content — only the structure of what exists and what is missing.
