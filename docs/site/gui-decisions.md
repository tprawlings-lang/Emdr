# GUI and decision-surface — what was decided, and how to undo it

Companion to [handoff 05](../handoffs/05-gui-and-decision-surface.pdf). It records the two
decisions that **reverse an earlier one**, the work that has landed, and what each revert
would take. Written because a reversal that lives only in a diff is indistinguishable from
drift six weeks later.

## The snapshot problem, first

Handoff 05 reviewed this repository at commit **`c39447a` (27 August)**. That is the commit
*immediately before* the six feature commits handoff 04 produced on 28 August:

| Commit | What it did — none of it visible to handoff 05 |
|---|---|
| `ef3bb2f` | longitudinal trajectory (clinician) |
| `6672e0d` | **the member score boundary** — structural, not a filter |
| `dedf7eb` | **one type family** — Cormorant retired |
| `32bc951` | navigation |
| `709b582` | patient directory |
| `1ea82c0` | the gate as a paced sequence |

So where handoff 05 praises a serif heading or designs a member-facing distress chart, it
is describing what it saw, not overturning a decision it had read. That does not make its
recommendations wrong — but it means the collisions below were decided here, on the merits,
rather than deferred to "the later handoff wins."

---

## Reversal 1 — a serif returns, for one role

**Handoff 04 §7 said:** one humanist sans, differentiated by scale and tracking. Cormorant
Garamond retired because Vol 1 requires legibility under fatigue and cognitive load, and a
Garamond revival has a small x-height and high stroke contrast — the properties that fail a
tired reader. The tired reader is this product's design centre, not an edge case.

**Handoff 05 §12.3 says:** "serif display type for page identity, human explanation, and
member-facing completion moments… sans-serif for controls, tables, labels, measures, and
dense clinical work."

**Decision: §12.3, bounded.** The original objection was to Cormorant's *drawing*, not to
serifs. Both positions survive if the serif is text-grade and confined.

The bounds, each held by `tests/type-system.test.ts`:

1. **Exactly two families.** A third is the old failure returning.
2. **Text-grade only.** Literata was drawn for long-form screen reading — large x-height,
   low stroke contrast, the inverse of what retired Cormorant. Named display revivals
   (Cormorant, Garamond, Playfair, Bodoni, Didot, Baskerville, Caslon) fail the build, so
   the reversal cannot be read as "serifs are fine now."
3. **One role.** The serif lives in `.type-identity` only, applied to 26 page-level `<h1>`s
   outside `/clinician` and `/clinical`. `.type-display` — 200+ usages — stays sans, so
   §12.3's "sans-serif for… dense clinical work" holds by construction.

**To revert:** point `--font-serif` back at `var(--font-sans)`, delete `.type-identity` from
`globals.css`, drop the `Literata` import and variable from `layout.tsx`, replace
`type-identity` with `type-display` across the 26 headings, and restore the "exactly one
family" assertion. Nothing else depends on the split.

## Reversal 2 — member Progress may carry scores and a chart

**Handoff 04 §3 said, and Vol 2 says:** no score, band, track name, criteria label, or chart
reaches a member surface. Any surface that contradicts it is a defect. Built structurally in
`src/lib/member/view.ts` — the member view model has no field a score could occupy, and
`assertNoScores` rejects one attached dynamically.

**Handoff 05 §10.2 designs** a member Progress screen built on exactly those: "Average
ending distress moved from 6 to 4", an ending-distress line chart with event markers, and
practice/session counts.

**Decision: allow it, on a dedicated Progress surface only.**

> ⚠ This is the reversal with clinical weight, and it was taken knowingly. Handoff 04's
> §3 argument was that a member-facing number invites performance — the member starts
> managing the score rather than reporting their state, which corrupts the instrument as
> well as the experience. Handoff 05 §3.6 makes the opposing case: a trend with no
> interpretation is *already* being shown, and the fix is to give it meaning rather than
> remove it. Both were put to the product owner; §10.2 was chosen.

**Status: not yet built.** The guard is unchanged and still forbids scores everywhere. When
the Progress screen lands, the exemption must be narrow:

- Scoped to the `progress` route alone — not `dashboard`, not `check-in`, not `session`.
- The other member routes keep the full boundary, including the view model.
- §10.2's own constraints ride along: a plain-language change statement first, direct
  labels, event markers, visible missing days, an accessible table, and no merging of
  different scales into one unlabelled line.

**To revert:** delete the `progress` route and its exemption from
`tests/member-boundary.test.ts`. The boundary is unchanged everywhere else, so nothing has
to be reconstructed.

---

## What has landed

### Phase 0 — presentation contract
- `src/lib/presentation/contract.ts` — §8.2's `DecisionSurface`, `EvidenceRef`, `Freshness`,
  `ReasonItem`, `AllowedAction`, plus `assertRenderable` (refuses a surface with no
  headline, explanation, or freshness) and `Rate`/`ratePercent`, which make §23.3's "no
  percentage without its denominator" a type rather than a habit.
- `assertRenderable` also refuses to render a safety-stop override, per §15.2 — a *disabled*
  control still teaches that the override exists.

### Notification truth (§3.8) — a defect, not a redesign
Four member surfaces claimed a care team "has been notified" or "has been alerted":
`CompanionChat.tsx:78`, `SessionPlayer.tsx:851`, `crisis/page.tsx:25`,
`dashboard/page.tsx:42`.

Each rendered because `createAlert()` had run — and `createAlert()` is one
`INSERT INTO alerts`. There is no delivery channel in this codebase: no email, no SMS, no
push, no webhook. The table has no `delivered_at` and no `acknowledged_at`; its only
lifecycle is `status: open | reviewed`, which records a clinician opening the row later.

