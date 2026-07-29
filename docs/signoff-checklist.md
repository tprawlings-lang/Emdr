# Sign-off & gate checklist (consolidated)

One page, three buckets: **(1)** signatures/decisions still needed, **(2)** gates that
need *execution* + evidence + reviewer acceptance, **(3)** work already built or scoped
that is deliberately ON HOLD until a signature lands. Sources: README §14,
`docs/autonomous/01-signoff-ledger.md`, `docs/autonomous/evidence/README.md`,
`docs/autonomous/bls-validation/README.md`, `docs/audit-open-items.md`.

Already signed (for reference): clinical ratification of `beta-clinrev-2026-07`
(2 licensed psychologists, 2026-07-22, *with conditions*); BLS Part-6 plans + processing
consent (clinical + counsel); voice/biometric consent `voice-consent-v1.0`; autonomous
ToS/privacy/consent rewrite (staged, flag-aware).

---

## 1. Sign-offs & decisions still needed

### Counsel
- [ ] 🔴 **Wellness-lane posture with the human gate removed** — explicit written
  confirmation before autonomy governs a real member (June-2026 handoff named the
  live-clinician gate non-negotiable; it must be lifted in writing). README §14.7-3.
- [ ] 🔴 **EMDRIA policy / "EMDR" trademark & self-administered-processing exposure** —
  the clinicians made the *clinical* call (staged desensitization permitted); the
  policy/legal exposure question was explicitly left to counsel
  (`bls-validation/README.md`).
- [ ] 🟡 **Terms re-pass for three-tier billing** — Terms §10 now describes Base/Plus/
  Premium + the 7-day Premium trial; auto-renewal and trial-conversion language is
  consumer-protection sensitive and was engineering-drafted, not counsel-reviewed.

### Clinicians (review-console register rows)
- [ ] 🔴 **`LIVE_SESSION_*`** — live spoken sessions (hands-free responder) before any
  non-demo enablement. README §14.4.
- [ ] 🟡 **`VOICE_INPUT_*`** — confirm the recorded rows cover the shipped behavior
  (README says the remaining step is the flag flip; verify the register agrees).
- [ ] 🟡 **`KB_*`** — therapy-KB modality list is *provisional* pending the founder's
  reference sheet, then clinician acceptance of the final list.
- [ ] 🔴 **Autonomous BLS/stimulation** — a *separate, later* sign-off after the Part-6
  gates are executed; `autonomousStimulationEnabled` stays `false` until it exists.
- [ ] 🟡 **Evidence-package acceptance** — gates 2, 3, 6, 8, 9 are drafted
  (`docs/autonomous/evidence/`) and need the reviewers to formally accept them.
- ⚠️ Standing condition: **any material change to `beta-clinrev-2026-07` resets the
  clinical sign-off.** (The pricing/Autopilot work did not touch the safety config;
  Autopilot only consumes `checkModuleAccess`.)

### Founder
- [ ] 🔴 **Autonomous-model claim rewrite handoff** (§14.3) — marketing/FAQ/dashboard/
  module copy still promises human review; must be rewritten before the flag governs.
- [ ] 🔴 **Therapy-KB modality reference sheet** → unblocks the `KB_*` row above.
- [ ] 🟡 **Natural session voice decision** (§14.6) — human actor vs pre-rendered neural
  TTS, and how to handle the personalized calm-place word.
- [ ] 🟡 **Postgres cutover go-ahead** — provision Render Postgres, approve the one-time
  data load + flip, then `numInstances ≥ 2` (audit-open-items §E; code-complete).
- [ ] 🟡 **Verify competitor pricing against live pages** before public launch — the
  tier analysis (README §8.4) is from training-data snapshots.
- [ ] ⚪ CODEOWNERS handle confirm · own the generated Render secrets · enable branch
  protection (audit-open-items §D).

---

## 2. Gates that need testing/execution AND sign-off

### Autonomous-engine evidence gates (ledger §E / form Part 4 — the reviewers' explicit condition)
- [ ] 🔴 **Gate 4 — independent privacy/security review** by qualified external
  professionals (handoff packet ready:
  `docs/autonomous/evidence/08-security-review-handoff-packet.md`). Includes the
  companion red-team pass, ZAP scan, SSL Labs record.
