# BLS protocol — Part-6 validation package

The BLS protocol (`bls-protocol-v1-DRAFT`) was **approved for validation** by two
licensed psychologists on 2026-07-22
([signed](../bls-protocol-SIGNED-2026-07-22.pdf)). It may **not run for a real
member** until the four Part-6 gates below are complete + documented, and
`autonomousStimulationEnabled` stays `false` until then. This folder is that work.

## ✅ Part-6 review determination — SIGNED 2026-07-22

Signed by Altschuler (PSY-005804) + Allen (PSY-002055):
[`Part6-SIGNED-2026-07-22.pdf`](Part6-SIGNED-2026-07-22.pdf).

- **Scope: Desensitization permitted, *staged & supervised*** (not resourcing-only).
- **Overall: Part-6 plans + consent approved to proceed to execution**, no conditions.
- Consent (clinical), human-factors plan, red-team scenario set, and Phase-4 rollout
  **all four explicitly approved** (Part A ☒, Part B ☒, Part C ☒, Part D ☒);
  nothing added to the red-team set.
- **Pre-registered thresholds:** 4a cohort **12**; window before 4b **14 days +
  review**; stop-for-worsening = **any protocol-related clinically meaningful
  worsening (>0%)**; 4b/4c cohorts **6 / 12**; **AE ceiling: 0 serious, any SAE
  pauses rollout**.

**What this authorizes:** *executing* the plans + advancing the consent (counsel
legal pass still required). **What it does NOT do:** it does not complete the
human-factors or red-team gates (they require execution), and **no real-member BLS
session** may run until every Part-6 gate is executed, documented, and closed.
`autonomousStimulationEnabled` stays `false`.

> **Still open (not resolved by this clinical determination):** the EMDRIA-policy /
> "EMDR" trademark & claims question, and the reviewers' own EMDRIA standing re:
> self-administered processing — these belong in the **counsel** review, not the
> clinical sign-off. The clinicians made the clinical call to proceed staged;
> counsel still needs to weigh the policy/legal exposure.

## Gate status

| # | Part-6 gate | Deliverable | Approvable now? | Still needs |
|---|---|---|---|---|
| 1 | Human-factors testing on the BLS flow | [`02-human-factors-test-plan.md`](02-human-factors-test-plan.md) | **Plan — yes** | Real participants; a UX researcher; results report |
| 2 | Red-team closure on BLS paths | [`03-red-team-plan.md`](03-red-team-plan.md) | **Scenarios — yes** | Built feature to close all; ~6 runnable now vs the FSM |
| 3 | Processing-session consent + counsel review | [`01-processing-session-consent.md`](01-processing-session-consent.md) | ✅ **Clinical + counsel approved (2026-07-22)** | Wire it (`processing-consent-v1.0`) |
| 4 | Staged Phase-4 rollout + stopping criteria + kill switch | [`04-phase4-staged-rollout.md`](04-phase4-staged-rollout.md) | **Protocol — yes** | Pre-registered numeric thresholds; kill switch built |

## What the clinicians can approve *today* (with you, now)
- The **consent copy** (clinical review — counsel does the legal pass separately).
- The **human-factors test plan** (protocol design).
- The **red-team scenario set** (completeness — anything missing?).
- The **Phase-4 rollout + stopping criteria**, and **pre-register the numeric
  thresholds** (cohort sizes, worsening rate, window lengths) while they're in the room.

## What a signature CANNOT complete today
Human-factors testing and red-team closure require **execution** (real users; the
built feature). Approving the plans advances the gates; it does not close them.

## The question to put to them directly
The research brief found **EMDRIA policy "strictly forbids" self-administration of
EMDR**, and Shapiro warns of re-traumatization. The single most consequential
decision is whether Steady offers **self-administered desensitization at all**, or
scopes to **resourcing/stabilization** (Calm Place, container, grounding) — which
the evidence supports and which sidesteps the policy conflict. The Phase-4 plan is
built to do **resourcing-BLS first** and gate (or drop) desensitization on that
decision. Getting the clinicians' and counsel's answer here shapes everything
downstream.
