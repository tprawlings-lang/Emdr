# 3 — Threat model and abuse cases

**Phase 2 security package**, item 3 of 10. Depends on
[item 1](01-system-context-and-trust-boundaries.md) for boundaries and assets.

**Method:** STRIDE per trust boundary, plus a separate abuse-case section for
behavioural-health-specific harms that STRIDE does not surface. Each finding carries a
current control, a residual risk, and — where the control is planned — an owner, phase, and
acceptance test.

**Scope statement, stated first because it changes how everything below should be read:**
this system holds **no real patient data** and has **no Business Associate Agreements**.
Every finding is therefore a finding about a system that must be fixed *before* real data
arrives, not an active exposure. The risk ratings assume a future state with real
participants; today's actual exposure of member harm is nil because there are no members.

**Risk scale:** Likelihood × Impact, each Low/Medium/High. Ratings are for the *pilot* state
(real participants, one organization, supervised).

---

## Part A — STRIDE by trust boundary

### TB-1 — Public internet → application

| ID | Threat | S T R I D E | Current control | Residual | Action |
|---|---|---|---|---|---|
| T1.1 | Session token forgery | **S** | HMAC-SHA256 over payload with `EMDR_SESSION_SECRET`; httpOnly, SameSite=Lax, Secure; idle expiry + 30-day absolute cap; `token_epoch` revocation | **Medium** — the secret is a single environment variable co-located with the data key | Move to a secret manager with separate access paths (**Ops, Phase 2**; acceptance: secret not readable from the application environment at rest, rotation rehearsed) |
| T1.2 | Credential stuffing / brute force | **S** | Per-account lockout after repeated failures; password hashing | **Medium** — no CAPTCHA, no IP-based throttle, no breached-password check | Add IP-scoped throttling and a breached-password check at registration (**Engineering, Phase 2**; acceptance: automated test proves N failed attempts from one source are throttled) |
| T1.3 | XSS leading to session theft or data exfiltration | **T I** | Nonce-based CSP with no `'unsafe-inline'` for scripts (ADR 0008); React escaping; `X-Frame-Options: DENY` | **Low** | Keep the CSP regression covered by the e2e header assertions |
| T1.4 | CSRF on state-changing actions | **T** | SameSite=Lax cookie; Next.js Server Actions carry an origin check | **Low** | — |
| T1.5 | Denial of service / cost abuse on the model endpoint | **D** | In-process fixed-window rate limiter; `EMDR_KILL_GENERATIVE` kill switch | **High** — the limiter is per-process and does not survive horizontal scale (ADR 0004), and there is no WAF or upstream rate limit | Shared-store rate limiting before multi-instance; provider-side spend cap (**Engineering + Ops, Phase 3**; acceptance: limit holds across two instances in a load test) |
| T1.6 | Enumeration of accounts via signup/login/reset responses | **I** | — | **Medium** — response differences not audited | Uniform responses and timing for existent vs non-existent accounts (**Engineering, Phase 2**; acceptance: test asserts indistinguishable responses) |
| T1.7 | Clickjacking | **T** | `X-Frame-Options: DENY`, CSP `frame-ancestors` | **Low** | — |

### TB-2 — Application → datastore

| ID | Threat | S T R I D E | Current control | Residual | Action |
|---|---|---|---|---|---|
| T2.1 | SQL injection | **T E I** | Parameterised queries throughout; the repository refuses unknown table names | **Low** — but note the repository composes `WHERE` fragments supplied by callers, so a caller interpolating user input into a predicate would reintroduce it | Lint rule or test forbidding template-literal interpolation into SQL (**Engineering, Phase 2**; acceptance: a deliberately-injected fixture fails CI) |
| T2.2 | **Cross-tenant read/write** | **I E** | Repository ANDs `tenant_id`; 18 application attack cases; Postgres RLS with 12 attack cases, CI-blocking | **High** — *the controls are not on the request path*. Product call sites use `data()` directly, SQLite has no RLS, and nothing sets `app.tenant_id` yet | ADR 0013 §3/§5 — plumbing landed 2026-08-27; **call-site migration outstanding** (**Engineering, Phase 3**; acceptance: no product write reaches `data()` outside `withTenantTransaction`, enforced by test — gate **G3**) |
| T2.3 | Encryption key compromise → full disclosure | **I** | `EMDR_DATA_KEY` in environment; AES-256-GCM per field | **High** — key sits beside the session secret and the data it protects; no envelope encryption, no HSM/KMS, no rotation procedure | Secret manager + documented rotation (**Ops, Phase 2**; acceptance: rotation rehearsed on synthetic data with a re-encryption path proven) |
| T2.4 | Insider/operator reads member data | **I R** | Audit log records application-level access | **High** — an operator with database access bypasses the application entirely and leaves no application audit trail | Database-level audit + least-privilege operator roles (**Ops + Security, Phase 3**; acceptance: direct database reads appear in a log the application cannot alter) |
| T2.5 | Tampering with clinical history to conceal a decision | **T R** | Hash-chained audit log (ADR 0005); event log append-only; **on Postgres the application role is granted only SELECT/INSERT on `longitudinal_events` and `audit_log`** | **Low→Medium** — strong once on Postgres; today SQLite grants no such separation | Complete the Postgres cutover (**Phase 3**, gate G6) |

