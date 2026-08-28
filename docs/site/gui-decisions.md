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

## Route migration to the §26 atlas

Handoff 06 §26 allows route changes "only through an approved migration map", and the atlas
is that map. Every retired address redirects (in `next.config.ts`) rather than 404s — a
bookmarked URL failing mid-review is the kind of small breakage that costs trust in the
whole console.

### Clinician

| Retired | Atlas address |
|---|---|
| `/clinician` (old console: its own alert list, member table, unlock queue) | → `/clinician/today` |
| `/clinician/work` | `/clinician/today` |
| `/clinician/clinical` | `/clinician/caseload` |
| `/clinician/clinical/:id` | `/clinician/member/:id/record` |
| `/clinician/people/:id` | `/clinician/member/:id` |
| `/clinician/member/:id` (old: outcome trends, AI program plan) | `/clinician/member/:id/measures` |

**Three person records became one address.** §26 gives exactly one — `/clinician/member/:id`,
"Patient overview… change, meaning, action, evidence" — and having three was the two-mental-
models defect handoff 05 §3.2 named. The §10.4 overview takes the atlas address; the other
two move to sub-routes with their content intact. `/record` is a holding address, not an
atlas route: §26's real split is `/measures`, `/sessions`, `/plan`, `/safety` and `/audit`,
and shredding a working 361-line record into five pages is Wave 3 content work, not part of
a route move.

### Review and administration

`/clinician/{audit,autonomous,bls,testing}` → `/review/*`, with their own layout and nav.
§26 makes review a role with thirteen screens; four exist. Handoff 05 §3.2 named the cost of
leaving them in the clinician nav: they "appear as equal top-level destinations beside daily
clinical work". The clinician nav is now four items with one link across; the reviewer's nav
takes over from there.

### Member

All twelve member surfaces moved under `/app`, two renamed to their atlas names:
`/dashboard` → `/app/today`, `/practices` → `/app/activities`. Wave 2 builds what those
screens should *contain*; this puts them at the right address first so the rebuild happens in
place rather than moving twice.

`/subscribe` stayed public — it uses `PublicChrome` and has no auth, and moving it under
`/app` was a mistake caught by the public-copy guard.

### What the migration cost

A blanket path rewrite is not safe on a codebase this size, and three classes of collateral
damage had to be found and undone:

1. **Module specifiers.** `@/lib/companion-ai` became `@/lib/app/companion-ai`, and
   `@/lib/practices` became `@/lib/activities`, because the route names are also library
   names. Reverted across 56 files, then the two renames restored separately.
2. **Regex literals.** `/\/dashboard/` became `/\/app/today/` — an unescaped `/` ends the
   literal, so the file stopped parsing. Six occurrences across four e2e specs.
3. **A heading matcher.** `/session-rule sign-off register/i` became
   `/app/session-rule sign-off register/i` — the rename fired inside a regex that was never
   a URL.

### Guards and tests

`tests/member-boundary.test.ts` and `tests/navigation.test.ts` were re-pointed at the new
paths with their coverage unchanged — same twelve surfaces, same assertions.

Six e2e tests encoded retired addresses. Five were assertion updates; the sixth
("every console is reachable from the nav, from anywhere") tested a property that genuinely
changed, and was rewritten to assert the same thing across the two-role structure: no console
reachable only by typing a URL, and the boundary crossable in both directions.

A further sixteen failures on the first run were **not** the migration — a leftover `next dev`
on :3000 without `EMDR_DEMO=1`, which Playwright reused via `reuseExistingServer`. Worth
knowing before diagnosing a future e2e failure the same way.

**Verification:** test:safety 542, test:e2e 105, build clean, and every retired address
checked in a browser for its redirect target and status.

## Wave 1 — the presentation spine

§31.2's exit condition: "one member and one clinician vertical slice work end to end."

### The projection envelope (§30.8)

