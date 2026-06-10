# Steady — self-guided wellness program built on the EMDR method (prototype)

A calm, private, **self-guided wellness program** for adults: guided EMDR-based sessions,
daily readiness check-ins, grounding tools, an AI companion with member-controlled memory,
and engineered safety rails. Launching in the **wellness lane** (see
[`COMPLIANCE.md`](COMPLIANCE.md)): not therapy, not medical care, no diagnosis or
treatment claims.

> **This is a development prototype.** It is not a medical device and is **not for
> emergency use** — US users in crisis should call/text 988 or 911. Remaining launch
> gates are tracked item-by-item in [`COMPLIANCE.md`](COMPLIANCE.md).

## Product posture

The product thesis is **not** "AI therapist." Steady is purpose-built software: it guides,
paces, measures, and remembers, inside deterministic safety rails — a mandatory program-fit
screener, daily check-in gating, in-session distress rules with hard stops, scripted
crisis interrupts, and human review before higher-intensity modules unlock. Pacing always
belongs to the member; the safest path is the default.

## What's implemented

| Area | Status |
|---|---|
| Informed-consent stepper (versioned consent ledger, FSMB-style disclosures) | ✅ |
| Baseline screening: PC-PTSD-5, PCL-5, ITQ, PHQ-9, GAD-7 (public-domain instruments, automatic risk-item routing) | ✅ |
| ITQ with ICD-11 criteria-based scoring (PTSD / DSO clusters, complex-PTSD classification) | ✅ |
| Weekly outcome measures (PCL-5 + ITQ, 7-day cadence) with symptom trend charts for member and clinician | ✅ |
| Automatic clinician alert on sharp week-over-week symptom worsening (PCL-5 ≥ +10, ITQ ≥ +8) | ✅ |
| Daily check-in gate (<90s): activation, shutdown, safety, dissociation, sleep, substances → recommended action | ✅ |
| Gated 12-module program — modules 1–6 autonomous, 7–10 specialist-unlocked, 11–12 maintenance | ✅ |
| Session player: visual + audio bilateral stimulation, SUDS ratings between sets, micro-pauses, automatic hard-stop rules | ✅ |
| Post-session check: distress re-rate, orientation, safety, delayed-risk forecast, recovery plan | ✅ |
| Crisis screen: 988/911, grounding steps, no upsell, no unrelated links | ✅ |
| Clinician dashboard: queue-first risk alerts (severity-ordered), unlock requests with required documented reasons, member roster | ✅ |
| Member detail view: screening history, check-in trends, session outcomes, unlock history, consent ledger | ✅ |
| Append-only audit ledger (identity, consent, clinical, module runtime, specialist actions, security) + audit console | ✅ |

### Safety model

- **Hard stops** — SUDS ≥ 9, or a rise of ≥3 above baseline while elevated, ends the
  session, shows grounding, and queues an urgent/high clinician alert.
- **Check-in gating** — harm urge or feeling unsafe routes to the crisis screen and pauses
  all sessions; high dissociation limits the day to grounding modules; poor sleep or
  substance use downgrades intensity.
- **Risk items** — PHQ-9 item 9 (or PCL-5 item 16 elevated) never triggers an autonomous
  assessment; the app shows scripted safety options and queues same-day specialist review
  (SAFE-T / C-SSRS remain clinician-administered, per plan).
- **No hidden decisions** — every block reason is shown to the member, and every gating
  result, unlock decision, and alert review is written to the audit ledger with a reason.

## Running locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. SQLite data lives in `.data/` (gitignored).

**Demo accounts** (seeded on first run, development only):

- Member: `demo@example.com` / `demo1234`
- Clinician: `clinician@example.com` / `demo1234`

Suggested walkthrough: sign in as the member → consent → complete the four screeners →
daily check-in → run *Calm Place* → finish the post-session check → request an unlock for
a gated module → sign out, sign in as the clinician → review the queue, document a reason,
unlock.

