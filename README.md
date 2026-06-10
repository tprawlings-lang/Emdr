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
| Baseline screening: PC-PTSD-5, PCL-5, PHQ-9, GAD-7 (public-domain instruments, automatic risk-item routing) | ✅ |
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

## Stack

Next.js (App Router, server actions) · TypeScript · Tailwind CSS · better-sqlite3.
No ad-tech, no analytics pixels, no third-party trackers — by design.

## Known gaps before any real-world use (Phase 1 exit criteria)

- Real identity provider with **AAL2 MFA** for all roles; step-up auth for exports and overrides; session idle timeouts.
- HIPAA-grade hosting (BAA, KMS envelope encryption, private networking), SIEM feed, encrypted backups.
- Clinical governance: protocol sign-off by licensed EMDR specialist + psychiatric advisor; claims language review (FDA/FTC); state licensure plan.
- Crisis operations: on-call clinician queue with SLAs, 988/emergency routing tested, SAFE-T/C-SSRS clinician workflow.
- ITQ instrument (ICD-11 complex PTSD framing), telehealth video, SMART on FHIR/EHR integration, tokenized payments (PHI-isolated).
- WCAG 2.2 audit, penetration test, incident-response and retention policies.
