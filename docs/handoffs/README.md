# Handoffs — the build order

These are the founder-authored specifications that drive the build, **numbered in the order
they were issued and in the order they should be read.** Each one supersedes nothing; they
layer. Where a later handoff contradicts an earlier one, the later wins and the difference
should be recorded rather than silently resolved.

> **Handoff 05 reviewed the repository at commit `c39447a` — the commit immediately before
> the six feature commits handoff 04 produced.** It therefore describes a product without
> the member score boundary, the one-family type system, navigation, the patient directory,
> or the paced gate. Several of its findings read as reversals of handoff 04 but are more
> accurately gaps in the snapshot it saw. The two that were treated as real decisions are
> recorded in [`../site/gui-decisions.md`](../site/gui-decisions.md), each with the
> rationale it overrides and the steps to revert.

They were uploads during working sessions and lived only in a session folder, which meant a
new context window could not find them. They are committed here so the specification
travels with the code.

| # | Handoff | Governs | Status |
|---|---|---|---|
| 01 | [Platform readiness and ADR 0010 Step 5](01-platform-readiness-and-adr0010-step5.pdf) | The ten go/no-go gates, the cutover window, the phase order (Phase 1 definition → Phase 2 security → Phase 3 data spine → Phase 4 clinical → Phase 5 pilot → Phase 6 payer → Phase 7 public) | **Phases 1, 2, 4 done.** Phase 3 (Postgres cutover + Step 5) held for its gated window |
| 02 | [Demo-first execution](02-demo-first-execution.pdf) | Making the environment demonstrable: deterministic seed, reset, scenario scripts, demo labelling, persona indicator, clinical policy modes | **Done** — [`../demo/completion-matrix.md`](../demo/completion-matrix.md). Two findings deferred by decision (F3, F4) |
| 03 | [Institutional website redesign](03-institutional-website-redesign.pdf) | The public surface: audience pages, one claims registry, Trust Center, Evidence, FAQ, the review gateway, demo legal copy, the copy guard | **Done** — [`../site/release-acceptance.md`](../site/release-acceptance.md) |
| 04 | [Presentation layer v1](04-presentation-layer-v1.pdf) | How data, gating, routing, and processing are rendered. The member score boundary, day states, the gate, the session flow, the visual system, component contracts | **◐ In progress** — [`../site/presentation-layer.md`](../site/presentation-layer.md). §§2, 3, 4, 5, 7, 8 done. **§6 is next and not started** |
| 05 | [GUI and decision-surface](05-gui-and-decision-surface.pdf) | How events, measures, gates, summaries, and audit history become screens people can act on. Role views, the presentation contract, gate states, components, tokens, charts, and the build order | **◐ In progress** — [`../site/gui-decisions.md`](../site/gui-decisions.md). Phase 0 and Phase 1 landed; Phases 2–5 open |

## Reading order for a fresh context window

1. **[`../../README.md`](../../README.md) — the RESUME HERE block at the top.** It names
   the next build item and the guards that will fail if you break a decision.
2. **Handoff 04 §6** — the session state machine. That is the next thing to build, and §6
   is roughly two pages.
3. **[`../site/presentation-layer.md`](../site/presentation-layer.md)** — what handoff 04
   already produced and, more usefully, *why* each rule exists. Read this before changing
   anything on a member surface.
4. Only then the older handoffs, and only if the work reaches back into them.

## The rule that governs all four

Every one of these documents restates it, so it is worth stating once here:

> No real participant data, public access, care operations, payer data exchange, or
> employee-health use until the required review gates pass. Any real-person information
> found in a T0/T1 environment is a stop condition.

And on claims: never "HIPAA compliant", "clinically validated", "secure", or "approved" as
a general label — dated evidence and exact scope instead. Do not quote a test count,
security control, clinical review, or branch state to a reviewer unless it ties to the
exact demonstration commit.