- [ ] 🔴 **Gate 5 — human-factors testing** of the session UI (stop-control salience
  under stress) — real participants + report; scoped in
  `07-privacy-security-and-human-factors-plan.md`, needs external execution.
- [ ] 🟡 **Gate 7 — staged validation Phases 1→4** — protocol drafted; must be
  *executed* during pilot with its pre-registered progression/stopping criteria.

### BLS Part-6 gates (plans approved 2026-07-22; execution outstanding)
- [ ] 🔴 **Human-factors testing on the BLS flow** — plan approved; needs participants,
  a UX researcher, and a results report.
- [ ] 🔴 **Red-team closure on BLS paths** — scenario set approved; ~6 scenarios
  runnable now against the FSM, the rest need the built feature; all must close.
- [ ] 🔴 **Phase-4 staged rollout execution** — pre-registered: 4a cohort 12 → 14-day
  window + review → 4b cohort 6 → 4c cohort 12; stop on any protocol-related
  clinically meaningful worsening; AE ceiling 0 serious, any SAE pauses.
- [x] Processing-session consent — clinical + counsel approved and wired
  (`processing-consent-v1.0`).

### Pre-flip artifact
- [ ] 🔴 **Shadow-vs-live divergence report walk** — `GET /api/clinician/divergence` is
  built; the walk-through with the reviewers (especially every
  "engine-more-permissive" row) must happen before `EMDR_AUTONOMOUS_SAFETY=1`.

### Ops drills (need accounts, then produce evidence)
- [ ] 🟡 **Backup-restore drill** (`make restore-test`) once R2 vars are set — proves
  RPO 24h / RTO ~1h.
- [ ] 🟡 **Load test against real staging** (k6 on the deployed instance; local
  thresholds don't transfer to 0.5-CPU starter).
- [ ] 🟡 **SSL Labs record** for the production domain (needs the branded domain).

---

## 3. Built/scoped work ON HOLD until a sign-off lands

| On-hold item | Blocked by |
|---|---|
| **Flip `EMDR_AUTONOMOUS_SAFETY=1`** (staged: gating first, then session-runtime) | Evidence gates 4+5 · claims rewrite · counsel posture confirmation · divergence walk |
| **Product microcopy rewrite** ("waiting for your specialist's review" → rule-based language in `gating.ts` + dashboard) | Deliberately deferred to ship *with* the flag flip |
| **Session-runtime / session-UI engine wiring** (beyond module gating) | Gating stage proving out post-flip |
| **Autonomous BLS** (`autonomousStimulationEnabled=true`) | Part-6 execution + its own separate clinician sign-off (stays OFF through beta — signed condition) |
| **Live spoken sessions for real members** (`EMDR_LIVE_SESSION` flip) | `LIVE_SESSION_*` clinician sign-off |
| **Voice input for real members** (`EMDR_VOICE_INPUT` flip) | Register confirmation + founder flip |
| **Therapy-KB expansion / final modality list** | Founder reference sheet → `KB_*` sign-off |
| **Natural-voice audio layer** (manifest + `playLine()` + pre-rendered clips) | Founder §14.6 voice-source decision |
| **Marketing/FAQ/dashboard claim rewrite** | Founder handoff (§14.3) |
| **Postgres cutover + `numInstances ≥ 2`** (zero-downtime deploys) | Founder provisioning go-ahead (cost) |
| **Push-notification delivery for Autopilot outreach & F13/F15/F16 (Watch, HealthKit)** | Paid Apple Developer account (founder) — outreach is honest in-app-only until then |

### External accounts (founder actions, not sign-offs — they gate the drills above)
- [ ] 🔴 Managed auth + MFA provider · [ ] 🔴 Email provider (Resend key) ·
  [ ] 🔴 Stripe (three prices + Premium trial) · [ ] 🟡 Cloudflare R2 + age key ·
  [ ] 🟡 Cyber-liability insurance quote · [ ] ⚪ Branded domain + support email ·
  [ ] 🟡 Paid Apple Developer account (push / Watch / HealthKit)

---

*Severity: 🔴 blocks real-member/autonomous use · 🟡 resolve before/at pilot · ⚪ track.*
*Last updated: 2026-07-29.*
