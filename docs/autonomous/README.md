# Autonomous system — clinician-designed build

Working documents for building Steady's autonomous/deterministic system from the
five-volume clinician-authored corpus (Volumes I–V). **Demo/beta only; every safety-relevant
value and every human-in-the-loop checkpoint is gated on independent licensed clinician
sign-off.**

| Doc | What it is |
|---|---|
| [`00-clinical-synthesis.md`](00-clinical-synthesis.md) | How the corpus maps onto the built system; the deterministic-core rule; the build sequence. |
| [`01-signoff-ledger.md`](01-signoff-ledger.md) | The checklist the clinician walks: unresolved numeric conflicts, safety rules to ratify, human-in-the-loop checkpoints, validation gates, scope guardrails. |

**The one rule underneath everything (all five volumes agree):** safety decisions are
deterministic and verified; the AI companion is advisory only and is structurally prevented
from making, reversing, or clearing any safety decision. "Increasing uncertainty must reduce
intervention intensity." Autonomy here means *more deterministic automation of
clinician-validated rules* — never *the AI deciding more*.
