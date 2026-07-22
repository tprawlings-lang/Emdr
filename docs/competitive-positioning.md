# Competitive positioning — the knowledge system vs. Abby.gg

**Standing directive from the founder (2026-07):** we are competing with
Abby.gg. Their marketing: an AI-therapy chat "trained on 7,800 psychology
texts." Keep this competitor in view in every design decision about the
companion and the knowledge system.

## The honest architecture argument (why we don't chase 7,800 texts)

"Trained on N texts" is a marketing frame, not an architecture. Steady's
companion runs on a frontier LLM whose pretraining already spans a psychology
literature orders of magnitude larger than any curated list — **every serious
AI companion starts from roughly the same knowledge ocean.** The race is not
whose model has read more; it's **who governs what surfaces, when, for whom.**

That is exactly what Steady's knowledge system is:

| | Abby-style ("trained on N texts") | Steady |
|---|---|---|
| Knowledge | Implicit in the model, uninspectable | Model knowledge **+ explicit, versioned KB** (`src/lib/therapy-kb/`) |
| What surfaces when | Model's judgment per reply | **Deterministic selector**: tier, activation, dissociation, imagery capability, restricted topics — same inputs, same selection |
| Clinical review | Trust us | **Clinician signs off every modality and every constraint row**; catalog is git-diffable |
| Output safety | Model alignment | Model alignment **+ deterministic output guard** (red-team tested paraphrase families) + scripted crisis flow in front of the model |
| Session structure | Chat only | Chat **+ guided EMDR program** (modules, BLS, SUDS-gated session engine) |
| Memory | Opaque | 6-class taxonomy, exposure policy enforced at retrieval, member-visible and deletable |

**The pitch in one line:** *Abby read the library; Steady read the library and
then let a clinician decide what may be said to whom, and can prove it.*
For a trauma population, governed breadth beats raw breadth — and governed
breadth is defensible to clinicians, counsel, and app-store reviewers.

## "Always relevant, never go find it" — already the architecture

The founder asked that the knowledge stay relevant at all times without
anyone having to go look things up. That is how it's built: on **every
companion reply**, `buildSystemPrompt` runs the deterministic selector over
the member's live state (tier, today's check-in, current message, trigger
map, memories) and injects the cleared techniques automatically as advisory
vocabulary. There is no lookup step, no search UI, no stale index — the
retrieval *is* the reply path. It behaves like the system's own in-house
model layer: the LLM supplies fluency; the KB supplies **what it is allowed
to reach for right now.**

## Comprehensiveness roadmap (the actual competitive build)

Current: 16 modalities (founder's 12-modality reference sheet + EMDR lane +
3 supplemental), 27 techniques. Target state: **deep coverage per modality,
grown through a pipeline, never by bulk-pasting text.** Every stage is
clinician-gated — that gate is the moat, not the bottleneck.

1. **Technique depth** — grow to ~8–15 techniques per modality (≈150–250
   total), authored from the clinician corpus + standard clinical manuals,
   each with tier/ceiling/contraindications like today.
2. **Modality principles layer** — a short "how this modality thinks" block
   per modality, injectable when any of its techniques is selected, so the
   companion's framing (not just its move) matches the modality.
3. **Psychoeducation cards** — plain-language explainers (what a flashback
   is, why avoidance grows, window of tolerance) surfaced by the same
   selector; competes directly with "trained on texts" claims in a way
   members actually feel.
4. **Authoring pipeline (keeps it comprehensive AND current):**
   draft entry → CI automatically runs the guard self-check + catalog
   integrity tests → clinician verdict in the Autonomous Review console
   (`KB_MODALITY_*` rows) → ships. A new technique is a pull request, not a
   retraining run — the KB updates in hours and the sign-off register always
   reflects exactly what's live.
5. **Outcome loop (later, the real differentiator):** correlate selected
   techniques with post-reply settling (check-ins, SUDS trajectories) so the
   catalog earns its keep empirically — "our techniques are measured, not
   just cited."

## Marketing-truth constraint

Never claim "trained on N texts" — our legal posture is that every public
claim describes what the code actually does. The claimable version, all true
today: *"Every response is governed by a clinician-reviewed technique
library and a deterministic safety system — and we can show you both."*
