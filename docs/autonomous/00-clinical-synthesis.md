# Steady Autonomous System — Clinical Design Synthesis

**Status: DRAFT for review. Demo/beta only. Nothing here ships to real users until an
independent licensed trauma clinician (≥2 per Vol I) walks the system and signs off.**

Source: the five-volume clinician-authored corpus (Volumes I–V, 835 pp.), read in full
July 2026. Per-volume digests live alongside this file. This synthesis maps that corpus
onto the system already built, states what must be enforced deterministically, and hands
the open decisions to the sign-off ledger (`01-signoff-ledger.md`).

---

## 1. The one architectural rule the whole corpus insists on

Every volume, independently, mandates the **same** architecture — and it is the one we
already agreed to:

> **Safety decisions are deterministic and verified. The AI is advisory only and is
> structurally prevented from making, reversing, or clearing any safety decision.**
> "Increasing uncertainty must *reduce* intervention intensity." (Vol I A-9, B-3;
> Vol II §0; Vol III §1.5; Vol IV hierarchical control; Vol V Ch.5/Ch.10.)

Concretely, this is a **three-layer control model** (Vol IV / Vol V):
1. **Immutable safety rules** — deterministic, non-overridable, outside the model.
2. **Clinical/educational guardrails** — expert-approved, versioned.
3. **Adaptive policy (the LLM companion)** — personalizes *presentation* within the space
   the two layers above permit. "A language model may generate activating content, but a
   permission filter prevents delivery."

**Implication for "make it more autonomous":** autonomy = *more deterministic automation
of the clinician-validated rules*, with the LLM kept firmly inside the rails. It does **not**
mean the LLM makes more decisions. The most dangerous possible misreading of "autonomous"
here is "let the AI decide" — the corpus forbids exactly that.

---

## 2. How the corpus maps onto what we've already built

Good news: the bones exist. Much of the corpus has a home in the current schema.

| Corpus concept (vol) | Already in the system | Gap to build |
|---|---|---|
| Deterministic gating hierarchy (II §0) | `gating.ts`, screener gates, `module_unlocks` | Replace ad-hoc gating with the **permission-intersection engine** + machine-ID rules |
| Instruments & scoring (II §1) | `screenings`, PC-PTSD-5/PCL-5/ITQ/PHQ-9/GAD-7 present | Add **DES-II** (pending advisor), ITQ criteria logic, weekly-trend worsening rules, item-level safety (PHQ-9 q9, PCL-5 q16) |
| Program-fit screener (II §2) | `fitness-screener.ts` (8 items, hard-stop/soft-flag) | Rework to **state vs trait** hard-stops, support-contact reversal, auto-refund |
| Daily check-in routing (II §3) | `checkins`, `submitCheckin` recommended_action | Align inputs/thresholds to spec; **narrow-only same-day**; add dissociation/shutdown |
| Readiness score/track (II §4) | `readiness_assessments`, tracks | Implement the (to-be-resolved) formula + **caps as the real safety mechanism** |
| Session SUDS/BLS safety (II §5–7) | — (no session-runtime engine yet) | Build the **session state machine**, SUDS rules, Ground-Me, closure, BLS timing/limits |
| Cooldowns/re-entry/longitudinal (II §8) | partial (`module_unlocks`) | Absolute-time cooldowns, re-entry gate, pattern detection, no permanent score |
| Crisis routing (II §9) | `/crisis`, `acknowledgeCrisis`, safety events | Deterministic crisis dispositions, one-tap resources, non-clearable state |
| Companion memory (IV/V) | `ai_memory_items`, `ai_companion_preferences` | Extend to the **6-class taxonomy + provenance + graceful decay + full member controls** |
| Companion interaction (IV/V) | `companion-ai.ts` (system prompt, tool loop, rules fallback) | Add the **20-stage request lifecycle**, candidate→validate→display gate, guardrail injection |
| Journey (V Ch.4) | signup→…→dashboard pipeline | Promote to an explicit **22-stage orchestration layer** with per-transition owners |
| Audit (I B-5, V) | hash-chained `audit_log` | Extend to log **every access-affecting routing decision** with the required fields |
| Governance/deployment (V Pt.5) | ADRs, CI gates, flags (informal) | Config-as-code, kill switches, staged pipeline, safety-core isolation |

**So the build is mostly: harden the deterministic core to spec, extend the companion's
memory/interaction to spec, and add the session-runtime + orchestration layers — all behind
flags, all on the conservative beta config.**

---

## 3. What the deterministic engine must enforce (beta config)