### TB-3 — Application → model provider

| ID | Threat | S T R I D E | Current control | Residual | Action |
|---|---|---|---|---|---|
| T3.1 | **Member trauma narrative disclosed to / retained by the provider** | **I** | TLS; server-side key; nothing member-controlled selects what is sent | **High** — no BAA, no zero-retention terms, and the full decrypted transcript crosses this boundary (item 1 §4) | BAA + zero-retention addendum **before any real participant** (**Founder + Counsel, Phase 2**; acceptance: executed BAA on file, retention terms documented in the vendor register) |
| T3.2 | Prompt injection via member-authored content | **T E** | System prompt explicitly frames member data as data, not instructions; memory injection is deterministic (the model cannot request memories); output passes `safety/companion-guard` before display; tool set is fixed and narrow | **Medium** — instruction-level defences are probabilistic; the meaningful control is that tools are narrow and output is validated | Red-team suite extension covering injection via memories, trigger notes, and safety-plan fields (**Security, Phase 2**; acceptance: cases added to `tests/safety-redteam.test.ts` and CI-blocking) |
| T3.3 | Model output causes clinical harm (unsafe advice, missed risk) | **I** | Deterministic guard validates output; banned-vocabulary CI gate; crisis routing is deterministic and never model-decided; escalation is a fixed tool | **Medium** | Clinical review of the guard's failure modes as part of the rescoped sign-off (**Clinical, Phase 5**) |
| T3.4 | Provider account compromise → historical prompt disclosure | **I** | — | **High** without zero-retention | Same as T3.1; additionally prefer a provider offering no-training and short retention |
| T3.5 | Cost abuse via automated conversation | **D** | Rate limit; kill switch | **Medium** | Provider-side spend cap (**Ops, Phase 2**) |

### TB-4 / TB-5 — Backups and email

| ID | Threat | Current control | Residual | Action |
|---|---|---|---|---|
| T4.1 | Backup disclosed at rest | `age` encryption before upload; bucket credentials in environment | **Medium** — no BAA with the storage provider; key custody undocumented | BAA + documented key custody (**Founder + Ops, Phase 2**) |
| T4.2 | Backup cannot be restored when needed | Scheduled backup with failure alerting | **High** — **restore has never been rehearsed** against a production-shaped dataset | Rehearse restore end-to-end (**Ops, Phase 3**; acceptance: gate **G6** — restore + audit-chain verification pass) |
| T4.3 | Member content leaked via alert email | Alerts carry backup status only, no member content | **Low** | Keep a test asserting no member identifiers in alert bodies |

### TB-6 / TB-7 — Operator and supply chain

