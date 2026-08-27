# Steady platform strategy archive

This folder preserves the planning documents that govern Steady's expansion from the current wellness prototype into Steady Personal, Steady Clinical, and Steady Intelligence.

## Documents

1. **Steady Engineering Executive Summary**  
   Narrative overview of the product destination, longitudinal architecture, nine-phase roadmap, learning model, governance requirements, and estimation baseline.

2. **Steady Master Engineering Handoff Series A to E**  
   The architecture handoff sequence:
   - A: Foundation and Steady Personal
   - B: Personal Intelligence and Steady Clinical
   - C: Enterprise and Population Infrastructure
   - D: Navigation and Population Learning
   - E: Outcomes, Cost, and Orchestration

3. **Steady Future Platform VC**  
   Investor narrative connecting today's companion and safety product to the future longitudinal behavioral-health platform, enterprise distribution, payer value, and outcome intelligence.

## Working rule

Design from Handoff E backward and implement from Handoff A forward. The current application remains a prototype. Nothing becomes available to consumers or the public until the applicable clinical, security, privacy, legal, and operational review gates are completed.

These PDFs are preserved as supplied. Future revisions should be added with clear version dates rather than silently replacing prior planning history.

## Where the current codebase stands against this plan

[`gap-analysis.md`](gap-analysis.md) maps the shipping application item-by-item against
Handoff A — what already satisfies it (typed memory, deterministic safety ordering,
validated instruments, hash-chained audit, consent ledger, Postgres, the test suite),
and the seven architectural conflicts that need Architecture Decision Records, ordered
by cost-of-delay. The three most urgent — no event sourcing, no tenancy, and person
identity conflated with account identity — are inexpensive to fix now and very
expensive once production history accumulates.

It also records two consequences that are easy to miss: the consumer pricing tiers
become one channel rather than the thesis, and the pivot is a material scope change
against the signed `beta-clinrev-2026-07` clinical configuration, which needs
re-scoping at the next clinician session.

