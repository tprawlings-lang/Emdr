# Compliance status — wellness-lane launch gates

Tracks the pre-launch compliance handoff packet item by item.
Legend: ✅ done in code · 🟡 partial (see note) · 🔴 open — founder/external
dependency, cannot be closed by code in this repo.

## Item 1 — Identity & authentication
| Req | Status | Notes |
|---|---|---|
| 1.1 Managed auth provider (Clerk/Auth0/etc.) | 🔴 | Requires a provider account + migration. Current auth is scrypt-hashed passwords + HMAC-signed cookies — sound interim crypto, but the packet's launch gate is a managed provider. |
| 1.2 Optional TOTP 2FA | 🔴 | Comes with the managed provider (1.1). |
| 1.3 Session expiry 30d absolute / 7d idle | ✅ | Cookie maxAge 7d; 30d absolute via signed issue timestamp. Cookies Secure/HttpOnly/SameSite=Lax. |
| 1.3 15-min idle re-lock on session-history views | 🔴 | Deferred; natural to add with the managed-auth migration (password/biometric re-entry). |
| 1.4 Email password reset (single-use, 30-min tokens) | 🔴 | Requires an email provider; none configured. No security questions exist. |
| 1.5 Lockout: 10 fails → 15-min lock | 🟡 | Implemented at app layer from the audit trail. Email notice needs the email provider; edge rate limiting is a platform setting. |
| 1.6 Admin MFA, separate realm | 🔴 | With managed auth (1.1). No internal admin panel exists today; clinician role is demo-gated by access code. |

## Item 2 — Hosting, encryption & data architecture
| Req | Status | Notes |
|---|---|---|
| 2.1 TLS 1.2+, HSTS, no mixed content | ✅ | Render terminates TLS; HSTS + security headers set on all routes. Run SSL Labs against the production domain before launch and file the screenshot. |
| 2.2 Encryption at rest (platform default) | 🟡 | Render persistent disks are encrypted at rest by default — verify in the dashboard and screenshot for the records folder. |
| 2.3 DB not publicly reachable | ✅ | SQLite on the service's private disk; no database port exists at all. Secrets live in Render env vars, not the repo. |
| 2.4 Data minimization + app-layer encryption of free text | 🟡 | No diagnosis/medication/clinical-history fields collected. All member free text (chat, memory values, trigger notes, safety plan, screener answers) is AES-256-GCM encrypted with EMDR_DATA_KEY. **Open architecture question:** chat transcripts ARE persisted (encrypted) to power conversation continuity — the packet's "no verbatim emotional content" stance needs a founder decision: keep encrypted transcripts, or summarize-and-discard. |
| 2.5 Log discipline | 🟡 | App logs carry event types/ids only; audit detail_json holds no free text. No CI lint for it yet. |
| 2.6 Backups | 🔴 | Render disk snapshots are automatic; restore test must be performed and documented before launch. |
| 2.7 No third-party pixels | ✅ | Zero marketing pixels, zero analytics, no ad trackers anywhere (page-by-page audit: there are no third-party scripts at all). Keep it that way for authenticated pages. |

## Item 3 — Positioning, claims & legal posture
| Req | Status | Notes |
|---|---|---|
| 3.1 Banned vocabulary | ✅ | Copy sweep done; CI grep blocks cure/heal-your/treats-X/AI-therapist/clinically-proven. |
| 3.2 Structure/function rule | ✅ | Research section claims the method with citations; product copy describes mechanics only. |
| 3.3 Testimonials policy | ✅ | Stories are experience-only, labeled illustrative, with the required "individual experiences vary" line. |
| 3.4 Footer disclaimer all routes; 988 banner on signup/session/companion; logged consent checkbox | ✅ | Footer is in the root layout; checkbox is never pre-checked and logged as wellness-ack-v1 with timestamp. |
| 3.5 Attorney-finalized ToS/Privacy | ✅ | Final v1.0 live at /terms and /privacy — reviewed and approved by counsel 2026-06-10 (per founder). All packet-required clauses present; privacy policy describes only implemented behavior; disputes section uses a courts-based clause (no arbitration). Signup logs acceptance (terms_acceptance / tos-v1.0). Any wording change requires re-review and a version bump. |
| 3.6 Clinical advisor (recommended) | 🔴 | Needed to upgrade "modeled on professional practice" copy and sign off screener + crisis scripts. |

