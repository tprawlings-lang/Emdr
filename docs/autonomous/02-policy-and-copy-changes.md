# Policy, ToS & product-copy changes for autonomy

**Short answer: yes — a focused set of changes is required before the autonomous
system may govern real members.** The good news: most of the current copy already
describes an *automated, asynchronous, not-monitored-in-real-time* model, so it's
largely aligned. But a few specific places still promise **human review**, and
those become inaccurate the moment module unlocks / dispositions are decided by
deterministic rules instead of a person.

⚠️ **Not legal advice.** The current legal text was counsel-approved (2026-06-10)
and every wording change requires **counsel re-review + a version bump**. This
doc is a precise change-set to hand to counsel — draft language only.

This is §10 launch-gate #1 and ledger item; ship these changes **with** the
autonomy flag flip, never before (while a human is still in the loop, the current
"human review" copy is true).

---

## 1. Legal documents — claims that must change

### 1a. Consent — "Safety review model" (`src/lib/policy.ts`)
- **Current:** "…higher-intensity modules **unlock only after human review of your
  readiness**. Review is not real-time monitoring…"
- **Problem:** under autonomy there is no human readiness review — unlocks are
  deterministic rules.
- **Proposed:** "…higher-intensity modules unlock **automatically, only when
  deterministic readiness and safety rules are satisfied** — there is no human
  reviewing your readiness. If those rules can't clear you, or you repeatedly hit
  a safety stop, you are routed to human support/crisis resources. No one watches
  in real time, and the program is not an emergency service."
- Bump `CONSENT_VERSION` → e.g. `v3.0-autonomous`; re-consent existing members.

### 1b. Privacy — "Who can see your data" (`src/app/privacy/page.tsx`)
- **Current:** "You; **reviewers with a safety role inside the program (who review
  readiness, unlock requests, and safety alerts)**; and the engineers…"
- **Problem:** implies routine human review of readiness/unlocks.
- **Proposed:** "You; the engineers who operate the service under access controls
  and the audit log; and — **only if you are routed to them** — a clinician for a
  support/escalation pathway. Routine decisions about what's available to you are
  **made automatically by the program's rules, not by a person reviewing your
  file**." Bump `PRIVACY_VERSION`.

### 1c. Terms of Service (`src/app/terms/page.tsx`)
- Mostly compatible already ("no clinician-patient relationship", "not monitored in
  real time", "companion is software"). **Audit for any residual "review"/"unlock
  approval" language** and align. Bump `TERMS_VERSION` if touched.

---

## 2. New — Automated decision-making disclosure (add)

Because the program now makes **automated decisions that gate access** (module
unlocks, daily routing, forced stabilization), add a plain-language disclosure —
good practice everywhere and required under some regimes (e.g. GDPR Art. 22-style
automated-decision rules; some US state privacy laws):

> **How the program decides what's available to you.** Steady uses fixed,
> automated rules — not a person — to decide what's open to you each day and when
> higher-intensity modules unlock. These rules are designed to keep you safe and
> always err toward *less* intensity when in doubt. You can see the reason for any
> limitation, you're never penalized for stopping, and if the rules keep you out
> or you hit a safety stop, you're pointed to human support and crisis resources.

Include: the categories of inputs used (check-ins, screeners, session ratings),
that decisions are explainable, and the **route to human help** (the corpus
mandates this — it partly satisfies "right to human intervention").

---

## 3. Member-facing product copy that promises human review (not legal docs, but
safety representations — change with the same care)

- **Module unlock messages** (`src/lib/gating.ts`): "Unlock requested — **waiting
  for your specialist's review**", "**Your specialist has not approved** this
  module yet", "This module requires **specialist review and unlock**." →
  rule-based equivalents ("opens automatically when your readiness and safety
  rules are met").
- **Dashboard / module copy**: any "**shared with your care team**",
  "**specialist gated**", "your care team has been alerted" → automated-rules
  language (crisis routing still points to real resources).
- **`COMPLIANCE.md`**: update the human-oversight sections to the autonomous model.

---

## 4. Process & sequencing

1. Counsel re-reviews §1–§2 draft language.
2. Bump the affected versions (`CONSENT_VERSION`, `TERMS_VERSION`,
   `PRIVACY_VERSION`) in `src/lib/policy.ts`.
3. **Re-consent** existing members to the new version (the app already has a
   grandfathered-member re-prompt mechanism to reuse).
4. Update the product copy (§3) in the same release.
5. Ship all of it **atomically with `EMDR_AUTONOMOUS_SAFETY=1`** — until the flag
   flips, a human is still in the loop and the current copy remains accurate.

**Net:** the change is smaller than it sounds — the model was already described as
automated/async. The essential edits are (a) delete the "human review of
readiness" promise in the consent + privacy, (b) add the automated-decision
disclosure with the human-support escape hatch, and (c) reword the unlock/care-team
product copy. All counsel-gated, all shipped with the flag flip.
