# Processing-session consent — DRAFT for clinician + counsel review

**Status:** DRAFT (`processing-consent-v0.1-DRAFT`). **Not live.** Requires
clinical review (present sign-off session) **and** counsel legal review before it
may gate any BLS session. Part-6 gate 3 of the BLS protocol
([`../bls-protocol-SIGNED-2026-07-22.pdf`](../bls-protocol-SIGNED-2026-07-22.pdf)).

This is a **distinct, versioned consent**, separate from the care-program consent
(`v2.1-wellness`) and the voice/biometric consent (`voice-consent-v1.0`). A member
must grant it explicitly before any bilateral-stimulation processing set. It is
recorded in the consent ledger under scope `processing_session`.

> **Reviewer note (must be resolved here):** the research brief found EMDRIA policy
> *"strictly forbids" self-administration of EMDR*, and Shapiro warns self-directed
> processing risks re-traumatization. This consent is written to disclose that
> honestly. Counsel + the clinicians should decide whether the product may use the
> term "EMDR" at all, and whether self-administered processing is offered or the
> tool is scoped to resourcing/stabilization only. The copy below assumes the
> processing scope was approved; it does **not** resolve the policy question.

---

## Proposed consent sections

### 1. What this is — and what it is not
"This is a self-guided exercise that uses left-right (bilateral) stimulation while
you bring a difficult memory to mind. It is software, used by you, on your own.
**No therapist is present, and no one is watching in real time.** It is not
therapy, not a medical treatment, and not a substitute for working with a licensed
clinician. Professional trauma processing is normally done *with* a trained
clinician; many clinicians and professional bodies recommend against doing this
kind of memory work alone."

### 2. What happens in a session
"You'll be guided through short sets of stimulation with brief check-ins between
them, and the session always ends with a calming, grounding close — whether or not
the memory feels 'finished.' You set the pace by answering the check-ins honestly."

### 3. Risks — please read
"Bringing up a difficult memory can raise distress during the session. It's
possible to feel more activated, to have the memory feel unfinished, or to
re-experience it afterward. If you become disconnected from the present, or can't
follow a prompt to stop, **the session will end itself and move you to grounding.**
This tool cannot judge, the way a therapist would, whether continuing is safe — so
it errs toward stopping. It is **not for a crisis**: if you are in danger or
thinking of harming yourself, stop and use the crisis resources shown."

### 4. Automated decisions, no live monitoring
"The decisions to pause, stop, contain, or close a session are made automatically
by fixed safety rules — not by a person, and not in real time. No human is
notified during your session unless you use a crisis resource yourself."

### 5. Your controls
"You can stop at any moment — a one-tap stop is always on screen, and stopping is
never penalized. Once you stop, stimulation stays off for the rest of that session.
Every session ends with a required grounding close."

### 6. Who should not use this
"This exercise is not offered if your answers indicate high dissociation, a recent
trauma within the exclusion window, certain standing restrictions (e.g. a
psychotic/dissociative diagnosis, recent hospitalization, or substance dependence
pending review), or that you don't feel safe today. In those cases you'll be routed
to grounding, resources, or support instead."

### 7. Your agreement
"I have read the above. I understand no therapist is present, that this is not
therapy, the risks including possible increased distress or incomplete processing,
and that I can stop at any time. I consent to a self-guided bilateral-stimulation
session."  ☐ *(explicit, never pre-checked; logged with version + timestamp)*

---

## Implementation notes (for when counsel-approved text lands)
- Add `PROCESSING_CONSENT_VERSION` to `policy.ts`; record under scope
  `processing_session`; gate every BLS set on an unrevoked grant at the current
  version (mirror the voice-consent gate).
- The gate is in addition to — not a replacement for — the care-program consent and
  (if voice is used) the voice consent.
- Any wording change requires counsel re-review + a version bump (per COMPLIANCE.md).
