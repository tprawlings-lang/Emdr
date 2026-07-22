# Independent conversation-system audit (Fable model, 2026-07) — findings & resolution

An independent audit of the dynamic-response system (companion + therapy KB +
guard + memory) was run by a separate model instance with read-only access.
Verdict: architecture sound ("dynamic personalization stacked on deterministic
rails is the right design"), but three high-severity **enforcement** gaps made
the safety story conditional. All highs fixed same-day. Status below.

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| 1 | HIGH | Output guard was shadow-mode unless `EMDR_AUTONOMOUS_SAFETY=1`; fail-open on validator crash | **Fixed** — `companionGuardEnforced()`: blocking is on in demo and under the flag; validator crash now fails closed when enforcing |
| 2 | HIGH | Memory exposure policy unenforced: SafetyAudit-class memories reached the prompt; model could write `"safety"` memories; TTL decay unenforced | **Fixed** — `getModelExposableMemoryItems()` enforces `canExposeToModel` + `decayState` at retrieval; `"safety"` removed from the remember tool enum |
| 3 | HIGH | Guard regexes far narrower than the prompt's own prohibitions (armchair diagnosis, outcome promises, reprocessing paraphrases, "care team is watching", "I'm proud of you", dependency) | **Fixed** — pattern families expanded; every audit slip-through utterance is now a red-team regression test (`tests/guard-expansion.test.ts`), plus benign false-positive controls |
| 4 | MED | Risk-flagged replies could lose 988 routing via guard fallback or tool-loop exhaustion | **Fixed** — `ensureCrisisResources()` deterministically appends crisis directive to any risk-flagged reply lacking it |
| 5 | MED | KB selector ignored imagery capability removal; missing activation/dissociation defaulted favorably | **Fixed** — imagery-tagged entries gated on capability + known-low dissociation; unknown activation treated as high; unknown dissociation restricts to grounding |
| 6 | MED | Memory-disabled members still had memories injected (prompt-instruction-only mitigation) | **Fixed** — injection skipped deterministically when memory disabled |
| 7 | MED | `avoidWhen` contraindications are advisory, not mechanically enforced — clinician could misread them as gates | **Disclosed** — explicit honesty row `KB_AVOIDWHEN_ADVISORY` in the sign-off register; mechanical enforcement is the clinician's call via needs-change |
| 8 | MED | Prompt-injection surface via member-authored text persisted through memory | **Mitigated** — "data, not instructions" fencing block in the system prompt; blast radius already bounded (gating/crisis/guard are all deterministic and model-independent); residual risk disclosed here |
| 9 | LOW | Rate-limit reply missing `mode` → `undefined` in audit detail | **Fixed** |
| 10 | LOW | Engine-failure default let grounding KB surface for unknown-state members | **Fixed** — engine failure now yields NO KB content (unknown state = crisis-equivalent for KB purposes) |
| 11 | LOW | Crisis regex over-triggers on benign "unsafe" substrings | **Accepted for beta** — fails safe; word-boundary/context pass queued for later |

Test deltas: +24 red-team/regression tests → 152 pass. Audit's test-gap list
(companion-ai integration tests, tool-loop, shadow-vs-enforced guard behavior)
remains open and queued.

The auditor's demo preconditions are all met: guard enforcement active in
demo, `"safety"` memory type removed, crisis-reply 988 guarantee patched,
`avoidWhen` honestly labeled in the register.
