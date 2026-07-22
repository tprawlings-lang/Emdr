# Privacy/security review & human-factors testing — scope & plan

**Config:** `beta-clinrev-2026-07` · Ledger §E gates 4 and 5.

These two gates **cannot** be produced from the codebase. Gate 4 requires an
independent security/privacy professional (the corpus is explicit that it must
**not** be inferred from the clinical design); gate 5 requires real users. This
document scopes both so they can be commissioned and executed — it is a plan, not
a result. Nothing here should be read as a completed review.

---

## Gate 4 — Independent privacy/security review (needs external party)

**Objective:** an independent, qualified professional attests to the privacy and
security posture, separate from the people who designed the clinical system.

**Scope to hand the reviewer:**
- **Data at rest:** field-level encryption of free text (`EMDR_DATA_KEY`),
  encrypted companion transcripts (decided: retained, deleted on account
  deletion), what is and isn't stored (audit records are content-free/coded).
- **Data in transit / headers:** TLS/HSTS posture, nonce-based CSP (ADR 0008,
  `unsafe-inline` removed), the `middleware`/proxy security headers.
- **Audit integrity:** the SHA-256 hash chain + advisory-lock serialization
  (`docs/autonomous`/`audit.ts`) as a tamper-evidence control.
- **Auth posture:** interim scrypt + signed cookies + login lockout + idle/
  absolute session caps (pending the managed auth/MFA provider).
- **Secrets handling:** env-guard fatal secrets, R2/age backup keys (public key
  only on server), key-rotation implications for `EMDR_DATA_KEY`.
- **Boundary:** voice/biometric data — on-device recognition, raw audio never
  uploaded; confirm the shipped-build story.

**Existing automated evidence to share (not a substitute):** gitleaks secret
scanning, `npm audit`, Dependabot, the axe-core WCAG gate.

**Deliverable expected back:** a signed report with findings by severity and a
remediation list; critical/high findings block Phase-2 entry.

**Suggested executors:** an application-security firm or an independent
appsec/privacy consultant; optionally an OWASP ZAP scan + SSL Labs record for the
production domain as supporting artifacts.

---

## Gate 5 — Human-factors testing (needs real users)

**Objective:** confirm members understand the scope, can recover from
interruptions, and behave safely under stress — the corpus requires
comprehension, interruption recovery, and behavior-under-stress testing.

**Protocol to run (moderated, small N, IRB-style consent):**
1. **Comprehension:** after onboarding, can participants correctly state that
   Steady is education/preparation, not therapy, not emergency help, and that a
   human reviews certain restrictions? (target: high comprehension; misreads
   feed copy changes.)
2. **Interruption recovery:** interrupt a grounding exercise (navigate away,
   background the app, lose network) and confirm the member can re-orient and the
   session state resumes safely (locked stays locked).
3. **Stop-control salience:** confirm participants can find and use the Ground-Me
   / stop control at any time without instruction.
4. **Crisis-route clarity:** confirm the present-safety clarification + 988 /
   jurisdiction-aware resources are understood and reachable under simulated
   distress, with truthful notification status (never implying a human was
   contacted unless confirmed).
5. **Distress de-escalation:** observe that a rising-distress path routes to
   grounding/closure and the member reports feeling steadier, not pushed.

**Deliverable expected back:** a findings report with comprehension rates,
recovery success, and any copy/UX changes required; blocking issues gate Phase-2.

**Note:** because beta runs **no autonomous BLS**, human-factors testing focuses
on grounding/stabilization/education flows and the crisis pathway — not on
processing sessions (which don't run).

---

## Status
Both gates are **open and require outside execution.** They are the primary
remaining blockers (with the Part-4 documents above accepted) before the founder
can consider Phase-2 activation per the
[staged-validation protocol](05-staged-validation-protocol.md).
