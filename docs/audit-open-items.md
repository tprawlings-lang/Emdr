# Open items — needs founder decision or action

Running handoff list from the production-readiness audit. Everything here is
**not** code I can finish alone: it needs a decision only you can make, an
external account/service, or a real-world drill. Code-addressable gaps have been
implemented separately (see the audit-remediation commits). Grouped by type;
severity is 🔴 launch-blocking / 🟡 important / ⚪ nice-to-have.

Last updated: 2026-09 (CSP development divergence added to §A).

## A. Decisions — RESOLVED

- [x] **ADR 0007 — scaling / zero-downtime deploys.** ✅ **Decided: fix now.**
  Founder approved starting the Postgres → shared-store → multi-instance
  migration. ADR 0007 now Accepted. In progress — see §E below.
- [x] **Companion transcripts (COMPLIANCE 2.4).** ✅ **Decided: keep encrypted
  persistence** (current behaviour — supports continuity + safety review, already
  encrypted at rest and deleted on account deletion). No change.
- [x] **CSP `'unsafe-inline'` → nonce.** ✅ **Decided: harden now — done.**
  Nonce-based CSP shipped (ADR 0008); `'unsafe-inline'` removed from script-src.
- [ ] **🟡 Autonomous-model claim rewrite** (README §10). ⏳ **Founder will send a
  handoff for this later** — leaving the wording untouched until then.
- [ ] **🟡 CSP `'unsafe-eval'` in development — needs a conversation.** ⏳ **To
  discuss.** React's development build calls `eval()` and Next's dev server opens
  a hot-reload websocket; under the production policy both are blocked with *no
  visible error* — the page renders, hydration never completes, and every client
  component on the site is inert. Buttons do nothing, forms never open. That cost
  us an afternoon of believing a form was broken when the header was.

  Shipped as a narrow fix: `contentSecurityPolicy()` in `src/proxy.ts` adds
  `'unsafe-eval'` to `script-src` and `ws: wss:` to `connect-src` **only** when
  `NODE_ENV !== "production"`, and `tests/csp.test.ts` asserts the production
  string contains neither, that exactly those two directives differ between the
  two policies, and that no environment variable can weaken it.

  **What to decide together:** whether a development-only divergence in the
  security header is acceptable at all, given that it means the policy we test
  against locally is not the policy we ship. The alternatives are (a) keep it,
  (b) run local work against a production build, which costs hot reload, or
  (c) a `Content-Security-Policy-Report-Only` dev header so the dev policy is
  the production one and violations are logged rather than enforced. My
  recommendation is (a) with the tests as written, but it is a security posture
  question and it should be your call.

  Related and separate: Next 16 dev refuses `_next/static` chunks when the
  browser addresses the server as `127.0.0.1` ("Blocked cross-origin request to
  Next.js dev resource"). Use `http://localhost:3000` when driving the app, or
  set `allowedDevOrigins` in `next.config.ts`. No product change was made for
  this — it is a harness quirk, not a policy.
- [x] **Render instance plan.** ✅ Staying on `starter` (always-on, persistent
  disk). No action.

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

- [x] **🔴 EMDR-trained clinical advisor sign-off** — ✅ **DONE (with conditions),
  2026-07-22.** Two independent licensed psychologists (Altschuler PSY-005804, Allen
  PSY-002055) ratified config `beta-clinrev-2026-07` — screener wording (now
  `fit-v2-clinrev`), crisis script, session scripts, and all autonomous safety rules
  (all Agree / Confirm). Signed: `docs/autonomous/clinician-signoff-SIGNED-2026-07-22.pdf`.
  Conditions: the §C/§E evidence drills below + no autonomous BLS in beta.
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

## E. Zero-downtime migration (ADR 0007) — in progress

Founder approved "fix now". Sequenced so the app keeps working at each step; the
big cutover (step 1) is destructive-capable and needs a paid Postgres DB, so it
gets its own go-ahead before flipping.

- [ ] **Step 1 — datastore → Postgres.** Needs a provisioned Postgres (Render
  Postgres, ~$/mo). Largest step: port the better-sqlite3 (synchronous) data
  layer to an async Postgres client, keeping the schema + queries behind a
  data-access seam. **Founder action:** approve provisioning the Postgres
  instance (cost) so I can begin.
- [ ] **Step 2 — shared rate-limit store (Redis/Upstash).** Replace the
  in-memory limiter so limits hold across instances.
- [ ] **Step 3 — externalize the backup scheduler** (Render Cron or leader
  election) so it fires once across instances.
- [x] **Step 4 — concurrency-safe audit append** — **done.** `audit()` takes a
  transaction-scoped Postgres advisory lock before reading the chain tip, so the
  hash chain stays intact under multiple concurrent writers (empty-table/genesis
  case covered; SQLite unaffected — single-writer).
- [ ] **Step 5 — set `numInstances ≥ 2`** → Render does rolling, zero-downtime
  deploys automatically.