| ID | Threat | Current control | Residual | Action |
|---|---|---|---|---|
| T6.1 | Hosting account takeover | Platform account controls | **High** — MFA enforcement, access review, and offboarding are not evidenced | Document and evidence: MFA required, access list reviewed quarterly, offboarding checklist (**Founder, Phase 2**; acceptance: screenshot/attestation in the controlled workspace) |
| T6.2 | Malicious or compromised dependency reads `process.env` | `npm audit` gate blocking high/critical; `gitleaks` secret scanning; lockfile committed | **Medium** — a postinstall script or a compromised transitive package has full environment access at runtime | Pin and review dependency updates; consider runtime secret fetch so keys are not resident in `process.env` (**Engineering, Phase 3**) |
| T6.3 | Unreviewed code reaches the deploy branch | CI gates on push | **High** — `main` is not protected, PRs are not required, and three branches are force-synced by hand | Protect `main`, require PRs and green checks (**Founder, now** — founder action #7; acceptance: branch protection visible in settings) |
| T6.4 | Secret committed to the repository | `gitleaks` workflow | **Low** | — |

---

## Part B — Abuse cases

STRIDE does not surface the harms specific to a trauma-support product. These are the ones
that matter most, and several have no technical control at all — which is itself the
finding.

| ID | Abuse case | Why it matters here | Current control | Action |
|---|---|---|---|---|
| A1 | **A coerced member is monitored by an abuser** who has device or account access | Trigger maps and safety plans name the abuser and the member's escape strategies. This is the highest-severity realistic harm in the product. | Session expiry; no current control for shared-device or coerced access | Quick-exit control, no-history mode, and a documented "someone may be watching" pathway (**Product + Clinical, Phase 4**; acceptance: reviewed by the clinical reviewers as part of the rescoped sign-off) |
| A2 | **A member in crisis is failed by an unavailable human** | Steady is available at 3am; clinicians are not. The product must never imply real-time human monitoring. | System prompt forbids implying a human is watching; crisis surfaces are never gated on subscription, tier, or a successful write | Coverage hours must be stated in consent (**Clinical decision #3**, workflow spec §12) |
| A3 | **Clinician over-reach** — reading members outside a legitimate care relationship | A clinician account today can read every member in the instance | Audit log records reads | Caseload scoping (**Engineering + Clinical, Phase 4**; acceptance: out-of-caseload request returns not-found and is audited) |
| A4 | **Member self-harm using the product's own content** — reading back their own trauma narrative while activated | Timeline and memory surfaces present accumulated distressing material | Deterministic gating governs sessions; no gating on reading one's own history | Review whether historical content needs its own readiness gate (**Clinical decision, Phase 4**) |
| A5 | **Re-identification from "de-identified" analytics** | Behavioural time-series with rare instrument combinations is highly identifying even without names | No analytics zone exists yet — the safest possible state | Any analytics design requires a documented re-identification assessment **before** it is built (**Security + Clinical, Phase 6**) |
| A6 | **A member's data is subpoenaed or demanded** | Trauma narratives are legally sensitive; members will ask | No documented process | Legal process policy, and disclose it in the privacy policy (**Counsel, Phase 2**) |
| A7 | **Withdrawal of consent is ineffective** because history is immutable | ADR 0010 makes history append-only *by design*; erasure rights are in tension with it | Consent withdrawal is recorded as an event; data is retained | **This tension must be resolved by counsel, not engineering.** Define what withdrawal deletes, what it tombstones, and what is retained under what basis (**Counsel + Engineering, Phase 2**; acceptance: written determination, then a tested implementation) |
| A8 | **A member is misled about what the AI is** | Members in distress form attachments to conversational systems | Banned-vocabulary CI gate; system prompt forbids therapist framing; product copy reviewed | Keep the banned-vocabulary gate blocking; extend to companion output samples in the red-team suite |
| A9 | **Demo or investor session uses real data** | The fastest way to turn a governance gap into a breach | Gate **G10**: only fabricated data, no exceptions for demonstrations | Keep `EMDR_DEMO` data fabricated and clearly labelled; never point a demo at a participant environment |

**A7 is the one most likely to be discovered late.** The event spine's central property —
history is never erased — is in direct tension with erasure rights the product will owe. It
is cheaper to decide the policy now, while all history is fabricated, than after a real
member asks.

---

## Part C — Findings ranked for the reviewer

The order a security reviewer should care about, combining residual risk and how hard each
is to fix later.

| # | Finding | Risk | Must be closed before |
|---|---|---|---|
| 1 | No BAA with the model provider, which receives full trauma transcripts (T3.1, T3.4) | High | Any real participant |
| 2 | Tenant isolation controls are not on the request path (T2.2) | High | Any second tenant |
| 3 | Data key and session secret co-located in the application environment (T1.1, T2.3) | High | Any real participant |
| 4 | Backup restore never rehearsed (T4.2) | High | Pilot (gate G6) |
| 5 | Clinician sees all members; no caseload scoping (A3) | High | Pilot |
| 6 | `main` unprotected; unreviewed code can deploy (T6.3) | High | Immediately — costs nothing |
| 7 | Consent-withdrawal vs immutable-history policy undecided (A7) | High | Any real participant |
| 8 | Operator database access unaudited (T2.4) | Medium-High | Pilot |
| 9 | Rate limiting does not survive horizontal scale (T1.5) | Medium | Multi-instance deploy |
| 10 | Coerced-member / shared-device abuse case unaddressed (A1) | Medium-High | Pilot |

---

## Part D — What would change these ratings

Stated so the reviewer can check whether the model is still valid when they read it:

- **Any real participant data entering any environment** invalidates the framing in the
  scope statement and raises every confidentiality finding to active.
- **A second tenant existing anywhere** makes T2.2 an active exposure rather than a latent
  one.
- **Multi-instance deployment** makes T1.5 active and breaks the in-process rate limiter.
- **The clinical surface shipping** activates A3 and A4 and adds egress paths not modelled
  here.
- **Any new external service** requires a new TB row, a vendor-register entry, and a BAA
  assessment before it is called with member data.