`src/lib/presentation/envelope.ts`. §30.8 lists eight presentation states, and the whole
point is that they must not look alike. The pair that matters most:

> An empty queue because the day is clear, and an empty queue because the projection failed,
> render identically if the page maps over an array. The first is good news. The second is a
> clinician working blind while believing they are up to date — and it fails silently.

`ready` is one variant among eight rather than the default. Constructors refuse a
contradiction: an `empty` with no reason, a `stale` with no last-current time, a `partial`
with nothing missing. `permissionDenied` takes no subject at all, so a denial cannot leak
existence (§26: "denied and missing pages do not reveal protected existence").

`policy_unavailable` and `audit_unavailable` fail **closed** — no new session, no recorded
action — and neither withdraws support. There is no envelope state in which grounding and
crisis get smaller; §1 requires them to survive "a write, subscription, sync, or service
failure", which is exactly when they matter.

### The action contract (§30.4, §15.1)

`src/lib/presentation/action.ts`. A successful result cannot be constructed without the ids
that prove it committed — `committedEventId`, `auditEventId`, `projectionVersion`,
`effectiveAt`. There is no `{ ok: true }` to return early with. This is the
notification-truth defect generalised: a claim derived from an attempted write.

No action type can clear a safety stop (§27.5), and a guard asserts the type union contains
no `override`/`clear`/`reopen`/`reset`.

### The member slice — `member_today.v4`

`src/lib/member/today.ts` + `TodayDecision`. The member side has never had a projection;
`/app/today` assembled itself from about a dozen sources in the page, which §8 forbids
outright. The projection composes `buildMemberDay` rather than reaching around it, so
`assertNoScores` still runs and the member boundary holds by construction.

`assertTodayShape` enforces §20.2's cap — one primary, at most two alternatives — because
§3.4's catalog is reached one reasonable addition at a time.

**DayCanvas and TodayDecision were the same surface.** Handoff 04 §8 and handoff 06 §10.1
each specify a member decision card with the same primary, the same secondaries and the same
`MemberDay` source. Rendering both put the member's three options on screen twice, which is
worse than either alone — caught by looking at it, not by a test. §10.1 is the more specific
spec (expected duration, one sentence of why, support as a peer) so it owns the decision.
**The Horizon moved across with it**: handoff 04 §7's signature element has no equivalent in
§10.1, and dropping it would have discarded a deliberate decision as collateral damage.
DayCanvas stays defined — its props contract is what stops a score reaching a member surface.

Also fixed by looking: the card rendered *above* the greeting, so the page read as though it
began mid-sentence. §10.1's above-the-fold order is greeting and date, then the state card.

### The clinician slice — `clinician_queue.v1`

`clinicianQueueProjection` wraps `buildWorkQueue` in the envelope. A policy failure is
separated from an empty day and from a load failure: without a policy version there is no
defensible priority order, so the queue says so rather than presenting an order it cannot
justify. No fallback to raw tables (§30.8).

### Guards

`tests/presentation-spine.test.ts` — 18 tests. The eight states are distinct and
constructible; empty and failed differ and neither carries renderable data; the two safety
states fail closed; support is reachable in all eight; `EnvelopeView` renders all eight with
a glyph and a label, never colour alone; a result cannot claim success without its four ids;
every record-changing action is high-impact; Today's cap holds; and `MemberToday` exposes no
score-bearing field.

**Verification:** test:safety 560 (was 542), test:e2e 105, build clean. Both slices rendered
against the seeded demo.

### What Wave 1 did not do

`/app/today` still carries the pre-atlas content below the decision surface — the Autopilot
card, the module list, the history strip. Wave 2 replaces it; §3.4's finding is not fixed by
putting a better card above a catalog. The Autopilot copy leaks flagged in the README's open
questions are still there and still need a clinician.

## Wave 2 — the member shell (3 of 15 screens)

§31.2's exit condition is "all 15 member screens and failure states pass". **Three are done.**
This section says which, and what is left, because a partial wave recorded as a finished one
is how the next reader loses a day.

