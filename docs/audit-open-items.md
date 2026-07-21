# Open items — needs founder decision or action

Running handoff list from the production-readiness audit. Everything here is
**not** code I can finish alone: it needs a decision only you can make, an
external account/service, or a real-world drill. Code-addressable gaps have been
implemented separately (see the audit-remediation commits). Grouped by type;
severity is 🔴 launch-blocking / 🟡 important / ⚪ nice-to-have.

Last updated: 2026-07 (during audit remediation).

## A. Decisions to sign off (no external service needed)

- [ ] **🟡 ADR 0007 — scaling / zero-downtime deploys.** Each deploy currently
  causes ~30–60s of `502` (single instance). The fix is a sequenced migration
  to Postgres + Redis + ≥2 instances (`docs/adr/0007-...md`). Decide: accept the
  plan and when to start, or defer and accept deploy-window downtime for now.
- [ ] **🟡 Encrypted companion transcripts vs summarize-and-discard**
  (COMPLIANCE 2.4). Persist encrypted chat transcripts, or keep only distilled
  memory items and discard raw text? Affects data-minimization posture.
- [ ] **🟡 Autonomous-model claim rewrite** (README §10). The "planned fully
  autonomous" direction must not read as built. Confirm the wording / whether to
  keep the section.
- [ ] **⚪ CSP `'unsafe-inline'` → nonce** (ADR 0003). Accept the small residual
  XSS surface for now, or invest in nonce-based middleware.
- [ ] **⚪ Render instance plan.** You're on the Pro workspace; the service is on
  the `starter` instance (always-on, persistent disk — recommended to keep for a
  demo). Bump only if you want more headroom.

## B. External services to provision (then I can wire/verify)

- [ ] **🔴 Managed auth + MFA.** Pick an auth provider (TOTP 2FA, admin realm,
  password reset). Interim in place: scrypt + signed cookies, login lockout,
  idle/absolute session caps, "sign out everywhere".
- [ ] **🔴 Email provider (Resend or similar).** Set `RESEND_API_KEY` +
  `BACKUP_ALERT_EMAIL` (+ `BACKUP_ALERT_FROM`). Unblocks password reset, lockout
  notices, pre-charge reminders, retention warnings, and backup-failure alerts
  (alert path now has retry/backoff, ready once configured).
- [ ] **🔴 Real payments (Stripe).** Hosted checkout. Safety auto-refund and
  2-click cancel already work against the demo provider.
- [ ] **🟡 Off-site backups (Cloudflare R2 + age).** Set `R2_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
  `BACKUP_AGE_RECIPIENT` (public key only — the age **secret** key must never be
  on the server). Code is ready; backups are OFF until these are set.
- [ ] **🟡 Cyber liability insurance** quote (`docs/incident-response.md`).

## C. Drills & evidence to run (need infra/people)

- [ ] **🔴 EMDR-trained clinical advisor sign-off** — screener wording/thresholds
  (`fit-v1-placeholder`), crisis script, session scripts.
- [ ] **🟡 First backup-restore drill** — once R2 is set, run `make restore-test`
  (`docs/disaster-recovery.md`) to prove RPO 24h / RTO ~1h for real.
- [ ] **🟡 Load test against real staging** — re-run `k6`
  (`docs/load-test/steady-load.js`) on the deployed instance; today's discovered
  thresholds are from a local build on CI-class hardware and the deployed
  `starter` (0.5 CPU) will be lower. Then tighten the k6 threshold block.
- [ ] **🟡 Security evidence** — companion red-team pass; SSL Labs record for the
  production domain (verifies the TLS/HSTS posture end-to-end); optional ZAP
  scan. (gitleaks secret-scanning + `npm audit` + Dependabot are now automated.)
- [ ] **⚪ Branded domain + support email** — unblocks the ToS contact
  placeholder.

## D. Things I set that you should take ownership of

- [ ] **🔴 Confirm the CODEOWNERS handle.** `.github/CODEOWNERS` assigns reviews
  to `@tprawlings-lang` (inferred from the repo owner). Fix if that's not your
  GitHub username, or the required-review rule won't request the right person.
- [ ] **🟡 Own the Render secrets I generated.** To get the demo booting I
  generated and set `EMDR_DATA_KEY` (and the earlier `EMDR_SESSION_SECRET`) in
  the Render dashboard. Record these in your own secrets manager; rotating
  `EMDR_DATA_KEY` makes existing encrypted free text unreadable, so treat it as
  durable.
- [ ] **⚪ Enable branch protection** requiring the `safety`, `e2e`, and
  `gitleaks` CI checks before merge (needs repo-admin settings).
