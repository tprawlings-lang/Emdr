# Steady — behavioral-health platform in development (prototype)

> **Read the three states before anything else.** This repository holds one codebase at
> three different levels of readiness, and conflating them is the single easiest way to
> misread it.
>
> | | |
> |---|---|
> | **What runs today** | A self-guided **wellness-lane** program: guided EMDR-based sessions, daily readiness check-ins, a Prepare & Regulate practice suite, psychoeducation micro-lessons, an always-available SOS panel, grounding tools, goal-based care paths, an AI companion with member-controlled memory, and a deterministic safety gate chain. Documented in **§1–§14** and accurate as written. |
> | **What is being built** | A **longitudinal behavioral-health platform** — Steady Personal → Clinical → Intelligence, the Handoff A→E series — for clinician piloting, enterprise/payer distribution, and outcome intelligence. Foundations are landing now (event spine, tenancy); the clinical and enterprise products are not built. |
> | **Release status** | **Prototype. Nothing is available to the public or to any real participant.** No real patient, payer, or employee health data exists in any environment, and none may until the clinical, security, privacy, legal, and operational gates complete. Not a medical device; **not for emergency use** — US users in crisis should call or text **988**, or 911. |


---

# ▶ RESUME HERE — session handoff, 2026-08-28

**This block is written for a fresh context window.** It is the shortest path from "I have
just opened this repository" to "I am doing the next useful thing." Everything below is
current as of commit `c8797ca` plus the handoff-05 work below; the detail
behind it is in the sections that follow.

## Read these, in this order

The specifications that drive the build are committed at
**[`docs/handoffs/`](docs/handoffs/)** — they were session uploads and a new window could
not previously find them. [`docs/handoffs/README.md`](docs/handoffs/README.md) is the index
and states which are done.

| Read | Why |
|---|---|
| 1. This block | Names the next build item and the guards that encode past decisions |
| 2. **[Handoff 04 §6](docs/handoffs/04-presentation-layer-v1.pdf)** | **The next thing to build.** §6 is about two pages |
| 3. [`docs/site/presentation-layer.md`](docs/site/presentation-layer.md) | What handoff 04 already produced, and *why* each rule exists. Read before changing any member surface |
| 4. [`docs/handoffs/README.md`](docs/handoffs/README.md) | The other three handoffs and the phase order, if the work reaches back into them |

Do not read all four handoffs front to back. They layer, they are long, and only 04 is
live work.

## Where the work is

Two branches, identical and pushed: `claude/launch-status-vh6vbo` (the designated
development branch) and `main`.

**`main` is what the site serves.** `render.yaml` sets `branch: main`, so nothing reaches
the deployed site until `main` moves — and work sitting on the development branch looks,
from a browser, exactly like work that was never done. This has now caused the same
confusion twice. Deploy with:

```bash
git push origin claude/launch-status-vh6vbo:main   # fast-forward; Render builds on push
```

**`render.yaml` says `branch: main`, and the live service does not use it.** That file only
governs a service created from the Blueprint; the running Render service is wired to
`claude/gifted-keller-501y5d`, which forked at `f006e97` and carries one commit on top
(`3071750`, the handoff-06 PDF, also on `main`). Verified against production rather than
assumed: the site serves `/dashboard` and `/practices`, 404s on `/app/today` and
`/review/*`, and loads no Literata — exactly that branch, and 17 commits behind `main`.

