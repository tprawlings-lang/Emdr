# Steady — Supervised Trauma Care Support (Phase 1 prototype)

An EMDR-informed, **clinician-supervised** web platform for adults with trauma-related
symptoms, built to the architecture in the *Executive Plan for a Supervised Autonomous
EMDR-Based Web App for Complex PTSD*.

> **This is a development prototype.** It is not a medical device, has not been cleared
> for clinical use, and must not be offered to real patients without clinical governance
> sign-off, legal/regulatory review (HIPAA, FTC, FDA claims analysis), and production-grade
> security. It is **not for emergency use** — US users in crisis should call/text 988 or 911.

## Product posture (from the executive plan)

The product thesis is **not** "autonomous therapist." It is a *supervised autonomous care
workflow*: the software automates screening, preparation, skills practice, measurement,
and pacing, while a **licensed specialist** owns eligibility, unlocking of
trauma-processing modules, safety planning, escalation, referral, and discharge.

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
point it at this repo, and apply. The free tier works (ephemeral disk = auto-reseeding demo).

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

## Known gaps before any real-world use (Phase 1 exit criteria)

- Real identity provider with **AAL2 MFA** for all roles; step-up auth for exports and overrides; session idle timeouts.
- HIPAA-grade hosting (BAA, KMS envelope encryption, private networking), SIEM feed, encrypted backups.
- Clinical governance: protocol sign-off by licensed EMDR specialist + psychiatric advisor; claims language review (FDA/FTC); state licensure plan.
- Crisis operations: on-call clinician queue with SLAs, 988/emergency routing tested, SAFE-T/C-SSRS clinician workflow.
- Telehealth video, SMART on FHIR/EHR integration, tokenized payments (PHI-isolated).
- WCAG 2.2 audit, penetration test, incident-response and retention policies.
