# 0001 — Launch in the wellness lane, not the medical/HIPAA lane

**Status:** Accepted

## Context
Steady is a self-guided EMDR-*method* program. Positioning it as medical
treatment would pull in HIPAA, FDA SaMD, and state telehealth licensing.

## Decision
Ship as a **wellness** product: no diagnosis, no treatment claims, structure/
function language only, enforced by a CI banned-vocabulary gate. Regulatory
frame is FTC Act §5 / Health Breach Notification Rule and state consumer-health
privacy laws (WA My Health My Data, CCPA/CPRA), **not** HIPAA. GDPR applies if
EU users are admitted.

## Consequences
- Claims discipline is a launch gate, not a nicety (see COMPLIANCE.md).
- Moving to clinician-gated care (see the June 2026 build handoff) is a
  deliberate reclassification requiring counsel sign-off, not a silent change.
- The planned fully-autonomous model (README §10) must not break wellness-lane
  claims — every "specialist review" promise gets rewritten in that release.