Do not trust `render.yaml` to tell you where the site comes from. Check the deployed app:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://steady-emdr-demo.onrender.com/app/today
# 404 => production predates the route migration, whatever main says
```

```bash
npm run test:safety   # 605 pass
npm run test:e2e      # 112 pass   (PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium)
npm run test:rls      # 12 cross-tenant attack cases against a real Postgres cluster
npm run build         # clean
npm run demo -- reset # seed AND rebuild the event log — see the warning below
```

> **If a member record looks empty, run `npm run demo -- reset` before concluding
> anything.** The timeline, the cited summary, and the trajectory are all assembled from
> the event log, and without the genesis backfill they render blank. This was a real
> defect: every reviewer who opened a record saw three empty sections.

## What was just finished

The **Presentation Layer Handoff** (`Steady_Presentation_Layer_Handoff_v1.pdf`, §-numbers
below refer to it) drove the last several commits, in its own §9 order:

| § | Work | Commit |
|---|---|---|
| §3 | **The member score boundary** — structural, not a filter | `6672e0d` |
| §7 | **One type family** (Cormorant retired), 17px floor, 1.6 line-height, global reduced-motion | `dedf7eb` |
| §8 | **Member components** — `DayCanvas`, `Horizon`, `PracticeCard`, `HistoryStrip` | `dedf7eb` |
| — | **Navigation** — the product had none at all | `32bc951` |
| — | **Patient directory**, separate from the caseload | `709b582` |
| §5 | **The gate as a paced sequence** — one question per screen, resumable | `1ea82c0` |

## ▶ NOW: handoff 06 — the frame, and the atlas it comes from

[`docs/handoffs/06-web-gui-analytics-and-clinical-presentation.pdf`](docs/handoffs/06-web-gui-analytics-and-clinical-presentation.pdf)
is the live specification: 101 pages, of which **pages 54–73 are drawn page examples**.
Part I reprints handoff 05; Part II (§25–§31) is the coding annex.

> **Open the mockups before writing a screen.** The first pass at this handoff was built
> from its text alone, and the result did not resemble it. Two things in particular get
> rebuilt wrong from memory: the left rail is §25's four **information layers**, not a
> feature menu, and the top bar is **light** — it reads as dark because the wordmark and
> the avatar sit on it in deep green.

**What every one of the twenty examples draws.** `src/components/app/AppShell.tsx`:

- an ivory page, with the app in a rounded near-white panel;
- a bar with the wordmark, the role, a FABRICATED pill and an avatar;
- a pale rail: **Overview · Progress · Actions · Evidence · Audit** — the same five for
  every role, because roles differ in what each layer *contains*, not in which layers
  exist. `src/lib/app/rails.ts` says where each one goes per role, and a layer with no
  destination renders as plain text rather than a dead link;
- the title, then the standing line "Action first. Meaning second. Evidence third.".

Under it, four repeated pieces in `src/components/app/surfaces.tsx`: a tinted `Callout`,
`SummaryCards` (capped at three — a fourth means the screen has not decided what matters),
a white `Panel` with a required footnote, and a `Note` beside it with a **required
`boundary`** — the sentence saying what the panel does not prove. Optional, it would be
the first thing dropped.

**Where the shell is.** All 36 member routes, all 18 clinician routes, all 5 review
routes. `MemberPage`, `ClinicianPage`, `PersonShell` and `ReviewPage` all render it;
`MemberNav`, `ClinicianNav` and `ReviewNav` are deleted. Running activities and sessions
stay deliberately chrome-free. The rail is five items everywhere, so screens *within* a
layer are a small sibling row under the title — five links cannot reach fourteen
destinations without stranding nine.

### The atlas, screen by screen — what exists and what does not

§26 specifies 80 screens across six roles. Counts are routes on disk, not judgements
about how finished each is.

| Role | Spec | Built | Gap |
|---|---|---|---|
| Patient and member | 15 | 15 (36 routes incl. sub-screens) | — |
| Clinician | 14 | 14 (18 routes) | — |
| Organization | 9 | 9 | — |
| Payer | 10 | **0** | every screen; `/payer/*` does not exist. There is no claims feed, no eligibility file, no contract record and no cost model anywhere in this deployment, so all ten would be reporting on nothing |
| Review and administration | 13 | 5 | `/review/access`, `/clinical`, `/safety`, `/lineage`, `/research`, `/release`, `/demo-data`, `/status` |
| Public institutional site | 11 | 9 | `/personal`, `/intelligence`. Nothing links to them — the home page routes the three products to `/platform`, `/clinical`, `/organizations` and `/payers` instead — so this is a naming gap, not a broken link |
| Shared access states | 8 | 1 | only `/login`. Missing `/verify`, `/reset`, `/invite/[token]`, `/403`, `/404`, `/session-expired`, `/status/degraded` |

**Also specified and not built:** §29's chart contracts — 22 chart screens (clinician 7,
organization 7, payer 8), of which the eight worked examples are pages 76–83. §29.1's
rules for every chart (denominator with its numerator, the window and refresh time always
shown, no mixed clinical scales on one surface, no predictive risk score) apply to the
charts that do exist and are not yet encoded as a guard.

**Deliberately not built, and why it is not a gap:**

- `/review` shows no review queue. §26 asks for one; scoped access requests, release
  sign-offs and clinical language approvals are not records anywhere in this deployment.
  An empty queue would claim a channel that is quiet. The screen names the eight missing
  screens instead.
- Organization and payer screens are aggregate-only by §30.6 — aggregate access must not
  create person-level care access. That is a data-model requirement, not a page.

### Steady Intelligence — the organization role

Sign in as **operations@example.com / demo1234**. It is an `admin` account,
which in this codebase means an AGGREGATE role: it reads a population and it
cannot reach a person. `/clinician/*` and `/app/*` both bounce it back.

**The population is real rows, not stored totals.** `src/lib/demo-org-seed.ts`
seeds a fabricated organization — 4,820 covered lives across four sites, under
its own tenant, as ~32,000 events. Every figure on every organization screen is
counted from the ledger by `src/lib/intelligence/organization.ts`; nothing is
pre-aggregated. That is §30.1's read path, and it is why "where does 3,555 come
from?" has an answer.

**Nobody in that population has a name.** `persons.display_name` is NULL for all
4,820. A name the organization role must not see is safest when it does not
exist — the drilldown is impossible rather than refused, the same structural
move as the member score boundary.

Three screens are deliberately not charts:

| Screen | State | Why |
|---|---|---|
| Capacity | `partial` | Demand is countable; open first-visit slots are not — no calendar, no slot record. Half a ratio is not a ratio, so the missing source is named above the chart. |
| Teams | empty | There is no team record in the tenancy model at all. A workload ranking of teams that do not exist, shown to the people who set their budgets, is worse than a blank. |
| Reports | empty | A governed export needs filter parity, cohort version, suppression, a stated purpose, an audit event and a signature. Until it has all six, the honest control is the absence of a button. |

### Waves, per §31.2

| Wave | | Status |
|---|---|---|
| 0 | Baseline | done |
| 1 | Presentation spine | done |
| 2 | Member | done |
| 3 | Clinician | done |
| — | **The frame** (this work) | done — member, clinician and review |
| 4 | Aggregate — organization | done — 9 screens, real aggregates |
| 4 | Aggregate — payer | **not started, 10 screens** — blocked on a claims feed, not on UI |
| 5 | Review and public | 5 of 13 review screens |
| 6 | Hardening — performance, accessibility, security, telemetry | not started |

## ✔ DONE: handoff 05, the GUI and decision-surface work

[`docs/handoffs/05-gui-and-decision-surface.pdf`](docs/handoffs/05-gui-and-decision-surface.pdf)
is the live specification. **Read [`docs/site/gui-decisions.md`](docs/site/gui-decisions.md)
before changing a member or clinical surface** — it records two deliberate reversals of
handoff 04 and how to undo each.

One thing to know before reading handoff 05 against this code: **it reviewed the repository
at `c39447a`, the commit before handoff 04's six feature commits.** It never saw the member
score boundary, the one-family type system, navigation, the patient directory, or the paced
gate. Several apparent reversals are gaps in that snapshot rather than decisions.

**Landed (Phase 0 and Phase 1):**

| | Work |
|---|---|
| §8.2 | `src/lib/presentation/contract.ts` — `DecisionSurface` and friends; `assertRenderable` refuses a surface with no headline, explanation, or freshness, and refuses to render a safety-stop override (§15.2) |
| §3.8 | **Notification truth.** Four surfaces claimed a care team "has been notified" off the back of one `INSERT`. There is no delivery channel and no receipt column. Now `src/lib/notify/delivery.ts` with the five states; `delivered` without a receipt throws |
| §12.2 | Semantic `--color-state-*` palette, all six pairs verified ≥4.5:1 on their own background and on ivory and linen |
| §3.9 | The four sub-AA tokens banned as text. `sage-deep` at 2.34:1 was rendering the SOS panel's breathing prompt and grounding link |
| §12.3 | The identity serif (Literata), bounded to `.type-identity` on 26 page `<h1>`s outside `/clinician` and `/clinical` |

**Phase 3, the clinical cockpit (partial):** `/clinician/today` is the work queue — §10.3's
five groups, duplicate collapse, owner, due state, one action per row, order deterministic
for a policy version and evidence set. `/clinician/member/[id]` is the person overview —
sticky identity/owner/consent header, "since your last review" with citations, active work,
right rail. Backed by `src/lib/clinical/work-queue.ts` and §11 primitives in
`src/components/clinical/primitives.tsx`. Routes now follow handoff 06 §26's atlas — see the migration table in
[`docs/site/gui-decisions.md`](docs/site/gui-decisions.md).

**The gate review drawer (§9.1, §9.2)** is on the person overview: every module decision
mapped to one of six member states, collapsed by cause, each showing the rule, its evidence,
the prior decision, the exact sentence the member sees, and — always, not only when an
override exists — what cannot be overridden. `src/lib/clinical/gate-review.ts` and
`src/components/clinical/GateReviewDrawer.tsx`.

**Open:** Phase 2 (member shell), organization/payer/trust workspaces, human-factors
validation.

**New guards:** `tests/notification-truth.test.ts`, `tests/contrast.test.ts`, `tests/work-queue.test.ts`, `tests/gate-review.test.ts`, `tests/presentation-spine.test.ts`, `tests/member-screens.test.ts`, `tests/bls-visual.test.ts`, `tests/clinician-screens.test.ts`, `tests/design-consistency.test.ts`.
`tests/type-system.test.ts` now records the two-family reversal and its bounds.

## ✔ RESOLVED — visual BLS (ledger A7 reversed)

**Verified, then decided.** The finding was confirmed in the running app: the session offered
"Moving dot" as the **pre-selected default**, with a Slow/Medium/Faster speed picker, to a
seeded member — while `visualStimulationEnabled` was `false`, `BLS_NO_VISUAL_BETA` said
"visual BLS stays disabled", and a passing test asserted the capability was off.

The product owner's call was that the product was right and the config wrong, so the flag
flipped to `true`. What went with it, because a flag alone would not have fixed anything:

| | |
|---|---|
| **The config is now load-bearing** | The session read *none* of it — that was the real defect. `visualAllowed` is computed server-side from the config **and** the member's seizure answer, and both must hold. Verified by flipping the flag back to `false` in the running app: the dot, the modality choice and the speed picker all disappear. |
| **WCAG 2.3.2 is enforced in code** | `BLS.maxFlashesPerSecond` was a number in config and a sentence in the rule catalog, applied nowhere. `BlsVisual` now clamps to it. This is the a11y control ledger A7 was waiting on. |
| **Photosensitivity removes the modality** | It used to *default away* from it — the screen told a member who answered yes to the seizure question that audio-only was "your default… **You can change it**", with the control one tap away. The choice is now absent, not unselected. |
| **A control for an absent thing is gone** | "Dot speed" rendered in audio-only mode. |

**Still outstanding:** the *device* validation half of A7. The flag permits the modality; it
does not certify it. `tests/bls-visual.test.ts` holds all of the above, including that the
reversal did not enable autonomous reprocessing — `autonomousStimulationEnabled` is still
`false`.

## ▶ THE NEXT THING: §6, the session state machine

Everything else in the handoff is done. §6 is not started.

**Scope evidence, gathered 2026-08-28.** The guided flow runs on neither the session reducer
nor the safety engine — it re-derives its own state from raw profile fields. That is the
shared root cause of the missing closure state *and* of the finding above.

| | Lines | Unit-tested |
|---|---|---|
| `src/lib/safety/session.ts` (the reducer) | 294 | **yes** — `safety-session.test.ts` covers every transition, incl. `completeClosure` |
| `ResourcingSession.tsx` (wires the reducer) | 266 | via the reducer |
| `SessionPlayer.tsx` (guided flow) | 1066, ~700 in one function | **none — no test imports it** |

`ResourcingSession` honours the 120s closure floor because the reducer enforces it;
`SessionPlayer` has no `closure` state at all. Its `Phase` union (line 28) is
`intro | running | ground | sudpause | hardstop | finishing` — parallel to the reducer
rather than driven by it. Adding §6’s states to that union by hand reproduces the
divergence at a larger scale; the alternative is to drive it from the reducer the way
`ResourcingSession` does. Note the regression net is thinner than it looks: the 508 unit
tests do not cover `SessionPlayer` at all, so the exposure is `session-narration.spec.ts`,
`smoke.spec.ts`, and looking at it.

**Agreed approach:** write the guards first — `tests/session-states.test.ts` asserting every
§6 rule against the current flow — and let the failure count decide the scope, rather than
choosing the refactor up front.

The state machine already exists in Vol 2 and maps almost one-to-one onto screens:

```
created → pre_session_check → authorized → set_active → post_set_reassessment
        → set_active (only after explicit authorization) → closure → completed
```

What §6 asks for, per state:

- **`pre_session_check`** — brief, calm, no new information. A denial transitions to the
  denial screen **in the same visual register** (no red, no warning iconography, no
  apology).
- **`authorized → set_active`** — needs an **explicit confirmation beat**. The member
  should have to actively step into the set, not slide into it.
- **`set_active`** — "the quietest screen in the product." BLS at a fixed 1.25 Hz default,
  range 1.0–1.5, **no adaptive speed**. Stop and pause permanently visible, high-contrast,
  reachable without precision — full-width tap targets, not small icons. "Ground me" is a
  **peer action to stop**, not buried.
- **`post_set_reassessment`** — the highest-consequence input in the flow. Minimal reading,
  single scale, and **do not show the member their previous answer** — that invites
  performance.
- **`closure`** — mandatory. Should feel like **an arrival, not a form to clear**. The most
  likely to be skipped and the most clinically important not to skip.
- **`technical_interruption → recovery`** — design it properly rather than as an edge case.
  A member dropping mid-set needs a defined re-entry that respects any safety state that
  fired before the drop.
- **any state → `crisis_support`** — reachable from every screen at a fixed position.

### Where to start

```bash
# The state machine and its guards already exist — this is a rendering job,
# not a new engine. Read these first:
src/lib/safety/session.ts             # the state machine itself
src/lib/safety/resourcing-session.ts  # BLS set pacing, stop, closure
src/components/ResourcingSession.tsx  # the current set UI
src/app/session/[moduleId]/           # the guided module flow
src/app/session/resourcing/           # the Part 6 stage-4a flow
```

Follow the pattern the last five pieces used, because it is what made them reviewable:

1. **Write the guard first.** Every rule in §6 that could be relaxed later becomes a test
   before the code. `tests/gate.test.ts` is the closest model — it asserts behaviour and
   copy, and each failure message says why the rule exists.
2. **Build the component contract, not the screen.** §8's table gives `SessionSurface`
   ("fixed BLS params, controls" / never "adaptive/derived speed") and `ClosureSurface`
   ("closure target" / never "pre/post comparison"). Put them in
   `src/components/member/` beside `DayCanvas`.
3. **Render it and look at it.** Three of the last five defects — uniform hollow markers, a
   duplicated label, an overflowing viewBox — were invisible to tests and obvious in a
   screenshot.
4. **Run all three suites and the build before committing.** The e2e suite writes to a real
   database; each test should own its own data, because tests sharing a persona race.

## Guards that will fail the build if you break them

These encode decisions rather than preferences. Read the failure message — each one says
why the rule exists.

| File | What it holds |
|---|---|
| `tests/member-boundary.test.ts` | No score, band, track, cutoff, chart, streak, or count reaches a member surface — and the member view model cannot carry one |
| `tests/type-system.test.ts` | Exactly one font family; 17px/1.6 floors; the display role is scale-and-tracking, not a second face |
| `tests/navigation.test.ts` | Every nav and guided destination resolves; no member surface is a dead end |
| `tests/gate.test.ts` | Safety items commit immediately; position never a percentage; the exit is a pause, never a quit |
| `tests/public-copy-guard.test.ts` | No compliance claim, price, or retired route on a public page |
| `tests/directory.test.ts` | Cross-tenant isolation in the directory, both directions |
| `scripts/verify-rls.sh` | 12 Postgres cross-tenant attack cases, CI-blocking |

## Standing constraints — do not relax without asking

- **No score, band, track name, criteria label, or chart on any member surface.** Vol 2
  calls any such surface a defect. The clinician console is different by design (§3) and
  keeps its scores and its trajectory chart.
- **No red or orange on member or crisis surfaces.** Crisis carries weight through contrast
  and typography. The clinician console keeps red for safety marks.
- **No real participant data in any environment.** Any real-person information in a T0/T1
  environment is a stop condition: isolate, preserve evidence, notify the owner, assess
  exposure, remove through the approved process, do not resume until corrected.
- **Never claim "HIPAA compliant", "clinically validated", "secure", or "approved"** as a
  general label. Dated evidence and exact scope only.
- **Do not quote a test count or control to a reviewer** unless it ties to the exact
  demonstration commit.
- **Preserve parallel changes.** Rebase; do not force-push over someone else's work.

## Open questions that need a human, not a commit

1. **Does the horizon read as a covert score?** It is built stateless specifically so it
   cannot become a trend chart, and a guard enforces that — but whether a persistent state
   indicator *reads* as a score is a clinical judgement (handoff §10 Q1).
2. **Two soft leaks in the Autopilot card**: it says "your window looks steady" and explains
   why the day was not adjusted. Both reveal engine state. Rewriting clinical-adjacent copy
   wants a clinician, so they were flagged rather than changed.
3. **Counsel review** of the Demo Terms and Demo Privacy Notice, to remove the "unreviewed"
   markings.
4. **A real screen-reader pass.** All 17 public pages have zero serious/critical axe
   violations, which is not the same thing.
5. **`EMDR_REVIEW_ACCESS_CODE` is unset on Render**, so the review gateway is closed. That
   is the intended default; set it before a reviewer session.
6. **Should the guided flow’s visual BLS exist at all?** See the open finding above. The
   config, the rule catalog, and a passing test all say no; the UI ships it as the default
   for members without a seizure flag. Whether that is a live compliance exposure or a
   known, accepted prototype gap is not a judgement to make from the code.

---

**A note on tense.** §1–§14 describe the live prototype in the present tense because it
genuinely runs. Everything in the platform section below is *in progress or planned* and
says which. Where an architectural decision is recorded as "Accepted," that means the
decision is settled — **not** that the work is done or the control is active. See
[`docs/adr/README.md`](docs/adr/README.md), which states this explicitly and per-ADR.

Membership pricing, tiers, and the upsell engine for the consumer product are in **§8.4**.
They are one distribution channel of the platform thesis rather than the thesis itself, and
should not be presented to investors as the business model — see
[`docs/strategy/`](docs/strategy/).

## The platform build — status, decisions, and gaps

Steady is expanding from the consumer product above into a longitudinal behavioral-health
platform (Steady Personal → Clinical → Intelligence, the **Handoff A→E** series) aimed at
three audiences simultaneously — **venture capital investment, clinician piloting, and
cybersecurity/compliance oversight.** The planning corpus lives in
[`docs/strategy/`](docs/strategy/) (start with its `README.md`, then
[`gap-analysis.md`](docs/strategy/gap-analysis.md)); the architectural decisions it forced
are [ADR 0009](docs/adr/0009-clinical-lane-reclassification.md) (clinical-lane data zones),
[ADR 0010](docs/adr/0010-event-sourced-longitudinal-spine.md) (event-sourced history),
[ADR 0011](docs/adr/0011-tenancy-and-person-account-separation.md) (multi-tenancy + person/
account split), [ADR 0012](docs/adr/0012-ai-gateway.md) (AI gateway), and
[ADR 0013](docs/adr/0013-event-authoritative-writes.md) (the event-authoritative cutover
specification). The working rule across all of it: **design from Handoff E backward,
implement from Handoff A forward.**

### What is enforced today versus what is built but dormant

This distinction is the one a security reviewer should get first, stated plainly:

| Capability | Built and tested | Active in the running application |
|---|---|---|
| Deterministic safety gate chain (`checkModuleAccess`) | ✅ | ✅ — governs every member today |
| Hash-chained audit log | ✅ | ✅ |
| App-layer field encryption | ✅ | ✅ |
| Event log written on every instrumented path | ✅ | ✅ — but **advisory**; the current-state write is still what the app depends on |
| Projection replay (byte-identical) | ✅ | ⚠️ Verification tool, not a runtime path |
| Tenant-scoped repository (`TenantContext`) | ✅ | ❌ **Product call sites were never migrated behind it** |
| Postgres row-level security | ✅ CI-blocking against a real cluster | ❌ **Dormant** — the app still runs on SQLite, and nothing issues `SET LOCAL app.tenant_id` |
| Autonomous safety engine (§10) | ✅ ratified with conditions | ❌ Shadow mode only |

The repository contains tenant-safe building blocks and tested RLS policies. **The running
SQLite application does not yet enforce end-to-end tenant isolation.** A building block is
not a control until it is on the path every request takes; closing that gap is
[ADR 0013](docs/adr/0013-event-authoritative-writes.md) §3 and §5.

### Migration status (ADR 0010 + 0011, executed together)

| Step | What | Status |
|---|---|---|
| 0010.1–2 | Event table, schema registry, dual-write (every mutation writes its current-state row *and* an event) | ✅ Shipped |
| 0010.3 | Genesis backfill — pre-existing rows reconstructed as marked, non-authoritative events | ✅ Shipped |
| 0010.4 | Projections rebuilt from events, verified **byte-identical** against both the live path and the demo dataset (`tests/projections*.test.ts`) | ✅ Shipped |
| 0010.5 | Remove direct writes — the event append becomes the *only* write path | 🔴 Not started — **the risky cutover step; needs a go/no-go decision (below)** |
| 0011.1–4 | `tenants`/`persons`/`accounts` split, `tenant_id` backfilled everywhere, role moved off `users` | ✅ Shipped |
| 0011.6 | Repository layer enforcing `TenantContext` + Postgres row-level security, both proven with cross-tenant attack cases (`tests/tenant-isolation.test.ts`, `scripts/verify-rls.sh` / `npm run test:rls`, CI-blocking) | ⚠️ Layer shipped — **product call sites not yet migrated behind it** |
| 0011.5, .7 | Repoint FKs from `user_id` to `person_id`; retire `users` | 🔴 Deferred — low urgency (persons.id == users.id makes this a rename, not a data migration) |

All of this is additive and non-breaking: 327 tests pass, e2e is 17/17, and the app still
runs entirely on SQLite. **The Postgres cutover (ADR 0007) has not happened**, so RLS is
dormant, and product call sites still bypass `TenantContext` — see the enforced-versus-
dormant table above.

### Decisions taken — Platform Readiness Review, 2026-08-27

The founder review recorded in [`docs/adr/0013`](docs/adr/0013-event-authoritative-writes.md)
settled the three questions that were open here:

1. **ADR 0010 step 5 — HOLD, then execute in a gated window.** The cutover targets
   **2026-09-14 to 2026-09-18**, and runs only when all **ten go/no-go gates** pass. A
   partial pass is a no-go, and if the infrastructure or tenant-transaction work slips the
   window moves — the seven-day soak is not compressed to protect a date. Until then the
   application stays on verified dual-write.
2. **Next work — security and clinical definition**, not more migration. The clinician
   workflow determines PHI movement, permissions, alerts, exports, and review
   responsibilities, so it has to be defined before the enterprise foundations harden
   around guesses.
3. **BLS Part 6 — stays active** as a parallel clinical-validation workstream with its own
   reviewer, protocol owner, evidence owner, and schedule. Member-facing access remains
   gated until its own clinical and security conditions pass.

**Standing constraint through this entire build period:** only fabricated data. No real
patient, payer, or employee health data enters any environment (gate **G10**).

### Programme order

Step 5 is one foundation milestone; it does not by itself make Steady ready for clinical
testing, payer review, or public availability. The agreed order:

| Phase | Theme | Release boundary |
|---|---|---|
| 1 | Truth and workflow definition — current vs target architecture, Steady Clinical workflow, user/role map, PHI data flow, data classification, claims boundary | ✅ **Drafted 2026-08-27** — [`current-vs-target.md`](docs/architecture/current-vs-target.md), [`steady-clinical-workflow.md`](docs/clinical/steady-clinical-workflow.md); both need reviewer sign-off |
| 2 | Security foundation — threat model, risk register, vendor and BAA register, tenant/identity/secrets/logging, incident response, backup and recovery evidence | ◐ **Drafted 2026-08-27** — [`docs/security/`](docs/security/); needs external review, and its ten findings need owners |
| 3 | Permanent data spine — Postgres cutover, RLS active, Step 5 event-authoritative writes, provenance, corrections, retention, replay ops | Target Sep 14–18 |
| ∥ | BLS Part 6 validation — protocol, test plan, evidence, reviewer checkpoints, staged validation | Active throughout |
| ∥ | Institutional website redesign — audience pages, one claims registry, Trust Center, Evidence, FAQ, review gateway, demo legal copy, copy guard | ✅ **Built 2026-08-27** — §8.6, [`release-acceptance.md`](docs/site/release-acceptance.md); counsel review and a screen-reader pass are open |
| ∥ | Presentation layer — member score boundary, one type family, member components, navigation, patient directory, the paced gate | ◐ **Built 2026-08-28** — [`docs/site/presentation-layer.md`](docs/site/presentation-layer.md). **§6 session state machine is the next piece and is not started** |
| 4 | Steady Clinical prototype — caseload view, patient timeline, alerts, evidence-linked AI summaries, clinician feedback, review actions, audit history, BLS oversight | ✅ **Built 2026-08-27** — all eight surfaces; §9. Ready for synthetic clinician testing, which has not been run |
| 5 | Pilot readiness — rescoped clinical configuration, consent, protocol, training, support, monitoring, security review, counsel review, BAA completion | Before any real participant |
| 6 | Payer and enterprise testing — org administration, reporting, eligibility, population workflows, interoperability sandbox, pilot economics | After pilot foundation |
| 7 | Public or consumer decision — separate product posture, claims, support, safety monitoring, privacy, payments, accessibility, release review | Only after clinical and security review |

### The largest remaining gaps

Phase 1 and Phase 2 deliverables, none of which exist yet. These block two of the three
target audiences:

- ~~**Security package**~~ ✅ **Drafted** — [`docs/security/`](docs/security/). Ten
  documents covering trust boundaries, the threat model and nine behavioural-health abuse
  cases, the HIPAA Security Rule register, the vendor/BAA register and data-access map, the
  identity and privilege model, logging and monitoring, and a clinical-lane incident-response
  supplement. **Still needed:** an external reviewer, a named Security Official, and the
  founder inputs the vendor register depends on.
- **Clinical package** — caseload and priority workflow, patient timeline and evidence
  views, alert severity and response ownership, AI summaries with citations, clinician
  approval/correction/override, feedback taxonomy, escalation and re-entry workflow, pilot
  inclusion and exclusion rules, safety-monitoring responsibilities, the BLS Part 6
  validation and evidence packet, and a rescoped clinical sign-off packet.

Both packages must describe **current controls and planned controls separately**, and every
planned control needs an owner, a target phase, and an acceptance test. Contracts, BAAs,
security findings, account details, and reviewer reports need controlled storage — only
public-safe architecture belongs in this repository.

### Open founder actions

Tracked so they are not lost between sessions:

| # | Item | Needed for |
|---|---|---|
| 1 | Confirm near-term clinical scope: adults-only, supervised, synthetic-first, one organization, limited care team | Phase 1 |
| 2 | Name BLS Part 6's reviewer, protocol owner, evidence owner, validation schedule | Parallel workstream |
| 3 | Name clinical reviewers, healthcare and privacy counsel, intended security reviewer | Phase 2, ADR 0009 |
| 4 | Choose hosting direction; approve initial Postgres, secret, backup, monitoring, and test-environment budget | Phase 3 (Sep 3–5 window) |
| 5 | Decide what stays in the public repository vs a private security/clinical workspace | Phase 2 |
| 6 | Provide the expected vendor inventory (hosting, model, email, storage, monitoring, auth, analytics, support, billing) for the BAA register | Phase 2 |
| 7 | Repository governance: set `main` as protected default, require PRs and green checks, and close/update/supersede draft **PR #10** (opened against a long-superseded `main`) | Now |
| 8 | Set `EMDR_REVIEW_ACCESS_CODE` on the deployed instance and hand it to reviewers privately. Unset = the gateway is closed | Before any reviewer session |
| 9 | Run `npm run demo -- reset` against the deployed instance. Enrollment is now closed, so the reset will hold — run *before* sharing, not after | Before sharing the environment externally |
| 10 | Counsel review of the Demo Terms and Demo Privacy Notice, and a screen-reader pass over the institutional pages | Removing the "unreviewed" markings |
| 11 | Decide whether the horizon element reads as a covert score to a clinician (handoff §10 Q1) | Keeping or removing §7's signature element |
| 12 | Rewrite two soft leaks in the Autopilot card — "your window looks steady", and the sentence explaining why the day was not adjusted | Closing the last known member-surface leaks |

---

## Start here — pick your path

| If you are… | Read this | Why |
|---|---|---|
| **Building an investor deck** | The platform section above **first**, then [`docs/strategy/`](docs/strategy/), then [`docs/investor/Steady-Investor-Deck-Source.pdf`](docs/investor/) for the consumer-product inventory | ⚠️ The investor PDF predates the platform pivot and presents the consumer tiers as the thesis. It is still the best inventory of what the product *does*; it is **not** the current business narrative and should not circulate on its own. |
| **Evaluating / diligencing** | §1–§9 (what governs members today), §10 (autonomous engine), then [`docs/signoff-checklist.md`](docs/signoff-checklist.md) | The honest picture of what is live, what is gated, and exactly what each gate needs. |
| **Building on the API** | §1–§9, then §11 (data model) and [`openapi.yaml`](openapi.yaml) | The full gate chain, instruments, and scoring rules that any integration must respect. |
| **A clinician reviewing** | [`docs/clinical/steady-clinical-workflow.md`](docs/clinical/steady-clinical-workflow.md) **first** — it ends with eight decisions that need you — then §2, §4, §5, §10 and [`docs/autonomous/`](docs/autonomous/) | The workflow spec is a draft written to be argued with. The README sections give the instruments, scoring, gate chain, and the existing sign-off ledger — noting that `beta-clinrev-2026-07` was ratified for the *consumer* product and does not extend to the clinical surface. |
| **A security/compliance reviewer** | [`docs/architecture/current-vs-target.md`](docs/architecture/current-vs-target.md) **first** (data classification, PHI data flow with the complete egress list, claims boundary), then [`ADR 0013`](docs/adr/0013-event-authoritative-writes.md), then [`docs/adr/`](docs/adr/) 0009–0012 and [`scripts/verify-rls.sh`](scripts/verify-rls.sh) | ADR 0013 states current-versus-target most precisely and lists the ten cutover gates. The full security package (threat model, PHI data flow, BAA register, risk register) does **not exist yet** — it is Phase 2 and is named as a gap above, not glossed. |
| **Seeing it work** | The live demo (see §12) | Web + iOS, running the current build. |

**A note for deck builders.** Three rules, in order of how easily each is broken:

1. **Everything a member sees in §3 and §8 is real and running** — do not describe it as
   planned. Conversely, anything marked 🔴 or "gated" in §14, and every platform capability
   in the enforced-versus-dormant table marked ❌ or ⚠️, is **not** live and must not be
   presented as shipped.
2. **"Architected for" is accurate; "compliant with" is not.** Steady is not HIPAA
   compliant, has no BAAs, and has not been reviewed by counsel or a security assessor. The
   tenancy and event-history foundations anticipate that lane; they do not establish it.
3. **§10.3 of the investor PDF lists the marketing language banned in this product** — the
   ban is enforced automatically in CI and applies to the deck too.

---

**Who this document is for.** This README is the handoff spec for anyone building
skills/automation on top of Steady. It documents the **entire member workflow**, every
**instrument and questionnaire**, exactly **how each is scored**, and **how ongoing scores
open and close modules**. Everything in §1–§9 is implemented and live — this is the
**human-in-the-loop gate chain (`checkModuleAccess`) that actually governs members today**,
regardless of any flag. A **native iOS app** (`tprawlings-lang/Steady-ios`, SwiftUI) talks to
this backend through the mobile API under `/api/mobile/v1/*` (`src/app/api/mobile/`,
`src/lib/mobile/`; token auth in `src/lib/auth.ts`). §10 describes the **parallel autonomous
safety engine**: as of
config `beta-clinrev-2026-07` it has been **ratified by two independent licensed clinicians
(2026-07-22, approved *with conditions*)**, but it currently runs in **shadow** (computes +
audit-logs; the clinician console can simulate it) and is **not yet wired into member-facing
gating**. `EMDR_AUTONOMOUS_SAFETY=1` today only serves the autonomous ToS/privacy/consent
copy and labels the shadow audit `safety_routing`; making the engine actually govern module
unlocks is a remaining wiring step (§14.4), gated on the reviewers' conditions. So **members
are governed by §1–§9 whether the flag is on or off.** Build docs + the signed sign-off live
in [`docs/autonomous/`](docs/autonomous/).

---

## 1. The member workflow, end to end

Every member moves through this pipeline in order. Each stage is a hard gate: the next
stage is unreachable until the current one is satisfied, and every block reason is shown
to the member with a link to resolve it (never a dead end).

```
Signup (18+ DOB gate, wellness acknowledgment)
  → Subscribe (pick Base $6.99 / Plus $19.99 / Premium $34.99; every tier starts
    with a 7-day Premium trial; demo billing provider)
    → Informed consent (versioned stepper → consent ledger, scope care_program_full)
      → Program-fit screener (8 yes/no items; hard stop ⇒ 24h cooldown + auto-refund)
        → Baseline measures (PC-PTSD-5, PCL-5, ITQ, PHQ-9, GAD-7)
          → Profile onboarding (11 steps, below)
            → Dashboard
              → Daily loop: check-in → (companion daily chat) → modules/sessions
                → post-session check → weekly measures → program plan refresh
```

**Profile onboarding steps** (`/onboarding/profile`, resumable, in order):
`welcome → support → background → triggers → trigger-details → warning-signs →
readiness → safety-plan → companion → focus-chat → summary`

| Step | What is captured | Where it lands |
|---|---|---|
| support | Current therapist status, prior EMDR experience, goals (multi-select) | `user_profiles` |
| background | Trauma areas (broad strokes only — never event detail), restricted topics the companion must not raise | `user_profiles` (restricted topics are honored by the companion system prompt) |
| triggers | Trigger selection from a fixed catalog (5 categories) + custom entries | `user_triggers` |
| trigger-details | Per trigger: intensity **0–10** + typical responses (multi-select) | `user_triggers.intensity_score`, `common_responses_json` |
| warning-signs | Early somatic warning signs (multi-select from 15) | `early_warning_signs` |
| readiness | The readiness assessment (scored — see §4) | `readiness_assessments` |
| safety-plan | Grounding tools, support contact, reminder phrase, stop signs, careful topics | `safety_plans` (free text encrypted) |
| companion | Preferred name, tone, support modes, avoidances, memory on/off | `ai_companion_preferences` |
| focus-chat | Intake-style conversation with the AI companion; focus areas extracted to memory | `ai_conversations` / `ai_memory_items` (type `focus_area`) |

After onboarding, the member may optionally pick **care paths** (`/paths`, §7) — goal-based
routes over the module catalog. Paths shape recommendations and focus options; they never
loosen a gate.

---

## 2. Instruments & questionnaires — what is used and how each is scored

All instruments are public-domain, versioned, and stored per-response in `screenings`
(raw answers encrypted; risk flags in the clear for gating). Interpretation language
everywhere is "screen, not diagnosis."

### 2.1 Program-fit screener (`fitness-screener`, version `fit-v1-placeholder`)

Eight yes/no items, mandatory before baseline measures and any session. **Cannot be
skipped.** Answers are stored as coded 0/1 only, never free text.

| Item id | Question (abridged) | A "yes" means |
|---|---|---|
| `selfharm_30d` | Suicidal thoughts / self-harm urges, past 30 days | **hard stop** |
| `hospitalization_12m` | Psychiatric hospitalization, past 12 months | **hard stop** |
| `psychotic_dissociative_dx` | Diagnosed psychotic or dissociative disorder | **hard stop** |
| `substance_coping` | Currently dependent on substances to cope with memories | **hard stop** |
| `seizure_disorder` | Seizure disorder / photosensitive epilepsy | soft flag → sessions default to **audio-only** bilateral stimulation |
| `unsafe_situation` | Currently in crisis or an unsafe living situation | **hard stop** |
| `under_18` | Under 18 | **hard stop** (also blocked at signup by DOB) |
| `acute_medical` | Acute unstable medical condition / pregnancy-related severe distress | soft flag → gentler pacing + resources |

**Scoring:** any hard-stop "yes" ⇒ outcome `hard_stop`; otherwise any soft-flag "yes" ⇒
`soft_flag`; otherwise `pass`. **Effect of hard stop:** all sessions closed, member routed
to crisis resources, **24-hour cooldown** before retake (`RETAKE_COOLDOWN_HOURS = 24`),
and the current billing period is auto-refunded. After cooldown the screener may be
retaken. Wording finalized as `fit-v2-clinrev` and clinician-ratified (2026-07-22).

### 2.2 Baseline & ongoing measures

| Instrument | Items | Scale | Total | Positive screen | Risk items |
|---|---|---|---|---|---|
| **PC-PTSD-5** | 5 | Yes/No (0–1) | 0–5 | **≥ 3** probable PTSD | — |
| **PCL-5** | 20 | 0–4 ("Not at all"…"Extremely") | 0–80 | **≥ 33** probable PTSD | item 16 (risk-taking/self-harm) **≥ 3** ⇒ flag `elevated_risk_taking_or_self_harm_behavior` |
| **ITQ** | 18 | 0–4 | criteria-based (below) | PTSD criteria met | — |
| **PHQ-9** | 9 | 0–3 ("Not at all"…"Nearly every day") | 0–27 | **≥ 10** moderate depression | item 9 (suicidal ideation) **≥ 1** ⇒ flag `suicidal_ideation_screen_positive` |
| **GAD-7** | 7 | 0–3 | 0–21 | **≥ 10** moderate anxiety | — |

**Risk-item routing (hard rule):** a positive PHQ-9 item 9 or elevated PCL-5 item 16 never
triggers an autonomous assessment. The app shows scripted safety options (crisis screen)
and queues a same-day review alert. Structured suicide assessment (C-SSRS/SAFE-T class)
is intentionally **not** in-product.

**ITQ scoring (ICD-11, Cloitre et al.).** Items 0–5 are PTSD symptom *pairs*
(re-experiencing 0–1, avoidance 2–3, threat 4–5); items 6–8 PTSD functional impairment;
items 9–14 DSO pairs (affect dysregulation 9–10, negative self-concept 11–12, disturbed
relationships 13–14); items 15–17 DSO impairment. A pair counts when **either item ≥ 2**
("Moderately"). PTSD criteria = all three symptom pairs + ≥1 impairment item ≥ 2.
DSO criteria = same shape over 9–17. **Complex-PTSD** = PTSD + DSO both met.
Reported values: `ptsdSum` (items 0–5, /24), `dsoSum` (items 9–14, /24), and a label
("Complex PTSD criteria met" / "PTSD criteria met" / "Criteria not met") — always framed
as provisional and screen-based.

**Cadence:** all five at baseline (all required before modules open). **Weekly** PCL-5 +
ITQ thereafter — the dashboard flags "measures due" when none was taken in the last 7
days (soft prompt, not a gate). **Worsening alert:** week-over-week jump of **PCL-5 ≥ +10**
or **ITQ (ptsdSum+dsoSum) ≥ +8** queues a `symptom_worsening` review alert.

### 2.3 Daily check-in (`/check-in`, <90 seconds, once per calendar day)

Inputs: activation 0–10, shutdown 0–10, harm urge (y/n), feels safe (y/n), dissociation
0–10, sleep quality 0–10, substance flag (y/n), plus optional "today connects to these
triggers" picks from the member's trigger map.

**Deterministic routing (first match wins):**

| Condition | `recommended_action` | Effect on the day |
|---|---|---|
| harm urge **or** not feeling safe | `crisis` | All sessions paused; crisis screen; review alert |
| dissociation ≥ 7 **or** activation ≥ 8 **or** shutdown ≥ 8 | `grounding_only` | Only Calm Place + Containment open |
| substance flag **or** sleep ≤ 2 **or** dissociation ≥ 4 | `stabilization` | Gated (processing) modules closed; stabilization modules open |
| otherwise | `processing_ok` | All cleared modules open |

The check-in also **recalculates readiness daily** (§4) and, after submission,
auto-opens the companion's daily chat, primed with today's answers and flagged triggers.

### 2.4 In-session distress (SUDS, 0–10, rated between every set)

Deterministic rules from `session-safety.ts` (CI-blocking `@safety` tests):

| Rule | Threshold | Result |
|---|---|---|
| Hard stop | current **≥ 9** | Session ends, grounding flow, urgent/high alert |
| Pause | current **≥ 8** | Grounding + explicit member choice to continue/stop |
| Rise pause | current − session-start **≥ +3** | Same pause flow, even below 8 |
| Post-session cooldown | ending SUDS **≥ 8** | Gated modules closed for **24h** |
| Wind-down / cap | **35 min** wind-down banner, **45 min** hard cap | Session closes at cap |
| Daily cap | **1 gated (processing) session per 24h** (`EMDR_MAX_DAILY_PROCESSING`) | Further gated starts blocked until window passes |

A fixed **"Ground me"** button is always visible in-session: one tap, no confirmation,
halts stimulation, pivots to grounding, logs a safety event.

### 2.5 Post-session check (after every session)

Inputs: distress 0–10, oriented (y/n), safe-tonight (y/n), delayed-risk forecast 0–10,
recovery plan confirmed. **Escalation rule:** not oriented, **or** not safe tonight,
**or** distress ≥ 8, **or** delayed risk ≥ 8 ⇒ escalated. "Not safe tonight" additionally
redirects straight to the crisis screen and raises an **urgent** alert; other escalations
raise a **high** `post_session_review` alert.

### 2.6 Trigger intensity semantics

Trigger intensity (0–10) is captured in onboarding and in Module 5 (structured entry:
name, category, body location, accompanying belief, day-to-day disruption). **Intensity
≥ 7 is specialist territory**: those triggers are shown but *not selectable* as
self-guided session focus, are sequenced last in the program plan with an explicit
"bring to your specialist" approach, and the AI plan prompt is hard-instructed to never
sequence them for self-guided work.

---

## 3. Module catalog

Eleven session modules (orders 2–12; the daily check-in is conceptually slot 1). Tier
governs gating: `autonomous` opens by rules alone; `gated` additionally requires a
specialist unlock; `maintenance` has no prerequisites.

| # | Module id | Name | Tier | Prerequisites |
|---|---|---|---|---|
| 2 | `calm-place` | Calm Place setup | autonomous | — |
| 3 | `containment` | Containment and pause skills | autonomous | calm-place |
| 4 | `body-scan` | Body scan and dual attention | autonomous | containment |
| 5 | `trigger-map` | Trigger map and target inventory | autonomous | containment |
| 6 | `resourcing` | Resource strengthening | autonomous | calm-place |
| 7 | `recent-trigger` | Recent trigger desensitization | **gated** | trigger-map, resourcing |
| 8 | `safe-target` | Safe target processing | **gated** | recent-trigger |
| 9 | `installation` | Belief shift and installation | **gated** | safe-target |
| 10 | `future-template` | Future template rehearsal | **gated** | installation |
| 11 | `relational` | Relationship repair and self-concept | **gated** | resourcing |
| 12 | `maintenance` | Maintenance and relapse prevention | maintenance | — |

Sessions are built from typed steps (`instruction`, `suds`, `bls`, `grounding`,
`trigger-entry`). BLS sets are short by design (20–30s × 2–3 sets). Completing
`trigger-map` fire-and-forgets a **program plan** regeneration (§8).

---

## 4. Readiness scoring — the formula

Captured at onboarding, **recalculated on every daily check-in** (somatic inputs come
from today's check-in; slow-moving answers — support, self-reported readiness, pause
capacity — carry over from the latest stored assessment).

**Weighted 0–100 score:**

```
score = stability×1.5 + bodySafety×1.5 + presentConnection×1.0
      + (10 − symptomIntensity)×1.5 + sleepPoints×1.0 + supportPoints×1.0
      + readinessPoints×1.5 + pausePoints×1.0
```

Point tables: sleep good/okay/poor/very_poor = 10/6.5/3/0 · support yes/sometimes/no =
10/5/0 · processing readiness ready/curious/unsure/overwhelmed/not_now = 10/7.5/5/2.5/0 ·
pause capacity yes/think_so/not_sure/no = 10/6.5/3.5/0.

**Caps (safety over self-report):** risk flag `not_safe` ⇒ score forced to 0 (and routed
to crisis before scoring); `safe_now` ⇒ capped at 30; pause capacity "no" ⇒ capped at 60.

**Track mapping:** ≤30 `stabilization` · 31–60 `preparation` · 61–80 `gentle_processing` ·
81+ `full`.

**Track effects on module openings:** `stabilization` ⇒ only Calm Place + Containment;
`preparation` ⇒ all autonomous modules, no gated modules; `gentle_processing`/`full` ⇒
no readiness restriction (other gates still apply). Copy never implies failure — a low
track reads as "today is a grounding day."

**Daily-recalc input mapping** (check-in → readiness answers): stability =
10 − max(activation, shutdown); bodySafety = feels_safe ? 10 − dissociation : 1;
presentConnection = 10 − dissociation; symptomIntensity = max(activation, shutdown,
dissociation); sleep 0–10 mapped to good ≥7 / okay ≥5 / poor ≥3 / very_poor; risk flag
`safe_now` when harm urge or not feeling safe.

---

## 5. The module-access gate chain (exact order)

`checkModuleAccess(userId, module)` evaluates, in order — first failure blocks with a
member-visible reason + action link:

1. **Kill switch** — `EMDR_DISABLE_NEW_SESSIONS=1` blocks all new sessions globally.
2. **Active subscription + membership tier** — the guided module program is a
   Plus/Premium entitlement (§8.4); a Base member is blocked with an `upgrade`
   action (practices, lessons, Ground, and SOS all remain open — never a dead end).
3. **Informed consent** — scope `care_program_full`, unrevoked (the signup wellness
   acknowledgment does *not* satisfy this).
4. **Program-fit screener** — unanswered ⇒ blocked to `/screening`; hard-stop cooldown ⇒
   blocked to crisis resources.
5. **Baseline measures complete** — all five instruments.
6. **Profile complete** — onboarding finished.
7. **Today's check-in exists** — no check-in, no session.
8. **Check-in routing** — `crisis` blocks everything; `grounding_only` allows only
   Calm Place/Containment; `stabilization` blocks gated modules.
9. **Readiness track** (§4) — unless a clinician override is active for this module.
10. **Safety plan exists** — required before any gated module.
11. **Prerequisites completed** (§3) — unless a clinician override is active.
12. **Specialist unlock** (gated modules) — member requests; clinician approves/denies
    with a documented reason. A clinician may also **proactively open** a module
    (override) with a required, audited reason.
13. **Daily processing cap** — max 1 gated session per 24h.
14. **SUDS cooldown** — any session in the last 24h ending with SUDS ≥ 8 closes gated
    modules.

**Clinician override semantics (important for skills):** an override relaxes **pacing
gates only** — readiness track (9) and prerequisites (11). It never bypasses the safety
gates (1–8, 10, 13–14): a crisis check-in, fitness cooldown, or SUDS cooldown still
blocks the session even with an override active. Verified by the `@safety` suite.

---

## 6. How ongoing scoring affects module openings (the feedback loops)

| Signal | Cadence | Effect |
|---|---|---|
| Daily check-in | Every day | Routes the day (crisis / grounding_only / stabilization / processing_ok) **and** recalculates the readiness track |
| Readiness track | Recalculated daily | Widens or narrows which tiers are reachable (§4) |
| SUDS trail | Every set, in-session | Pause/hard-stop mid-session; post ≥ 8 ⇒ 24h gated cooldown |
| Post-session check | After every session | Escalation alerts; "not safe tonight" ⇒ crisis routing |
| Weekly PCL-5/ITQ | 7-day prompt | Trend charts; sharp worsening (≥ +10 / ≥ +8) queues review alert |
| Trigger intensities | Onboarding + Module 5 | ≥ 7 excluded from self-guided focus; ordering drives the program plan |
| Fitness screener | Once + on retake | Hard stop closes everything for 24h + auto-refund |
| Unlock decisions / overrides | Event-driven | Open or revoke gated modules (pacing only) |

Net effect: module availability is **recomputed from current state on every page load** —
nothing is "earned permanently" except completed-module prerequisites. A member who had
full access yesterday can be grounding-only today, and that is by design.

---

## 7. Care paths (goal-based routing)

Ten data-driven pathways (`src/lib/tracks.ts`) route members by *what they want to work
on*: PTSD & Trauma, Anxiety & Panic, Phobias, Recent Event, Grief & Loss,
Confidence/Performance, Low Mood (adjunct), Complex-Trauma Readiness, Cravings (adjunct),
Pain & Somatic (adjunct). Each carries an honest **evidence grade**
(high/moderate/emerging/specialist), contraindication tags, a module sequence, and a
**clinician-review level** (`optional`/`recommended`/`required`).

- Members can hold **multiple paths** at once and switch anytime.
- `required`-review paths are **stabilization/referral lanes**: regardless of their
  listed sequence, self-guided access is limited to stabilization modules
  (calm-place, containment, body-scan, resourcing, trigger-map) — never self-guided
  processing.
- The **rules-first recommender** (`track-recommender.ts`, version `track-rules-2026-06`)
  scores intake tags → weighted pathway candidates (top 3, with plain-language
  rationale). Its **safety gate runs before any scoring** and returns *no recommendation*
  if the fit screener is unanswered/cooling down, baseline measures are incomplete, or
  today's check-in flagged crisis. Paths shape recommendations and session focus options
  only — **module gating (§5) is unchanged by path membership.**

---

## 8. Program plan, AI companion & the member feature suite

**Program plan** (`program_plans`): regenerated when Module 5 completes (AI-drafted via
Claude with a strict JSON contract; deterministic rules fallback so a model outage never
leaves a member planless). Sequences triggers lowest-intensity-first, marks ≥7 as
specialist territory, prefers modules inside the member's chosen care paths, and keeps
`required`-review paths to grounding-only steps. Surfaced on the member dashboard, in
the specialist's member view (labeled advisory — "your unlock decisions outrank it"),
and as the first pre-session focus option in processing modules.

**AI companion** (`companion-ai.ts`, Claude `claude-opus-4-8`, adaptive thinking, low
effort): contexts are general chat, onboarding intake (`focus-chat`), and post-check-in
daily chat. Hard rules: a **deterministic crisis regex pre-filter always runs before the
model** — matches route to the scripted crisis interrupt (versioned
`crisis-script-v1`), never model improvisation. The system prompt embeds profile
background, restricted topics (never raised first), today's check-in, the trigger map,
and the program plan. Tools: `record_trigger`, `remember` (memory types incl.
`focus_area`, `grounding_tool`), `escalate_risk`. Member free text, memory values, and
chat messages are AES-256-GCM encrypted at the app layer (`enc1:` prefix,
`EMDR_DATA_KEY`). Companion memory is member-viewable, editable, and deletable. If no
`ANTHROPIC_API_KEY` is set, deterministic scripted flows run instead.

### 8.1 Prepare & Regulate practices (breathwork · meditation · movement · sleep)

One content-service pattern (`src/lib/practices.ts`) serves all practice types to both
web and iOS: **code-defined catalogs** (like `MODULES` / `INSTRUMENTS`), only
**completions** touch the DB (`practice_completions` + audit + a light companion-memory
note). All content is **deterministic data — no produced media, no content pipeline**:

- **Breathwork** (5 patterns, paced visual pacer; iOS adds Core Haptics): no-hold
  variants always exist, holds are flagged, and **titration** surfaces gentler/no-hold
  patterns first when today's check-in is elevated (dissociation ≥ 4, activation ≥ 7, or
  a grounding/stabilization day).
- **Meditation, sleep wind-downs, and gentle movement** are guided **segment scripts**
  (beat-by-beat text with pacing), read aloud by the same on-device TTS the sessions use
  (voice toggle; text always shown). Trauma-informed copy: orienting/eyes-open options
  first, explicit permission to skip or stop, seated options for movement, and sleep
  scripts that deliberately trail off into permission to sleep. Movement ships only the
  form-free subset (nothing needing demonstrated technique).
- **Prepare-for-session on-ramp**: the session player offers the gentlest breathwork
  before starting; prepared starts are audited (content-free) so prepared-vs-unprepared
  hard-stop rates are measurable.

Web: `/practices/breathe|meditate|move|sleep`. Mobile: `GET /api/mobile/v1/practices?type=…`
(safety-ordered per member per day) + `POST /practices/complete`.

### 8.2 Psychoeducation micro-lessons

`src/lib/lessons.ts`: 7 short trauma-informed reads (window of tolerance, why the method
works, triggers, grounding, titration, self-compassion, calm place) — code-defined
markdown, safe server-side renderer (no `dangerouslySetInnerHTML`), per-user read
tracking (`lesson_reads`, idempotent). Lessons cross-link to related modules and appear
inside the session player intro. Web `/learn`; mobile `GET /lessons` + `POST /lessons/read`.

### 8.3 SOS panic button (member-initiated relief)

A persistent SOS button on every member screen (web `SosMount`/`SosButton`; iOS overlay
on all tabs). One tap opens relief assembled from the member's **own plan**: a paced
grounding breath, their saved calm place, their grounding tools, a one-tap call/text to
the safe person they named (tel:/mailto: auto-detected), the crisis line, and 911.
Distinct from `/crisis` (the escalation the safety gate forces): SOS is relief the member
reaches for. Opening it logs a **coded** safety event only (`sos_opened` — types/ids,
never content; compliance 4B.4). Never tier-gated. Mobile: `GET /sos` + `POST /sos/open`.

### 8.4 Membership tiers, entitlements & the upsell engine

Three tiers (`src/lib/billing.ts` `PLANS`; competitive analysis vs. Calm / Headspace /
Insight Timer / Sanvello / Balance, which cluster at $9–15/mo for content-only products):

| Tier | Price | Positioning | Includes |
|---|---|---|---|
| **Base** | $6.99 | A calmer daily practice | Check-ins, all §8.1 practices, lessons, Ground, SOS, companion **1×/week** |
| **Plus** | $19.99 | A program that remembers you | + guided module program, measures/trends, **unlimited companion with memory** |
| **Premium** | $34.99 | Steady runs your program with you | + **Autopilot** (§8.5), live/voice sessions, priority specialist review |

Every new membership starts as a **7-day trial that runs at Premium** (status `trialing`
⇒ premium entitlements) — billing then starts on the chosen tier
(trial-the-top-then-downsell is the conversion engine). Legacy `monthly` $34.99 rows
grandfather to Premium. `src/lib/entitlements.ts` is the **single source of truth**
(`getTier` / `getEntitlements`); **safety surfaces are never tier-gated** (hard
invariant).

**Enforcement:** the module gate (§5 step 2); the **Base weekly companion cap**
(`src/lib/upsell.ts` `companionAllowance` — the first non-risk message opens a
"companion day," that calendar day stays open, then the window rests 7 days; **crisis is
exempt twice over**: checked before the cap, and risk-flagged messages never count);
and **memory recall gating** (`getModelExposableMemoryItems` returns nothing on Base —
writes continue, so nothing is lost on upgrade, and members always see their own memory
in Settings).

**Earned upsell engine** (`maybeUpsell`): recommendations fire only on a real signal
from the member's own data — `trial_winback` (fresh post-trial members, referencing
their Premium week), `plus_fit` (Base + ≥2 recurring named triggers), `premium_fit`
(Plus + a hard-stopped session or ≥3 elevated check-ins in 14 days). Global 5-day +
per-kind 14-day cooldowns; Premium members never pitched; nothing attached to crisis or
risk-flagged exchanges; every suggestion recorded (`upsell_events` + audit) for
conversion analysis. The UI renders suggestions as a distinct dismissible card — never
companion speech.

### 8.5 Autopilot — the Premium autonomous care loop

`src/lib/autopilot.ts`. Plus *remembers* you between sessions; Premium *acts* between
them. Deterministic (no model call composes anything), auditable, and **only ever
narrows a day**:

1. **Daily plan composer** — on the first open of the day, composes a concrete plan from
   today's check-in, the program plan, titrated practice selection, and unread lessons.
   No check-in yet ⇒ the plan leads with it and **recomposes when the check-in lands**
   (stable otherwise; idempotent per day in `autopilot_plans`). Every session item
   passes `checkModuleAccess` — the same server-side gate as the session player; crisis
   days compose a support-only plan.
2. **Proactive outreach** — the companion speaks first on coded signals:
   `missed_checkins` (3+ day gap), `measure_worsening` (two-score deltas: PCL-5 +10,
   ITQ +8, PHQ-9/GAD-7 +5), `streak_milestone` (5+ practices this week). Delivered into
   the companion thread *and* onto the plan (honest in-app delivery until push exists).
   Global 3-day + per-kind 7-day cooldowns (`autopilot_events`); every send audited.
3. **Adaptive pacing, made visible** — each plan carries a `pacingNote` explaining what
   Autopilot adjusted and why.
4. **Continuous risk watch** — worsening measures also open an early clinician alert
   (`autopilot_risk_watch`, coded types only, 14-day cooldown).
5. **Priority specialist review** — Premium unlock requests queue at high severity with
   a priority label; the clinical bar for the decision is identical on every tier.

Dashboard renders the plan as the day's centerpiece for Premium members;
`GET /api/mobile/v1/autopilot/today` serves iOS.

### 8.6 The public surface — institutional, not retail

**Replaced 2026-08-27** under the Institutional Website Redesign Handoff. The previous
surface was a well-built page for a transaction Steady is no longer making: a pricing
hero, tier cards, a free-trial CTA, and a testimonial band. Public enrollment and
subscription billing are closed, so a page whose primary action is "subscribe" was not
merely off-message — it was offering something that does not exist.

The site now addresses four audiences (clinical, organization, payer, security) with
investor material in a secondary band, and its single call to action is **request a
review**. There is no purchase path anywhere on it.

| Route | Purpose |
|---|---|
| `/` | What Steady is, who it is for, what can be reviewed today, what it is not approved to do |
| `/platform` · `/clinical` · `/organizations` · `/payers` | The three layers, and one page per audience |
| `/about` | Why Steady exists, the stage it is honestly at, and how we build |
| `/trust` | Control status (current / dormant / planned), egress table, and the known-gap register |
| `/evidence` | Method evidence, software evidence with runnable commands, evidence still needed, BLS Part 6 |
| `/faq` | Seven groups, every answer leading with Yes / No / Not yet / In the fabricated demo only |
| `/demo` → `/demo/[path]` | The four-step review gateway (§12) |
| `/terms` · `/privacy` · `/accessibility` | Demo-scoped, marked **pending counsel review** |
| `/crisis` | Unchanged. No chrome, no navigation, no marketing — one thing to do |
| `/signup` · `/subscribe` | Retired. Closed pages that explain themselves; nothing links to them |

**One registry, not per-page copy.** Every status label comes from
`src/lib/site/registry.ts`, where each capability carries a status, an owner, a review
date, evidence, and the audiences it may be shown to. A page cannot label itself. This is
what stops two pages from disagreeing about whether a control is active — a disagreement
neither author would notice, and that a security reviewer has no way to resolve.

**The review gateway (`/demo`).** No credential appears on any page. A reviewer enters a
code given privately (`EMDR_REVIEW_ACCESS_CODE`; **unset means closed, not open**), chooses
a review path, and picks a fabricated persona. Scope is enforced server-side: a read-only
path is never offered a write-capable role, and the grant cookie — not the URL — decides
which path opens. Every attempt is audited.

**Copy guardrails.** `tests/public-copy-guard.test.ts` (27 cases) scans **source**, so a
violation fails in the commit that introduces it rather than after a deploy. It is not a
banned-word list: "HIPAA compliant" is permitted inside an explicit denial and forbidden as
a claim, and every occurrence is checked, not just the first. It also enforces registry-sourced
statuses, FAQ verdicts, control evidence discipline, and that the demo legal documents still
say counsel has not reviewed them. The guard was verified adversarially — see
`docs/site/release-acceptance.md` §2.

`src/app/robots.ts` disallows all crawling. The review environment is not a public site.

---

## 9. Current human-oversight touchpoints (what exists today)

Skills authors should know exactly where a human is in the loop **today**:

1. **Gated-module unlocks** — member requests; clinician approves/denies with a
   documented reason (or proactively opens/closes via override, pacing gates only).
2. **Alert queue** — urgent/high/moderate alerts (hard stops, risk items, post-session
   escalations, symptom worsening, unlock requests) reviewed with a required note.
3. **Member detail review** — screening history, trends, sessions, unlock + consent
   ledgers, AI-drafted program plan (advisory).
4. **Steady Clinical console** (`/clinician/clinical`) — caseload banded by clinical need
   with a mandatory written reason per band, an event-sourced timeline that marks
   reconstructed history separately, summaries whose every claim cites resolvable events,
   and approve / correct / override as three distinct actions with three distinct audit
   records. An override relaxes pacing only and can never relax a safety stop.
5. **Audit history and alert trails** (`/clinician/clinical/[id]`, `/clinician/alerts/[id]`)
   — who touched a record and when, and one alert followed from creation to closure. Both
   are tenant-scoped, withhold free-text fields, and display the hash-chain verification
   result rather than asserting the log is append-only.
6. **BLS Part 6 oversight** (`/clinician/bls`) — the six protocol gates, the 4a/4b/4c
   rollout ladder, the pre-registered thresholds, and the five hard stopping criteria,
   reported against the configuration **actually running**. A signed protocol and a live
   flag disagreeing is the failure this page exists to make visible; desensitization is
   disabled in the safety configuration itself, so no environment variable can open it.

7. **Clinician testing console** (`/clinician/testing`) — what a reviewer can exercise,
   read from live configuration, and a change-request form on every clinical screen.
   Notes capture what was seen and what is wanted as separate fields, stamp the policy
   and safety-config versions automatically, keep the reviewer's own priority, and
   export as Markdown. They **survive a demo reset** — a reviewer's hour outlives the
   environment it was spent in.

Everything else — screeners, check-in routing, SUDS rules, cooldowns, caps, readiness,
the recommender — is **already deterministic and autonomous**.

### Demo posture — operational for review, not gated by caution

**In a demo environment (`EMDR_DEMO=1`), everything gated only by deployment caution is
on.** The data is fabricated, so there is nobody to protect by keeping a workflow shut,
and a reviewer who cannot run a workflow cannot give feedback on it. On by default:
resourcing BLS (Part 6 stage 4a), the full gated module set, voice input, live spoken
sessions, and the companion output guard in **enforcing** rather than log-only mode.

Three things stay off, and none of them is caution:

| Held back | Why | Who can change it |
|---|---|---|
| Autonomous desensitization (BLS 4b) | Disabled in the safety configuration two licensed psychologists signed, and **not implemented**. Professional-body policy opposes self-administered desensitization and that question is unresolved | The clinicians who signed it, with counsel |
| The autonomous engine *governing* access | It computes and logs a parallel decision while the human-authored chain decides. Running both side by side is what makes the comparison reviewable — promoting it early removes the thing under review | Clinical reviewers, against their stated conditions |
| Event-authoritative writes | ADR 0013; held for its gated migration window rather than switched on mid-review | Founder, at the Postgres cutover |

Both directions of the module gate are reachable: `EMDR_OPEN_GATED=0` closes the gated
set so the **request-and-approve workflow itself** can be reviewed. The kill switches
still override everything, and none of this reaches a real deployment — every demo
default is inert without `EMDR_DEMO=1`, asserted in both directions by tests.

---

## 10. Autonomous safety engine — clinician-ratified (with conditions); governs when enabled

**Status (config `beta-clinrev-2026-07`): the deterministic safety architecture is built,
deployed, and — as of 2026-07-22 — clinically ratified by two independent licensed
psychologists (approved *with conditions*; signed record in
[`docs/autonomous/`](docs/autonomous/)).** But it is **not yet the governing decision-maker
for members.** `shadowDecide()` computes + audit-logs the engine's decision at session start
as a `void` call that *"never affects this session"* — the live gate is still
`checkModuleAccess` (§5). `EMDR_AUTONOMOUS_SAFETY` currently controls only two things:
**default off** → audit label `safety_routing_shadow` + human-in-loop legal copy; **`=1`** →
audit label `safety_routing` + autonomous legal copy. **Neither setting wires the engine into
module gating** — that (the session-UI / auto-unlock wiring) is a remaining implementation
step (§14.4), and real-member governance stays gated on the reviewers' conditions (the
deployment-evidence gates — independent privacy/security review + human-factors testing — and
no autonomous BLS in beta, [`docs/autonomous/evidence/`](docs/autonomous/evidence/)). Built
faithfully from the five-volume corpus; the clinical-review change set (no autonomous BLS,
diagnosis/history → human review, numeric scores → review triggers, DES-II omitted, PCL-5
item 16 de-scoped as a suicide proxy, "readiness" → Educational Access State) is in the
ledger changelog.

**The one architectural rule (all five volumes agree):** safety decisions are deterministic
and verified; the AI companion is advisory only and is *structurally prevented* from making,
reversing, or clearing any safety decision. "Increasing uncertainty must reduce intervention
intensity." Autonomy here means *more deterministic automation of clinician-validated rules*
— never *the AI deciding more*.

### What is built (all pure, tested, flag-gated — `src/lib/safety/`)
1. **Deterministic safety core** — a permission-intersection engine + machine-ID rule table
   (Vol II §13); most-restrictive-wins; missing input never defaults favorably; every
   routing decision produces a content-free audit record.
2. **Scoring to spec** — state/trait program-fit, caps-based readiness, item-level
   instrument safety (PHQ-9 q9, PCL-5 q16), narrow-only daily route. Runs in shadow on real
   data at session start (`safety_routing_shadow` audit events).
3. **Session-runtime engine** — starting-SUDS gate, post-set containment rules, one-tap
   Ground-Me, mandatory closure, BLS limits. Never auto-starts a set; every stop absolute.
4. **Companion memory + output guard** — 6-class memory with provenance + graceful
   forgetting; a deterministic validator that blocks the corpus's "never-say" outputs
   (simulated feelings, asserted internal states, diagnosis, cure claims, false monitoring,
   reprocessing instructions, dependency).
5. **Journey orchestration** — the 22-stage journey with a named owner per transition; the
   orchestrator personalizes within the gates and only *consumes* the risk engine (never
   invents an escalation).
6. **Governance** — kill switches (generative conversation / provider sharing / escalation
   automation), config-as-code snapshot, and `/api/safety-status` (mode, version, stages).

~200 safety-suite tests (259 total across `tests/*.test.ts`, run by `npm run test:safety`),
including end-to-end red-team harnesses (`tests/safety-redteam.test.ts`, `tests/bls-redteam.test.ts`).

### How a clinician validates and signs off
The clinician-only **Autonomous Review console** (`/clinician/autonomous`) is the sign-off
workbench: simulate any gating scenario and see exactly what would be gated/passed and *why*
(every rule fired, by name); simulate an in-session step (SUDS → containment/closure); test a
companion message against the output guard; review the real shadow decisions logged during
beta; and record **Agree / Needs-change** per rule (written to a register + the tamper-evident
audit log, exportable as CSV). All thresholds are **provisional** and tracked in
[`docs/autonomous/01-signoff-ledger.md`](docs/autonomous/01-signoff-ledger.md), including the
Volume II numeric conflicts the clinician must resolve.

### Path to launch (staged, per the corpus)
shadow → clinician walks the console + ratifies the ledger → flip `EMDR_AUTONOMOUS_SAFETY=1`
**one stage at a time** (kill switches available per capability) → governing → full launch.
Blocking before it governs a real member:

1. **Every "specialist review" claim must change** — marketing/FAQ/dashboard/module copy,
   ToS/consent, and `COMPLIANCE.md` currently promise human review; shipping autonomy without
   rewriting these makes existing claims false. *(Pending founder handoff — §14.3.)*
2. **Counsel re-confirms the wellness-lane posture with oversight removed** (the June 2026
   build handoff named a live-clinician gate as non-negotiable).
3. **Independent licensed clinician (≥2) sign-off** on scope/thresholds/stop rules/crisis
   routing via the review console + ledger — the deterministic rules inherit the safety role
   the clinician held.
4. The `@safety` + safety-core suites (done) stay green; kill switch + fitness screener +
   SUDS rules remain non-negotiable substrate.

---

## 11. Data model quick reference

`users` (+dob) · `consents` (versioned, scoped) · `screenings` (all instruments incl.
fitness screener; answers encrypted) · `checkins` (one/day, `recommended_action`,
`triggers_json`) · `readiness_assessments` (scored, `recommended_track`, source
onboarding/checkin) · `user_profiles` / `user_triggers` / `early_warning_signs` /
`safety_plans` · `therapy_sessions` (pre/post/peak SUDS, status incl. `hard_stop`,
`hard_stop_reason`) · `post_session_checks` (escalated flag) · `module_unlocks` (status,
`override`, decision reason) · `alerts` (severity, review note) · `care_tracks` /
`care_track_intake` · `program_plans` (encrypted plan JSON, generated_by ai/rules) ·
`ai_conversations` / `ai_messages` / `ai_memory_items` / `ai_companion_preferences` ·
`subscriptions` (plan base/plus/premium; trialing ⇒ premium entitlements) / `payments` ·
`practice_completions` (§8.1) · `lesson_reads` (§8.2) · `upsell_events` (§8.4) ·
`autopilot_plans` / `autopilot_events` (§8.5) · `audit_log` (append-only; identity,
consent, clinical, module runtime, specialist actions, billing, safety, security).

Encrypted-at-app-layer fields carry the `enc1:` prefix (AES-256-GCM, `EMDR_DATA_KEY`,
legacy plaintext passthrough).

---

## 12. Running locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. SQLite data lives in `.data/` (gitignored).

**Live demo:** <https://steady-emdr-demo.onrender.com> — runs with `EMDR_DEMO=1`, so the
seeded dataset and the demo-only roadmap strip are visible. Sign in as the member below to
see the Premium dashboard with the Autopilot plan as its centerpiece.

**Demo accounts** (seeded on first run, development only):
Member `demo@example.com` / `demo1234` · Clinician `clinician@example.com` / `demo1234`.
With `EMDR_DEMO=1` a rich fictional dataset seeds instead (Alex pays for **Premium** —
so the Autopilot plan renders — and Sam is mid **Premium trial** with billing set to
start on Plus).

**Tests & CI:** `npm run test:safety` runs the CI-blocking `@safety` suite (screener
hard stops, SUDS rules, check-in routing, crisis regex, track-recommender safety gate)
plus the **autonomous safety-core suite** (the deterministic engine, scoring, session
runtime, companion guard, journey orchestration, governance, resourcing/BLS, and a
red-team harness — §10) plus the member-feature suites (practices, lessons, SOS,
entitlements/tiers, upsell + companion cap, Autopilot). **259 tests** total across
`tests/*.test.ts`.
`npm run test:e2e` runs the Playwright suite — **17 tests**: critical unauthenticated
surfaces, security headers, signup gates, the clinician console, and an axe-core WCAG-AA
audit that blocks on any serious/critical violation. Hermetic by default, or point at a
deploy with `E2E_BASE_URL`. (In a sandbox with a pre-installed browser, set
`PLAYWRIGHT_CHROMIUM_PATH` rather than downloading one.)
CI (`.github/workflows/safety.yml`) blocks on `@safety` + build + `npm audit`
(high/critical) + the e2e smoke suite + a banned-vocabulary grep over product copy;
a nightly `load` job (`.github/workflows/load.yml`) runs `npm run loadcheck`
(autocannon) and fails on p99/error-rate breach of the discovered single-instance
baseline (`docs/load-test/README.md`).

**Deploy:** production `Dockerfile` (standalone output); Render blueprint
(`render.yaml`) with persistent disk at `/data`. **The deploy branch must be `main`** —
`render.yaml` declares it, but a Render service can hold its own branch setting that
overrides the blueprint. If the live site is serving stale content while `main` is
current, check the service's branch first (a July 2026 repo restore left the service
pinned to a recovery branch, and it silently redeployed the same old commit for days —
the tell is a build log where every Docker layer reads `CACHED`). Nightly encrypted backups to
Cloudflare R2 with 30-day retention once `R2_*`, `BACKUP_AGE_RECIPIENT`, and Resend
alert vars are set (see [`docs/backups.md`](docs/backups.md), `make restore-test`).
Env vars of note: `ANTHROPIC_API_KEY` (companion + AI plans), `EMDR_DATA_KEY`
(field encryption), `EMDR_DISABLE_NEW_SESSIONS` (kill switch),
`EMDR_MAX_DAILY_PROCESSING` (default 1), `BACKUP_HOUR_UTC` (default 3).
Autonomous safety core (§10): `EMDR_AUTONOMOUS_SAFETY` (default off — governs only
after clinician sign-off), and the emergency kill switches `EMDR_KILL_GENERATIVE`
(companion → static safe info), `EMDR_KILL_PROVIDER_SHARING`, `EMDR_KILL_ESCALATION`.

## 13. Stack

Next.js (App Router, server actions, standalone output) · TypeScript · Tailwind CSS ·
better-sqlite3 · Anthropic SDK. No ad-tech, no analytics pixels, no third-party
trackers — by design. The clinician-designed **deterministic safety core** lives in
[`src/lib/safety/`](src/lib/safety/) (pure, ~200-test suite, shadow-mode, flag-gated — §10),
surfaced for review at `/clinician/autonomous` and `/api/safety-status`.

## 14. Before any real-world use (wellness-lane launch gates)

Full detail in [`COMPLIANCE.md`](COMPLIANCE.md); the live founder checklist with
severities is [`docs/audit-open-items.md`](docs/audit-open-items.md).

**One-page consolidated tracker:** [`docs/signoff-checklist.md`](docs/signoff-checklist.md)
merges this section with the sign-off ledger, the evidence package, and the BLS Part-6
package into three buckets — signatures still needed (counsel / clinicians / founder),
gates needing execution + evidence + acceptance, and built work deliberately on hold
until a signature lands — plus **§4 "signing packets"**, which groups every item by who
signs it so engagements can be booked in parallel rather than serially.

### 14.1 Founder to-do — outside accounts you need to set up 🔴

These require **you** to sign up for an outside service. None are needed for the
demo; they are the gates to a real launch:

- [ ] **Login + 2-factor provider** (e.g. Auth0 / Clerk / WorkOS) — for MFA and an
  admin realm. Interim in place: scrypt + signed cookies, login lockout,
  7-day-idle / 30-day-absolute sessions.
- [ ] **Email provider** (e.g. Resend — already coded, just needs the API key) —
  unblocks password reset, lockout notices, pre-charge reminders, retention
  warnings, and backup-failure alerts.
- [ ] **Stripe** — real hosted checkout with **three prices** (Base $6.99 / Plus
  $19.99 / Premium $34.99) + the 7-day Premium trial (§8.4). Safety auto-refund,
  2-click cancel, and plan changes already work against the demo provider. Before
  public launch, also re-verify competitor pricing (the §8.4 analysis is from
  training-data snapshots, not live pages).
- [x] **EMDR-trained clinical advisor** — ✅ **DONE (with conditions), 2026-07-22.** Two
  independent licensed psychologists ratified the screener wording (finalized `fit-v2-clinrev`),
  crisis script, session scripts, and the **autonomous safety rules** (§10) at config
  `beta-clinrev-2026-07` — all rules Agree, all numeric conflicts Confirm
  ([`docs/autonomous/01-signoff-ledger.md`](docs/autonomous/01-signoff-ledger.md); signed
  [`PDF`](docs/autonomous/clinician-signoff-SIGNED-2026-07-22.pdf)). Conditions: complete the
  §14.2 evidence gates and keep autonomous BLS disabled before governing a real member.
- [ ] **Cyber liability insurance** quote ([`docs/incident-response.md`](docs/incident-response.md)).
- [ ] **Branded domain + support email** — unblocks the ToS contact placeholder.

### 14.2 Drills & evidence to run (need the accounts above)

- [ ] **Off-site backups** — set `R2_*` + `BACKUP_AGE_RECIPIENT`, then run
  `make restore-test` (RPO 24h / RTO ~1h).
- [ ] **Security/accessibility evidence** — companion red-team pass, ZAP scan,
  SSL Labs record. (Automated already: `gitleaks` secret scan, `npm audit`,
  Dependabot, and the axe-core WCAG gate.)

### 14.3 Founder decisions

- [x] Companion transcripts — **keep encrypted persistence** (decided).
- [x] CSP hardening — **nonce-based, done** (ADR 0008).
- [x] Zero-downtime deploys — **approved** (ADR 0007); migration steps tracked in §14.5.
- [ ] **Autonomous-model claim rewrite** (§10) — pending founder handoff.

### 14.5 Infrastructure — Postgres cutover (required before live mode, not demo)

The demo runs single-instance on SQLite, which forces a brief outage on every deploy.
The Postgres migration (ADR 0007) that makes deploys zero-downtime and lets the app run
more than one instance is now **code-complete and verified on a real Postgres 16 cluster**
(boot + round-trip + audit-chain verify + `pg_dump` backup). What remains is **OPS only** —
detail in [`docs/go-live-runbook.md`](docs/go-live-runbook.md) §4 and
[`docs/pg-migration-progress.md`](docs/pg-migration-progress.md).

- [x] PG schema + driver (`scripts/pg-schema.sql`, dual SQLite/PG data layer).
- [x] Async data-access layer — **every app `getDb()` call site ported** (0 remaining).
- [x] Dialect-neutral SQL (no SQLite-only `datetime('now')` / `julianday` / `INSERT OR IGNORE`).
- [x] Backup/restore `pg_dump` path (custom-format archive; keeps RPO 24h / RTO ~1h).
- [x] **Verified on real Postgres 16** — app boots + serves, data round-trips, the audit
  hash-chain transaction verifies, relative-date queries work, `pg_dump` archive restorable.
- [ ] **OPS — provision Render Postgres** (~$7/mo), set `DATABASE_URL` + `EMDR_DB=postgres`. 🔴
- [ ] **OPS — one-time load** of existing SQLite data into Postgres, then flip. 🔴
- [x] Audit-chain serialization for concurrent writers — **done in code**
  (transaction-scoped Postgres advisory lock in `audit()`; covers the genesis case).
- [ ] **OPS — scale past one instance**: set `numInstances ≥ 2` for automatic rolling,
  zero-downtime deploys (no code change left). 🔴

### 14.4 Autonomous safety system (§10) — status

- [x] Built from the clinician corpus (safety core, scoring, session engine, companion
  guard, journey orchestration, governance) — pure, ~200 tests, red-team harness.
- [x] Deployed + clinician review console with per-rule Agree / Needs-change sign-off and
  CSV export. **Ratified (with conditions) 2026-07-22.** Still shadow — the flag swaps legal
  copy + audit label only; the engine is **not yet wired to govern module gating** (see below).
  Real-member launch gated on the §14.2 evidence gates.
- [x] **Therapy knowledge base** — file-based, clinician-reviewable technique library
  (8 modalities, deterministic tier/activation/dissociation-gated retrieval; crisis tier
  gets none; output guard still validates every reply). Browsable + sign-offable at
  `/clinician/autonomous#therapy-kb` (`KB_*` rows). Modality list provisional pending the
  founder's reference sheet. 🔴
- [x] **Live spoken sessions** (hands-free voice + dynamic in-session responder) — the
  member can speak during a session without pressing anything, and the system responds
  dynamically from memory + rules + the therapy KB. Safety by construction: the
  deterministic session engine still owns every clinical decision (the responder returns
  words + at most a Ground-me hint, never moves a set); crisis/high-activation replies are
  scripted (→ Ground-me + 988, never AI); every line passes the output guard with a
  deterministic fallback. Demo/flag-gated (`EMDR_LIVE_SESSION`), off for real members.
  Voice/biometric consent is **counsel-approved** (`voice-consent-v1.0`) and the gate is
  wired (`/settings/voice` → `liveAvailableFor`): flag on + member consent = available.
  Remaining: clinician sign-off (`LIVE_SESSION_*`) + the flag flip. 🔴
- [x] **Voice responses** (member answers a free-text reflection by speaking) — live in
  demo (`EMDR_VOICE_INPUT` / on with `EMDR_DEMO`), off by default for real members. Typing
  is always available; recognition is confirm-before-submit; free-text only (never SUDS or
  safety gates); on-device in the shipped app. Reviewable + sign-offable on the clinician
  console (`/clinician/autonomous#voice`, `VOICE_INPUT_*` in the register). Voice/biometric
  consent is **counsel-approved** (`voice-consent-v1.0`) and the gate is wired
  (`/settings/voice` → `voiceAvailableFor`); remaining before non-demo: the flag flip. 🔴
- [x] **Spoken session guidance (on-device TTS)** — the calm-place / resourcing sessions now
  *speak* the deterministic narration and a short directive cue at the start of each set
  (personalized to the member's place, shown on screen too), on top of the text. Every spoken
  line is the same output-guard-clean deterministic copy — no generative speech during a set.
  On-device only (Web Speech API; nothing uploaded) → no consent impact; a Voice on/off toggle
  mutes it. The most natural installed voice is auto-selected (not the robotic default), audio
  + speech unlock in a tap for iOS/iPadOS, and BLS tones play by default. Both stimulation
  modes (moving dot / audio-only) remain a member choice. Truly-natural (human/neural) voice is
  the next step — plan in **§14.6**.
- [x] **Clinician sign-off** on the rules + Volume II conflict resolution — ✅ **DONE
  (with conditions), 2026-07-22.** Two independent licensed psychologists (Altschuler
  PSY-005804, Allen PSY-002055) ratified config `beta-clinrev-2026-07`: all rules Agree,
  all Section-A items Confirm. Signed:
  [`docs/autonomous/clinician-signoff-SIGNED-2026-07-22.pdf`](docs/autonomous/clinician-signoff-SIGNED-2026-07-22.pdf).
  Conditions: complete the Part 4 evidence gates (§14.2) and keep autonomous BLS/reprocessing
  disabled before the flag flips.
- [x] **Legal copy (ToS / Privacy / consent)** — counsel-approved autonomous rewrite is
  applied **flag-aware**: current human-in-loop copy stays live; the `*-autonomous`
  versions + automated-decision-making disclosure serve automatically when
  `EMDR_AUTONOMOUS_SAFETY` flips. Change-set:
  [`docs/autonomous/02-policy-and-copy-changes.md`](docs/autonomous/02-policy-and-copy-changes.md).
- [ ] **Product microcopy** (`gating.ts` unlock strings, dashboard care-team) still says
  *waiting for your specialist's review* — reword to rule-based language **with** the flag
  flip + session-UI wiring (deferred until auto-unlock is wired). 🔴
- [ ] **Flip `EMDR_AUTONOMOUS_SAFETY=1`** (one stage at a time) + wire the session UI /
  dashboard to the engine — only after sign-off. 🔴

### 14.6 Natural (human / neural) session voice — plan

Today's spoken guidance uses **on-device TTS** with the best installed voice auto-selected.
For a genuinely soothing, meditation-grade narrator, the plan is to **pre-render the fixed
lines once and ship them as static audio**, played in place of TTS, with on-device TTS as the
fallback for any line that has no clip.

**Why pre-render fits this app:** the narration beats and cue templates are **deterministic**
(clinician-authored, fixed). Generating the audio at build time gives studio quality with
**zero runtime cost, zero latency, offline playback, and nothing leaving the device** — so no
change to the privacy/consent posture (the audio is made from fixed text at build, not from
any member data).

**Voice source (pick one):**
- **Human voice actor** — record the fixed scripts. Most authentic/soothing, strongest brand;
  ~$few-hundred–$2k, ~1–2 weeks lead time, re-record on copy change.
- **Neural TTS, pre-rendered** (ElevenLabs / OpenAI / Azure) — near-human, ~$5–30 in credits,
  regenerate in minutes on copy change; commercial rights included with stock voices.

**The personalized word ("the beach"):** a pre-rendered clip can't contain a member-typed
word. Options, best first:
- speak a generic line ("your calm place") in the natural voice and keep the typed place
  **on screen** — full natural voice + full privacy (**recommended**);
- pre-render a small library of common places (beach, forest, lake, garden, home…);
- synthesize the personalized line at runtime via cloud TTS — most flexible, but the member's
  word then leaves the device → needs a consent-language update + vendor DPA first.

**Engineering (vendor-independent):** a thin audio layer — a manifest mapping each known line
to a clip + a `playLine()` that plays the clip or falls back to `useSpeech`, plus a generation
script if neural. Boundary kept: a warm voice must never imply a live person is monitoring —
copy stays honestly "a guide" (companion-guard enforced). **Decision pending founder:** voice
source + personalization handling. 🔴

### 14.7 Going fully autonomous — the ordered next steps

"Fully autonomous" = the deterministic safety engine (§10) **governs** module access and
session flow for real members without waiting on a human touchpoint. Today the engine is
**built + ratified (with conditions) but SHADOW only**: `shadowDecide()` logs its decision and
`checkModuleAccess` (§5) still governs. The ordered path to flip that:

1. **Complete the Part-4 evidence gates (§14.2)** — the reviewers' explicit condition:
   independent privacy/security review (ZAP, SSL Labs, companion red-team) **plus** human-factors
   testing of the session UI (stop-control salience under stress). No governance before these. 🔴
2. **Rewrite every "specialist review" claim** (§10 step 1, §14.4 microcopy, §14.3 decision) —
   marketing/FAQ/dashboard/module copy, `gating.ts` unlock strings, ToS/consent, `COMPLIANCE.md`.
   Shipping autonomy without this makes live claims false. The `*-autonomous` legal copy is
   already staged to serve on the flag flip; the **product microcopy is not**. 🔴
3. **Counsel re-confirms the wellness-lane posture with the human gate removed** — the June 2026
   handoff named a live-clinician gate as non-negotiable, so it must be explicitly lifted, in
   writing, before autonomy governs. 🔴
4. **Wire the engine to govern** — ✅ **DONE (behind the flag).** `checkModuleAccess`
   (`src/lib/gating.ts`) now consults the deterministic engine when
   `EMDR_AUTONOMOUS_SAFETY=1`, **most-restrictive-wins**: it can auto-unlock a gated module the
   engine has deterministically cleared (replacing the manual clinician unlock) and can
   additionally hold any module it deems unsafe — but relaxes nothing else (daily check-in read,
   readiness, safety plan, prerequisites, cooldown, cap, kill switch all still hold). An explicit
   clinician override remains a human safety valve. Default OFF → inert, so the flip is
   config-only. **Because the signed beta config keeps autonomous stimulation OFF, flipping the
   flag never auto-opens a processing module** (verified: `tests/autonomous-governance.test.ts`).
   Session-runtime/session-UI transitions remain to be wired the same way.
5. **Flip `EMDR_AUTONOMOUS_SAFETY=1` one stage at a time** — gating first, then session-runtime,
   watching the shadow-vs-governing audit deltas at each stage; roll back per capability on any
   divergence. 🔴
6. **Autonomous BLS stays OFF through all of the above** (an explicit sign-off condition).
   Member-initiated resourcing (4a) is live and flag-gated, but *autonomous* stimulation /
   reprocessing is a separate, later gate that needs its own clinician sign-off + evidence. 🔴

**Pre-flip artifact (built) — shadow-vs-live divergence report.** Before step 4/5, we must
show the engine's decision matches the live human gate. `src/lib/autonomous/divergence.ts`
compares, per active member × module, `checkModuleAccess` (governs today) against the engine's
`engineModuleVerdict(decideAccess(...))`, and classifies agree / engine-more-permissive /
engine-more-restrictive. **"Engine more permissive"** (the engine would open a module the human
gate blocks — chiefly gated modules that today need a clinician unlock) is flagged for clinician
review. Clinician/admin JSON at **`GET /api/clinician/divergence`**. This is the report to walk
with the reviewers before flipping the flag.

**Testing the full module set — `EMDR_OPEN_GATED`.** The gated (processing) modules require a
per-member clinician unlock by design. For a testing cycle, `EMDR_OPEN_GATED=1` — honored
**only when `EMDR_DEMO=1`** — opens them without the clinician step (behaves like a clinician
override: relaxes unlock + readiness track + prerequisites, but never the daily safety read,
cooldowns, caps, or kill switch). Inert on any real deployment, so it can never open processing
modules for a real member.

Non-negotiable substrate that stays green throughout: the `@safety` + safety-core suites, the
kill switch, the fitness screener, and the SUDS stop rules. The one architectural rule never
changes — **autonomy means more deterministic automation of clinician-validated rules, never
the AI deciding more** (§10).