## Item 4 — Crisis safety system (full build)
| Req | Status | Notes |
|---|---|---|
| 4A Fitness screener | 🟡 | Live: 8 items, one per screen, unskippable, coded values (encrypted), versioned (fit-v1-placeholder), hard-stop warm exit, 24h cooldown, anti-gaming copy, DOB gate at signup. **Wording/thresholds are placeholders pending advisor sign-off.** |
| 4A.1 Hard stop + automatic refund | ✅ | Membership canceled and last charge refunded automatically, no contact required; care-team alert raised. |
| 4B.1 Ground-me button | ✅ | Fixed, high-contrast, one tap, no confirmation; halts stimulation instantly and runs scripted grounding. |
| 4B.2 SUDs rules | ✅ | 8+ or +3 rise → pause/ground/choose; 9+ → hard stop; end ≥8 → 24h processing cooldown (stabilization stays open). |
| 4B.3 Companion language rules + caps | ✅ | Deterministic crisis regex pre-filter runs before any model call with a versioned scripted interrupt; NEVER rules in the system prompt; 35-min wind-down/45-min cap; 1 processing session per 24h. Script wording pending advisor review. |
| 4B.4 Safety event log | ✅ | Coded events (type, timestamp, session id — no content) in the audit trail under family `safety`. |
| 4C Region-aware resources | ✅ | Config with owner + last-verified dates (US/UK/CA/AU + findahelpline fallback), tap-to-call/text links, "not monitored in real time" wherever resources appear. **Verify dial intents on real iOS/Android devices before launch.** |
| 4D @safety tests, red team, kill switch | 🟡 | 9-test @safety suite is CI-blocking; kill switch (EMDR_DISABLE_NEW_SESSIONS) implemented — demonstrate in staging. Red-team day not yet performed. |

## Item 5 — Payments
| Req | Status | Notes |
|---|---|---|
| 5.1 Stripe hosted checkout (SAQ-A) | 🔴 | Demo billing provider only; Stripe account + integration needed. Architecture already isolates billing from program data. |
| 5.2 No health context to processor; discreet descriptor | 🟡 | Holds by construction today (no processor). Enforce "STEADY MEMBERSHIP" descriptor at Stripe setup. |
| 5.3 Trial/cancellation hygiene | 🟡 | Cancel is 2 clicks from settings, immediate, no contact needed. Pre-charge reminder email needs the email provider. |
| 5.4 Safety-refund path | ✅ | Automatic on screener hard stop; tested end-to-end. |

## Item 6 — Accessibility, security testing, policies
| Req | Status | Notes |
|---|---|---|
| 6.1 WCAG self-audit (axe-core CI, keyboard/screen-reader pass, contrast) | 🔴 | Not yet run; sage-on-cream button contrast must be measured (likely fix needed). |
| 6.1 Photosensitivity | ✅ | Dot oscillates ≤ ~0.6 Hz (far below 3 flashes/sec; no flashes at all), speed control exists, audio-only bilateral mode ships and is the default for members with the seizure soft-flag; prefers-reduced-motion respected on marketing animation. |
| 6.2 Dependency scanning / ZAP / gitleaks / IDOR pass | 🟡 | Server actions consistently scope queries by the session user (spot-checked); enable Dependabot in repo settings; ZAP + gitleaks runs not yet performed. |
| 6.3 IR runbook + cyber insurance | 🟡 | Runbook merged (docs/incident-response.md). Insurance quote is a founder action. |
| 6.4 Deletion + retention | ✅/🟡 | Self-serve immediate deletion at /settings/account (no reason required); 24-month retention sweep script (scripts/retention-sweep.ts) — needs a schedule (Render cron) and the 30-day warning email needs the email provider. |

## Open founder dependencies (cannot be closed from this repo)
1. ~~Retain an attorney (3.5)~~ — ✅ done: counsel reviewed and approved ToS/Privacy 2026-06-10. Keep counsel available for re-review on any wording change.
2. Retain an **EMDR-trained clinical advisor** (3.6/4A) — screener wording, crisis scripts, session scripts.
3. **Managed auth provider** account + migration (1.1/1.2/1.6).
4. **Email provider** (password reset, lockout notices, pre-charge reminders, retention warnings).
5. **Stripe** account (5.1–5.3) with discreet statement descriptor.
6. **Cyber liability insurance** quote (6.3).
7. Decision: **encrypted chat transcripts vs summarize-and-discard** (2.4).
8. One-day **red-team pass** + accessibility audit day (4D/6.1); SSL Labs + backup-restore evidence for the records folder (2.1/2.2/2.6).