### Today, rebuilt to §10.1 — 583 lines to 325

§10.1 forbids the catalog outright ("No full module catalog on Today") and §3.4 named why:

> "This is a content catalog. It tells the member everything Steady can do, but it makes the
> member decide what matters now. On a hard day, that choice load is exactly what the system
> should reduce."

Removed from Today: the four-card practice grid, the measures-due banner, the member's paths,
the "find your path" prompt, the AI program plan, the twelve-module catalog, and a check-in
card that duplicated the decision surface's own primary action. Kept, per §10.1's short
below-the-fold list: the greeting and date, the decision surface, "what you've done", and
links onward.

Nothing was deleted. The catalog and practice grid moved to `/app/activities`, which §26
defines as "choose an allowed support tool — approved activity list". Paths and the program
plan belong to `/app/plan`, which is not built — the page links onward honestly rather than
dropping them silently.

Seven dead queries came out with the sections that used them. That matters beyond tidiness:
each was Today reaching into domain state directly, which is the §8 violation the projection
exists to end.

### Activities — the catalog's proper home

The guided modules now sit under the practices. What deliberately did **not** come across:
the unlock-request form and the per-module gating explanations. §26 gives this screen one job
and one dominant action; a module that is not open says "Not open today" and stops. §4's rule
for member surfaces is that absent is absent — a greyed row with a reason invites the member
to work out how to qualify, which is the pressure the gate exists to remove.

### Progress — `member_progress.v6`, and the reversal made real

The screen that carries the score reversal. §10.2's opening order is the safeguard and is
implemented in that order: plain-language statement first, then the comparison window, then
one trend, then the measure cards. The sentence comes first so the number arrives as support
for a description rather than as a bare value the member interprets into a grade.

`assertPatternOnly` refuses verdict language — diagnosis terms, severity bands, "you are
doing well", "ready for", "on track". §10.2's own acceptance line is "pattern language only;
no diagnosis or readiness conclusion", and §26 repeats it. A number may be a **pattern**; it
may never be a **verdict**.

Every series carries its scale, its direction ("lower is calmer"), its missing days ("gaps
are not zeros"), and an accessible table of values — §13's chart contract. A movement under
two points does not register as a direction, because two points on a 27-point scale is not a
pattern and calling it one is the overclaim §10.2 guards against.

**The guard was narrowed, not weakened.** `/app/progress` is the single named exemption in
`tests/member-boundary.test.ts`, and two new tests hold the bound: one fails if any *other*
route appears under `/app` outside the guard, and one fails if `MemberDay` ever gains a
score-bearing field or `member_progress` starts importing it. The exemption is a separate
projection, not a hole in the shared boundary — had Progress been built by widening
`MemberDay`, every member surface would have inherited the licence.

### The 12 screens Wave 2 has not built

`/app/welcome`, `/app/consent`, `/app/screening` (exists, not reworked to §26),
`/app/check-in` (exists; §20.2's "the check-in result changes the next action without
requiring navigation to a catalog" is **not** implemented), `/app/session/prepare`,
`/app/session/:id` (exists as the pre-atlas SessionPlayer), `/app/session/:id/safety`,
`/app/session/:id/close`, `/app/plan`, `/app/messages`, `/app/care-team`, `/app/settings`
(no index — `/settings` still lands on `/app/settings/account`).

Today also still carries the Autopilot card below the decision surface, which repeats the
same primary action. Its copy carries the two soft engine-state leaks already flagged in the
README's open questions, so it wants a clinician rather than an edit here.

**Verification:** test:safety 564 (was 560), test:e2e 105, build clean. All three screens
rendered against the seeded demo; Progress verified in its `partial` state with named missing
sources.

## Not started

Phase 2 (member shell), organization and payer workspaces (Phase 4), and human-factors
validation (Phase 5). The member Progress reversal above remains recorded but unbuilt.
