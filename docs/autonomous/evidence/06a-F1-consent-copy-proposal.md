# F-1 — Consent-copy rewrite (RESOLVED)

**Status:** ✅ **APPLIED — Option B, counsel-approved 2026-07-22** (per founder's
attorney). `src/lib/policy.ts` section "What this service is — and is not"
reworded; `CONSENT_VERSION` bumped `v2.0-wellness` → `v2.1-wellness`. Existing
members re-consent via the grandfather re-prompt at launch (runbook §2). The
before/after and rationale are retained below for the record.

**Source of the finding:** [claims & communications review, F-1](06-claims-communications-review.md).
**Config context:** `beta-clinrev-2026-07` — beta performs **no autonomous
trauma-memory reprocessing**; scope is education / preparation / grounding only,
and the program does **not** determine readiness for trauma processing (ratified
program-fit wording `fit-v2-clinrev`, ledger A8).

---

## The problem (one phrase)

`CONSENT_SECTIONS[0]` — section **"What this service is — and is not"** — currently
opens (emphasis added):

> "Steady is a self-guided wellness program for adults, built around the EMDR
> method, **for processing difficult memories and reducing emotional intensity.**
> …"

Two issues against the ratified scope:
1. **"processing difficult memories"** reads as trauma **reprocessing** — which
   beta does not do and which the program-fit gate explicitly disclaims.
2. **"reducing emotional intensity"** is an **outcome/benefit** claim that leans
   toward a treatment claim.

This is the only preparation-only inconsistency the claims review found; every
other section is consistent.

---

## Recommended rewrite

### Option A — minimal change (recommended)

Change only the first sentence and add a short scope clause to the existing
"is not" sentence. Everything else in the section is untouched.

**Before:**
> Steady is a self-guided wellness program for adults, built around the EMDR
> method, for processing difficult memories and reducing emotional intensity. It
> is software: it guides sessions, paces you with daily check-ins, and remembers
> what helps. It is not therapy, medical care, or a substitute for professional
> treatment; it does not diagnose or treat any condition; and using it does not
> create a clinician-patient relationship with anyone.

**After:**
> Steady is a self-guided wellness program for adults, built around the EMDR
> method, for building grounding and stabilization skills and preparing to work
> with difficult memories. It is software: it guides sessions, paces you with
> daily check-ins, and remembers what helps. It is not therapy, medical care, or
> a substitute for professional treatment; it does not diagnose or treat any
> condition, does not process trauma, and does not determine your readiness for
> trauma processing; and using it does not create a clinician-patient
> relationship with anyone.

**What changed & why:**
- "for processing difficult memories and reducing emotional intensity" →
  "for building grounding and stabilization skills and preparing to work with
  difficult memories" — removes the reprocessing + outcome claim; states the
  actual preparation/grounding scope.
- Added "does not process trauma, and does not determine your readiness for
  trauma processing" — mirrors the ratified program-fit gate wording, so the
  consent and the gate say the same thing.

### Option B — fuller alignment (if counsel prefers an explicit scope line)

Option A, plus a new short sentence at the end of the section:

> "Steady prepares you for that kind of work; it does not do the trauma
> processing itself."

---

## Version & propagation notes (for whoever implements the approved text)

- Bump `CONSENT_VERSION` `v2.0-wellness` → e.g. **`v2.1-wellness`** so the consent
  ledger records who agreed to the corrected text.
- **The autonomous set inherits this automatically.** `CONSENT_SECTIONS_AUTONOMOUS`
  is derived from `CONSENT_SECTIONS` and only overrides the "Safety review model"
  section — so fixing section 0 here also fixes it in the autonomous copy. (The
  autonomous *version id* `v3.0-autonomous` may also warrant a bump for
  consistency; counsel's call.)
- Existing members should **re-consent** to the new version (standard version-bump
  re-prompt), same mechanism as any consent change.
- No engine/logic change is involved — this is copy only.

## Adjacent items counsel may want to consider at the same time (not blocking F-1)

- The autonomous "Safety review model" copy (`SAFETY_REVIEW_MODEL_AUTONOMOUS`)
  refers to "fixed readiness and safety rules." The engine renamed the construct
  to **Educational Access State** (ledger A1). "Readiness" is still
  member-legible, but if counsel wants perfect alignment, consider "fixed access
  and safety rules." Minor; not part of F-1.
- The broader "waiting for your specialist's review" microcopy across
  marketing/dashboard is already tracked as a separate founder handoff (README
  §14.4 / §10) and flips with any autonomous-copy activation.

## Disposition
F-1 is a **founder + counsel** action. On approval, the change is a one-line copy
edit in `policy.ts` plus a version bump and re-consent — I can apply the
counsel-approved final wording verbatim once you have it.