Where the spec conflicts (see ledger), **beta uses Volume II §12 "Conservative Initial Beta
Configuration"** — the clinician's own stated launch config, which resolves conflicts on the
safe side:

- 3 tracks (grounding / cautious / steady); expanded disabled.
- BLS fixed 1.0 or 1.25 Hz; **auditory + self-tapping only, no visual BLS** in beta.
- **Max 2 stimulation sets**; starting-SUDS ceiling 5; daily dissociation ≥4 blocks stimulation.
- Mandatory 120 s closure; **one activating session per operational day**.
- Delayed post-session check-in + protocol-defined **human oversight** (not autonomous
  escalation) during beta.

Non-conflicting hard rules enforced from day one (Vol I/II): permission intersection (most
restrictive wins); crisis = 1 indicator → immediate, deterministic, non-clearable; PHQ-9 q9
≥1 and PCL-5 q16 ≥3 → 72 h stabilization + safety question; daily-route first-match
narrow-only; Ground-Me one-tap local stop; missing safety input never defaults favorably;
absolute-time cooldowns; closure is a first-class object; every state change → immutable
audit event; `≤3 flashes/sec` WCAG ceiling on any visual.

---

## 4. Companion (Vol IV + V) — structure to build, inside the rails

- **Memory = 6 classes** (Account, Educational, Preference, Procedural, Provider,
  Safety/Audit), each with its own retention/visibility/permissions; every memory row
  carries **provenance** (source, stated-vs-inferred, confidence, dates, who-may-access,
  *may-influence-safety?*) and a **decay policy** (state fast, preferences slow+editable,
  sensitive episodic auto-expires unless pinned). Full member controls: view / correct /
  export / delete (immediate functional deletion; backups never resurrect deleted data).
- **Interaction = candidate→govern.** The LLM only ever proposes; a deterministic validator
  decides display. Every generation prompt injects boundaries, current uncertainty,
  prohibited claims, required options, length. Language guardrails (no asserted internal
  states, no simulated feelings, calibrated uncertainty, no diagnosis, proportionate).
- **Learning = bounded.** Interaction state ≠ clinical state; consequence must match
  confidence (low confidence → reversible presentation changes only, never lockout/provider-
  notify/permanent memory); reward on comprehension/independence, never engagement; no
  experimentation on safety-relevant behavior.
- **Optimization hierarchy, enforced in architecture:** safety > autonomy > comprehension >
  continuity > engagement. The "40% more engagement but more dependency" feature is rejected
  by design.

## 5. Journey orchestration (Vol V Ch.4–5) — the "map the whole journey" idea, done safely

Promote the existing pipeline to an explicit **22-stage journey** with a **control plane**:
each request runs the 20-stage lifecycle; each stage transition has a named owner; the
orchestrator *personalizes within* deterministic gates and **consumes** the risk engine's
structured output — it never invents escalation. This is exactly the "AI maps the complete
journey, not just a companion" strategy — and the corpus already designed it as a governed
orchestration layer, not an autonomous decider. Feasible and additive.

---

## 6. Proposed build sequence (all demo/beta, flag-gated, sign-off-pending)

1. **Deterministic safety core** — permission-intersection engine + machine-ID rule table
   (Vol II §13) + immutable audit of every routing decision. *(Foundation; everything gates
   on it.)*
2. **Screening/scoring to spec** — instruments, item-level safety, program-fit state/trait,
   daily-route narrow-only, readiness caps. *(Beta config where conflicted.)*
3. **Session-runtime state machine** — SUDS/Ground-Me/closure/BLS limits (auditory + tapping
   only in beta). *(New subsystem.)*
4. **Companion memory + interaction hardening** — 6-class memory, provenance, decay, member
   controls; candidate→validate→display; guardrail injection.
5. **Journey orchestration layer** — 22-stage model, per-transition owners, control plane.
6. **Governance scaffolding** — config-as-code, kill switches, staged-deploy gates, the
   red-team/regression suites the corpus specifies.

Each step ships behind a flag (default off in anything resembling production), is validated
against the sign-off ledger, and adds tests mirroring the corpus's acceptance criteria.

---

## 7. The honest caveat

This corpus is explicitly a **"disciplined hypothesis," unsigned, review-pending.** It says
so on its own first page and repeatedly: every threshold is provisional, nothing deploys
without independent clinical review + staged validation (Phases 1–4). Our job now is to
**build the structure faithfully in demo/beta** so the clinician has a real system to walk
through — not to treat any number as final. Every safety-relevant value and every point where
a human could be removed from the loop is captured in `01-signoff-ledger.md`.
