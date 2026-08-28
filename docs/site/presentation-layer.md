# Presentation layer — what was built, and what it decided

**Driven by** the Presentation Layer Handoff v1 (`Steady_Presentation_Layer_Handoff_v1.pdf`).
All § references below are to that document.
**Built:** 2026-08-28 · **Commits:** `6672e0d` → `1ea82c0`

This records the decisions rather than the diff. The diff is in git; what is not in git is
why a rule exists, which is the thing that gets relaxed by someone who did not know.

---

## 0. The finding that reshaped the work

The handoff's §0 says the brief is not "design a dashboard" but the opposite: **build a
translation layer that converts a dense deterministic routing engine into a surface that
displays no numbers at all.** Vol 2 forbids scores, diagnostic bands, criteria labels, and
hidden track names on member surfaces, and calls any contradicting surface a defect.

§0 also notes the author could not review the running screens. So the first thing done was
the audit they could not run.

**Sixteen violations across four member surfaces:**

| Surface | What was leaking |
|---|---|
| `onboarding/profile` | The gate **ended** on "Your starting track: Gentle processing" + "Readiness 68/100" — three violations on a member's first impression |
| `dashboard` | "PCL-5 trend — 52 / 80 (was 58)", "Current place 68/100" beside the track name and track-specific guidance, and **two trend charts** of PCL-5 and ITQ over time |
| `companion` | "Track: Gentle processing · 68/100" in the chat sidebar |
| `measures` | "score 52" and a recomputed ITQ breakdown |

Plus three found later, in the same class:

- `dashboard` — "Check-ins so far — 12". A running count is a streak with a different name.
- `screening` and `measures/[instrumentId]` — `cutoffNote`, e.g. *"10+ suggests moderate
  depression; item 9 above zero always routes to specialist review."* A cutoff **and** a
  criteria label, and it tells someone how to answer to avoid a consequence — which
  corrupts the instrument as well as breaking Vol 2.
- `paths` — "Today's check-in flagged safety concerns." A criteria label that frames a
  narrowed day as a failed check.

**The sharpest version of the finding:** the only chart this product had was pointed at the
member, where charts are forbidden. There was no chart on the clinician side, where they
are wanted, until the trajectory was built the week before.

---

## 1. The boundary is structural, not a filter

§3's engineering requirement, and the single best idea in the handoff:

> "Build the member renderer so it is structurally incapable of receiving a score. The API
> that serves the member surface should not return score fields at all — not hidden, not
> null, not filtered client-side. If a score never crosses the boundary, leakage becomes
> impossible rather than merely prohibited."

`src/lib/member/view.ts` is now the only thing a member surface asks for its day. Thirty
rules across six domains collapse into **five day shapes**, a list of practice refs, and a
copy key. There is no field a score could occupy, and `assertNoScores()` rejects one
attached dynamically — including nested, which is how a practice would carry the severity
that excluded its neighbour.

**The queries went too, not just the renders.** A page holding a score is one edit from
showing it. `tests/member-boundary.test.ts` asserts both halves.

### The day shapes

`open` · `narrow` · `stabilizing` · `paused` · `crisis`. Every one is rendered in the same
visual register. §2: *"If narrowing reads as 'you failed the check,' you produce shame in a
population where shame drives disengagement."* None of the copy explains **why** beyond a
plain, non-clinical sentence — the explanation is where the criteria label leaks back in.

### Absent is absent

§4, which the handoff calls its single most important line: *"A locked card is a scoreboard
of what you failed to unlock."* `DayCanvas` renders what is available and says nothing
about what is not. No greyed card, no padlock, no count of things withheld — a count is the
scoreboard with the numbers filed off.

---

## 2. What replaced the charts

A **self-assembling history strip** (`src/lib/member/history.ts`, `HistoryStrip.tsx`) — the
Wysa pattern §1.4 names: *"the member never fills out a log; the system assembles one from
what they actually did."*

No counts, no streak, no comparison between days. Days with nothing in them are **absent
rather than empty**, and dates are absolute rather than relative — "3 days ago" invites the
arithmetic of how long it has been, which is a streak by another route.

**Why no streak, written down because it will be requested later:** a streak is a score
with a friendlier name. It creates the same performance pressure, and it turns a missed day
— often a bad day, the day this product exists for — into a visible failure shown on
return.

---

## 3. Type — one family (§7)

**Cormorant Garamond retired. Inter everywhere.** 226 usages migrated; `font-serif` remains
as an alias so a missed surface degrades to the right family rather than falling back to
Georgia.

Cormorant is a Garamond revival: small x-height, high stroke contrast, drawn for display.
Vol 1 requires legibility under fatigue and cognitive load, and those are precisely the
properties that fail a tired reader — who is this product's design centre, not an edge case.

**A split was considered and rejected.** Serif for the public site and clinician console,
sans for the member app, on the same reasoning as the colour split. Rejected because a
colour split is invisible across surfaces, but a typeface split is visible the moment
someone crosses one — and the review gateway takes a reviewer from `/demo` straight into
`/dashboard` in a single session. It would read as two products.

Also now enforced rather than aspirational: **17px body floor**, **1.6 line-height**, a
`.measure` utility for the ~60ch cap, and **`prefers-reduced-motion` as a global rule**
(previously handled in two components and nowhere else).

