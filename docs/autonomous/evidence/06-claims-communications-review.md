# Claims & communications review

**Config:** `beta-clinrev-2026-07` · Ledger §E gate 8 ("preparation-only scope
consistent across all channels"). **Reviewed:** 2026-07-22.

Audits member-facing and legal copy for consistency with the ratified scope:
**education / preparation / grounding only — not therapy, not medical care, no
diagnosis, no autonomous trauma-memory reprocessing.**

## Method
Reviewed the scope-bearing surfaces: `README.md`, `COMPLIANCE.md`,
`src/lib/policy.ts` (consent/ToS/privacy copy), the finalized program-fit gate
wording (`PROGRAM_FIT_GATE_WORDING`), and the dashboard/marketing route copy.

## Consistent ✅
- **README** front-matter: "self-guided wellness program … not therapy, not
  medical care, no diagnosis or treatment claims," 988 crisis note, "development
  prototype … not for emergency use."
- **COMPLIANCE.md**: wellness-lane posture; footer disclaimer on all routes; 988
  banner on signup/session/companion; logged wellness-ack consent; attorney-
  finalized ToS `tos-v2.0` / Privacy `privacy-v1.0`; 18+ strict; **no named-
  condition claims**.
- **Program-fit gate (`fit-v2-clinrev`, A8)**: states plainly it "does not
  diagnose, determine readiness for trauma processing, or replace a licensed
  clinician" — fully aligned with the revision.
- **Consent copy** (`policy.ts`): "not therapy, medical care, or a substitute for
  professional treatment; it does not diagnose or treat any condition; …does not
  create a clinician-patient relationship."

## Finding — 1 item (✅ RESOLVED 2026-07-22)

**F-1 (medium) — RESOLVED: consent body described "processing difficult
memories," which read as trauma reprocessing.** Counsel approved the Option B
rewrite; applied to `policy.ts` with `CONSENT_VERSION` → `v2.1-wellness`. Detail
below and in [`06a-F1-consent-copy-proposal.md`](06a-F1-consent-copy-proposal.md). `src/lib/policy.ts` (consent version
`v2.0-wellness`) currently says the program is *"for processing difficult
memories and reducing emotional intensity."* Under the clinical-review revision,
beta performs **no autonomous trauma-memory reprocessing** and is
preparation/grounding-only. "Processing difficult memories" is inconsistent with
that scope and could read as a treatment/reprocessing claim.

- **Recommended change:** reword to preparation/grounding framing, e.g. *"for
  building grounding and stabilization skills and preparing for difficult
  memories,"* removing "processing … memories / reducing emotional intensity."
- **Constraint:** `policy.ts` copy is counsel-finalized (`tos-v2.0` /
  `privacy-v1.0`); per COMPLIANCE.md any wording change **requires counsel
  re-review and a version bump**. So this is a **founder + counsel** action, not
  an engineering edit. Flagged here rather than changed unilaterally.
- **Drafted rewrite:** a counsel-facing redline (before/after, two options,
  version + re-consent notes) is at
  [`06a-F1-consent-copy-proposal.md`](06a-F1-consent-copy-proposal.md).
- **Related:** the broader "waiting for your specialist's review" microcopy and
  the "specialist review" claims across marketing/dashboard/ToS are already
  tracked as a separate founder handoff (README §14.4 / §10) and must flip to
  rule-based / preparation language **with** any autonomous-copy activation.

## Open (tracked elsewhere, not re-litigated here)
- Branded domain + support email placeholder in ToS §16–17 (cosmetic; COMPLIANCE).
- The autonomous `*-autonomous` ToS/privacy/consent versions are staged
  flag-aware and only serve when `EMDR_AUTONOMOUS_SAFETY` flips.

## Disposition
Scope is consistent across channels **except F-1**, which needs a counsel-
approved wording change + version bump before Phase-2 activation. No other
preparation-only inconsistency found.
