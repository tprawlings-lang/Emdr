# Autonomous system — clinician-designed build

Working documents for building Steady's autonomous/deterministic system from the
five-volume clinician-authored corpus (Volumes I–V). **Demo/beta only; every safety-relevant
value and every human-in-the-loop checkpoint is gated on independent licensed clinician
sign-off.**

| Doc | What it is |
|---|---|
| [`00-clinical-synthesis.md`](00-clinical-synthesis.md) | How the corpus maps onto the built system; the deterministic-core rule; the build sequence. |
| [`01-signoff-ledger.md`](01-signoff-ledger.md) | The checklist the clinician walks: unresolved numeric conflicts, safety rules to ratify, human-in-the-loop checkpoints, validation gates, scope guardrails. |

**Build status:** all six steps of the build sequence are implemented in
[`src/lib/safety/`](../../src/lib/safety/) — deterministic core, scoring, session-runtime
engine, companion memory + output guard, journey orchestration, and governance — pure and
tested (~112 unit tests + a red-team harness), deployed in **shadow mode** (governs
nothing). The clinician validates and signs off via the **Autonomous Review console**
(`/clinician/autonomous`): simulate gating and sessions, test companion messages, review
real shadow decisions, and record Agree / Needs-change per rule (CSV export). Governance
turns on only via `EMDR_AUTONOMOUS_SAFETY=1` after sign-off, one stage at a time.

**The one rule underneath everything (all five volumes agree):** safety decisions are
deterministic and verified; the AI companion is advisory only and is structurally prevented
from making, reversing, or clearing any safety decision. "Increasing uncertainty must reduce
intervention intensity." Autonomy here means *more deterministic automation of
clinician-validated rules* — never *the AI deciding more*.