The display role is scale and tracking, not a second face. Inter needs negative tracking at
display sizes or it reads loose and accidental; that tightening is what makes one family
read as two deliberate voices.

---

## 4. Colour — no alarm on member surfaces (§7)

Red removed from 13 member routes and every shared component. Crisis carries weight through
**contrast and typographic weight**, per §7: *"high-vibrancy red is processed as threat,
which is the wrong physiological response to trigger in this population — including on the
crisis screen, where the member is already activated."*

The **SOS button** escaped the first sweep by living in a component rather than a page. It
was the most member-facing control in the product and still bright red. The guard now
covers components.

**Amber is permitted, not banned.** §7 allows it for attention states; the rule actually
encoded is its own — a soft cap that fires when amber *spreads*, which is the drift signal
the handoff describes.

**The clinician console keeps red.** §3 is explicit that it should see scores and routing
decisions. It is an instrument read by a professional, not a screen someone meets at 2am.

---

## 5. The horizon (§7's signature element)

One thin rule at a consistent position, sitting lower on a narrow day and higher on an open
one. It carries the day's shape with no number, colour code, or label.

**It was dead code.** `horizonPosition()` was written a session earlier and never rendered.

**Deliberately stateless**, which is §7's own boundary condition: *"a single static position
per day is a state indicator. The moment you animate it across days, show history, or let a
member scrub back through it, it becomes a trend chart and violates Vol 2."* A guard asserts
the component cannot reference history, ranges, or animation.

**Open question (§10 Q1):** whether any persistent state indicator reads as a covert score.
Built stateless to answer it, but the answer is a clinical judgement and wants a clinician.

---

## 6. The gate as a paced sequence (§5)

§5 calls the 14-step gate the biggest UX risk in the product. It was one form: every item of
PCL-5 (20) or ITQ (18) on a single screen, all `required`, nothing persisted until submit.

**And a safety defect underneath the UX one.** Safety items were evaluated only at submit,
so a member could answer the PHQ-9 suicidal-ideation screen positively, close the tab, and
no rule would ever fire. §5's "safety items commit immediately" is the fix, and it is the
first thing `tests/gate.test.ts` asserts.

Now: one question per screen; every answer written the moment it is given; **answering is
advancing** (each option is its own submit, so nothing sits selected but unrecorded);
position never percentage; an exit on every step labelled *"Pause — your answers are
saved"*; terminating in a Day State rather than a score. **No JavaScript** — each step is a
form post, so it survives a reload and works before hydration.

`screening_progress` holds partial answers. Zero is a real answer on every instrument here,
so an unanswered item is **absent rather than zero**, and completion refuses to invent a
missing one — defaulting to zero would put a fabricated response into a clinical record.

---

## 7. Navigation — the product had none

Not "poor navigation". **None.** No nav component existed anywhere, the root layout had
zero, each clinician page carried its own back-link pointing somewhere different, and
`/learn` and `/practices` had zero internal links — you landed there and the browser back
button was the only way out.

- **Clinician**: one persistent nav. Says where you *are*; a nested route counts as being on
  its section, so the indicator does not go blank when someone is deepest in. Auth moved to
  the layout, so a new console route cannot ship unauthenticated by omission.
- **Member**: five destinations, plain words, no icons, no counts. A count on a nav item is
  a notification, and a notification is a demand.
- **Crisis is not in the nav row.** §6 makes it a fixed affordance that must be findable
  **without reading**; one of five options is findable only by reading them.
- **The guided review strip** carries each review path's focus list on every page, marking
  "you are here". Those items were prose shown once on the gateway; they are now links.

Adding the nav immediately found a missing page — `/practices` had four children and no
index, so the nav pointed at a 404. That is the failure mode a nav creates: it is a set of
promises, and an unkept one is worse than no nav, because the reader now believes the thing
is missing from the product rather than from the menu.

---

## 8. The patient directory

The caseload answers *who needs me now*; the directory answers *find this person*. Ordering
by urgency is exactly wrong for looking up a known name.

Between two failure modes: a directory that **grades** people becomes a second caseload (two
triage views that disagree is worse than one), and a directory that **hides** urgency lets
someone scan alphabetically past a person in crisis. So: no band, no reasons, no ordering by
need — and one quiet boolean flag.

A directory reaches for everyone by construction, making it the surface where a tenant leak
is most likely and most damaging. The same person name is seeded in **both** tenants and
each side must see only its own — the specific probe a directory invites.

---

## 9. Still open

| Item | Why it needs a person |
|---|---|
| Does the horizon read as a covert score? | Clinical judgement (§10 Q1) |
| Two soft leaks in the Autopilot card — "your window looks steady", and the sentence explaining why the day was not adjusted | Rewriting clinical-adjacent copy |
| Counsel review of the Demo Terms and Privacy Notice | Removes the "unreviewed" markings |
| A real screen-reader pass | Zero serious/critical axe violations is not the same thing |
| §6 session state machine | **Next build item** — see the README resume block |

**Not done and deliberately so:** §3's four-surface split names a member-controlled
*referral export* that includes high-intensity trigger items excluded from self-guided use.
That is a member-held artefact containing clinically sensitive content, and §10 Q3 asks
whether it assembles passively or requires curation. It should not be built before that is
answered.