Meanwhile `/demo`, `/trust` and the home FAQ told reviewers that nobody monitors this
environment and no care team is assigned. **The product asserted both, and asserted the
false half to a member in crisis.**

`src/lib/notify/delivery.ts` now holds §3.8's five states with its exact member-safe copy.
`delivered` without a receipt time throws; `acknowledged` without both a person and a time
throws; with no channel configured every surface reports `not_configured`, and a
caller-supplied receipt cannot talk it into a stronger claim. `tests/notification-truth.test.ts`
also checks the member copy still agrees with what `/demo` tells reviewers.

### Phase 1 — tokens and type
- **§12.2 semantic palette** added as `--color-state-*` pairs. All six verified ≥4.5:1 on
  their own background *and* on ivory and linen, recomputed from the CSS by
  `tests/contrast.test.ts` rather than recorded as numbers in a comment.
- **§3.9's four failing tokens** are now banned as text and named with their measured ratio:
  `sage-deep` 2.34:1, `clay` 1.96:1, `safe-deep` 3.20:1, `mist-deep` 4.18:1. They keep their
  legitimate fill and border jobs.
- The worst of them was on the crisis surface: `sage-deep` at 2.34:1 rendered the SOS
  panel's breathing prompt and its grounding link — the screen where a member is least able
  to work at reading something.
- The identity serif, as above.

**Verification:** `test:safety` 521 pass (was 508), `tsc` clean, `build` clean.

### Phase 3 — the clinical cockpit (partial)

The console opened on two stacked lists — alerts, then caseload — that a clinician had to
reconcile by hand, because the same person appears in both for the same underlying reason.

- **`src/lib/clinical/work-queue.ts`** — §8.3's `clinical_work_item_projection`. One ordered
  list with §10.3's five groups, duplicate collapse by person + alert type (keeping the
  worst band, earliest deadline, newest evidence, and the event count), owner names resolved
  server-side, and `change` measured against the person's last resolved alert — null, not
  invented, where there is no prior review.
- **`/clinician/work`** and **`/clinician/people/[id]`**. Note the prefix: §7.2 proposes
  `/clinical/*`, but `/clinical` is an existing *public* marketing page, so the console keeps
  its authenticated `/clinician` namespace. Structure follows §7.2; only the prefix differs.
- **`src/components/clinical/primitives.tsx`** — §11's `PriorityBadge`, `FreshnessLabel`,
  `OwnerChip`, `DueLabel`, `ReviewBadge`, `EmptyState`. Every state pairs a colour with a
  glyph and a word, per §12.2's "colour cannot carry meaning alone".

**Four defects were found by rendering it and looking, not by tests:**

1. The row headline showed `phq-9: suicidal_ideation_screen_positive (total 16)` — a machine
   key in the field whose job is to say why a clinician is here. All ten alert types
   `createAlert()` raises now have a sentence; the raw detail moved one line down, where a
   clinician acting on the row still gets the specifics.
2. A resolved row read **"Due in just now"** — the age helper clamps a past deadline to zero.
   Resolved items now show when they resolved.
3. "1 need action".
4. The person's own name repeated in every row of their own record.

Guards for 1 and 2 are in `tests/work-queue.test.ts`, which also holds §20.3's stability and
duplicate-collapse rules, §20.1's "no client component recalculates priority", and §15.2's
"a safety-stop override does not render".

### The gate review drawer (§9.1, §9.2)

The gate answered "allowed or not" and returned one sentence, so §3.7's seven distinct
conditions shared one padlock. A member one form away from proceeding and a member stopped
by a safety rule were told the same nothing — and the second was taught that the stop is an
obstacle to work around.

- **`src/lib/clinical/gate-review.ts`** — §8.3's `gate_decision_projection`. Maps every gate
  outcome to one of §9.1's six member states, and carries the reasons, the evidence (an
  absence recorded *as* an absence — "no check-in today" is often the whole reason), the
  policy version, the prior decision, and what may and may not be overridden.
- **`GateReviewDrawer`** — §9.2's eight requirements. The two doing most of the work are the
  **member-copy preview** (the clinician reads the exact sentence the member reads, so copy
  that works in clinical shorthand and fails a person in distress is visible at review time)
  and the **cannot-be-overridden list**, rendered outside the override branch so the boundary
  is legible precisely when an override *is* available.
- **`gateOverrideAction`** — posts and waits (§15.1 forbids optimistic updates here). The
  boundary is not re-implemented: `override()` refuses a never-overridable target itself.

**Three defects found by rendering it:**

1. **A member blocked by the fitness screener was shown "Processing is paused today."** —
   the generic §9.1 `limited` sentence — while the clinician read the real reason one line
   above. Different claims: one describes a wait, the other an action. §9.1's sentence now
   belongs only to the daily read, a cooldown, and the kill switch; every other cause carries
   its own member-facing reason and its own next step, rather than sending the member to
   grounding when a form is what stands in the way.
2. `Check-in — action "processing_ok"` — a raw enum in the evidence list.
3. **Eleven identical drawers.** One incomplete screener blocks all eleven modules, so the
   panel was eleven expandable rows carrying the same decision — making one unresolved form
   look like eleven problems. Decisions now collapse by state *and* cause, naming the modules
   affected, per §10.3's own duplicate-collapse rule.

`tests/gate-review.test.ts` holds all three, plus §15.2's "a safety stop never yields an
override", the disjointness of the overridable and never-overridable lists, and the rule that
the drawer renders the decision's boundary rather than defining its own.

## Not started

Phase 2 (member shell), organization and payer workspaces (Phase 4), and human-factors
validation (Phase 5). The member Progress reversal above remains recorded but unbuilt.