## Deploying the demo

The repo ships a production `Dockerfile` (Next.js standalone output) plus configs for two
hosts. With `EMDR_DEMO=1` the app seeds a **rich fictional dataset** on first boot — a
member three weeks into the program with improving PCL-5/ITQ trends, a reviewed hard-stop,
a pending unlock request, and a second member sitting in the urgent risk queue — and shows
a "demonstration environment" banner with the login credentials. Data lives in
`EMDR_DATA_DIR` (`/data` in the container); without a mounted volume it resets and reseeds
on every restart, which is exactly right for a demo.

**Fly.io** (`fly.toml` included):

```bash
fly launch --copy-config --no-deploy   # pick your own app name
fly secrets set EMDR_SESSION_SECRET=$(openssl rand -hex 32)
fly deploy
```

**Render** (`render.yaml` included): create a new Blueprint in the Render dashboard,
point it at this repo, and apply. The blueprint provisions a starter instance with a
persistent disk at `/data`, so accounts and member data survive deploys; set
`ANTHROPIC_API_KEY` in the dashboard to enable the Claude-backed companion.

**Any Docker host:**

```bash
docker build -t steady-demo .
docker run -p 3000:3000 -e EMDR_SESSION_SECRET=$(openssl rand -hex 32) steady-demo
```

Demo walkthrough: sign in as the **clinician** first (`clinician@example.com` / `demo1234`)
to see the urgent risk queue and the pending unlock request; then as the **member**
(`demo@example.com` / `demo1234`) to run a check-in and a Calm Place session end to end.

## Stack

Next.js (App Router, server actions, standalone output) · TypeScript · Tailwind CSS ·
better-sqlite3. No ad-tech, no analytics pixels, no third-party trackers — by design.

## Known gaps before any real-world use (wellness-lane launch gates)

Steady launches as a self-guided **wellness** product, so the old health-lane checklist
(HIPAA/BAA hosting, AAL2 identity, telehealth, FHIR/EHR) no longer applies. What does
apply is tracked in full in [`COMPLIANCE.md`](COMPLIANCE.md); the items still open:

- **EMDR-trained clinical advisor** — the fitness screener (`fit-v1-placeholder`) wording
  and thresholds, the scripted crisis interrupt, and session scripts need advisor sign-off.
- **Managed auth provider** (Clerk/Auth0-class) — brings optional TOTP 2FA, admin MFA, a
  separate admin realm, and idle re-lock on session-history views. Current interim auth:
  scrypt-hashed passwords, signed cookies, 7-day-idle/30-day-absolute sessions, login
  lockout.
- **Email provider** — password reset, lockout notices, pre-charge trial reminders, and
  retention-deletion warnings all need outbound email.
- **Real payments** — Stripe hosted checkout (SAQ-A), `STEADY MEMBERSHIP` statement
  descriptor, pre-charge reminder. The automatic safety-refund path and 2-click cancel
  already work against the demo billing provider.
- **Security & accessibility evidence** — one-day red-team pass on the companion, WCAG 2.2
  self-audit (verify sage-on-cream contrast), ZAP baseline + gitleaks runs, backup-restore
  test, SSL Labs A screenshot for the records folder.
- **Cyber liability insurance** quote (the incident-response runbook in
  [`docs/incident-response.md`](docs/incident-response.md) is what insurers expect).
- **Founder decision** — keep encrypted companion transcripts (current architecture) or
  move to summarize-and-discard (compliance packet 2.4).

Already in place: wellness-lane claims discipline with a CI vocabulary gate, counsel-approved
ToS/Privacy (v1.0), the full crisis-safety system (screener, Ground-me button, SUDs rules,
session caps, kill switch, CI-blocking `@safety` suite), app-layer AES-256-GCM encryption of
member free text, zero third-party trackers, self-serve account deletion, and a 24-month
retention sweep.
