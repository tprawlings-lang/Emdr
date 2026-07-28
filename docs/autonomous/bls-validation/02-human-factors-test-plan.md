# Human-factors test plan — BLS session flow

**Status:** protocol ready for clinician approval. **Execution pending** (needs real
participants — a signature approves the *plan*, not the results). Part-6 gate 1.

**Objective.** Confirm that real users, using the self-guided BLS session with **no
clinician present**, (a) understand what it is and isn't, (b) can stop and recover
safely, and (c) are steadied rather than pushed by the flow. Grounded in the
research finding that the core documented risk is incomplete processing /
re-dissociation without a live clinician.

**Design.** Moderated, observed sessions; small N (≈8–12); informed consent;
**exclude high-risk participants** (dissociation screen, active crisis) up front —
the same exclusions the product applies. Use non-personal / low-intensity target
material for testing, not real trauma, unless a clinician supervises.

## Tasks & what we measure

| # | Task | Pass condition |
|---|---|---|
| 1 | **Comprehension** — after the consent + intro, ask the participant to state what this is. | Correctly says: not therapy, no clinician present/watching, they can stop anytime, session always closes with grounding. |
| 2 | **Stop-control salience** — mid-set, without prompting, ask them to stop. | They find and use the one-tap stop unaided; stimulation halts immediately and stays off. |
| 3 | **Interruption recovery** — background the app / drop network mid-set. | Session does not silently continue or lose state; on return it is stopped/closed safely; a locked session stays locked. |
| 4 | **Distress de-escalation** — script a rising-SUDS path. | Flow routes to containment/grounding/closure; participant reports feeling *steadier, not pushed*; no pressure to continue. |
| 5 | **Closure comprehension** — at end. | Participant is oriented to the present and reports a stability check occurred; understands the memory need not feel "finished." |
| 6 | **Crisis clarity** — simulated distress cue. | Present-safety + resources are understood and reachable; no implication a human was contacted. |

## Stopping criteria (blocking — protocol fails, do not proceed)
- Any participant cannot find/use the stop control mid-set.
- Any session continues stimulation after a stop, or loses state on interruption in
  an unsafe way.
- Any participant leaves a session more activated with no closure having run.
- Systematic misunderstanding that a clinician is present/monitoring.

## Deliverable
A findings report: comprehension rates, stop-control success, recovery success,
de-escalation observations, and any required copy/UX changes. Blocking issues gate
Phase-4. Clinician + a UX researcher review the results.
