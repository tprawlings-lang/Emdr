# Releasing for testing users

Written 23 September 2026. This is the plan asked for in plain terms, and the
single fact it exists to make unmissable: **two different things are called
"release" here, and only one of them is blocked.**

---

## The distinction everything else hangs on

The environment policy (`src/lib/governance/environment-policy.ts`) has two
tiers, and the deployment's tier is **read, not declared** — nobody can set a
variable to say "we are a pilot now".

| | Demonstration (T0) | Pilot (T1) |
|---|---|---|
| Fabricated records | everything permitted | everything permitted |
| **Real staff** — a clinician, a reviewer, a tester, their name, their account, what they sign | **everything permitted** | everything permitted |
| Real participant — a person receiving care, and everything they enter | **nothing permitted** | may be entered, stored and shown; may **not** be exported |

A tester is real staff. A tester is not a participant. So the question "can we
release for testing users now" has two answers depending on which kind of
testing user is meant, and they are not close together.

---

## Track 1 — colleagues testing against fabricated data

**Nothing blocks this. No gate is required. It can happen today.**

T0 permits real staff to hold accounts, sign what they do, and use every
screen. That is exactly what an internal tester does. The demonstration banner
stays on every screen, and it is telling the truth.

To do it:

1. Deploy the branch.
2. Leave `EMDR_ENROLLMENT_CODE` **unset**. With no code set, no participant
   account can be created at all — which is what keeps this honest rather than
   a promise.
3. Give each tester their own staff account, or use the demo logins.
4. Tell testers the one rule below.

**The one rule, and it is a stop condition, not a guideline:** no real person's
information goes in. Not a real patient name typed into a note to "see how it
looks", not a tester's own real distressing memory entered as a trigger, not a
colleague's email in a member record. A tester's *own account details* are
fine — that is the staff class. Anything a real person would recognise as
their own clinical material is not, and finding some in a T0 environment stops
the pilot rather than being cleaned up quietly.

---

## Track 2 — real people entering their own material

`readTier` returns the pilot tier only when **both** of these hold:

- `EMDR_ENROLLMENT_CODE` is set, **and**
- all five gates the pilot requires are passing.

Every unresolved or failing gate reads as T0. The failure direction is toward
fabricated-only, deliberately.

### The five gates, and what each one actually needs

| Gate | What it is asking | How it is answered | Waiting on |
|---|---|---|---|
| `safety_regression` | does the safety engine still do what it did | computed from the policy and failure scenarios | **nothing** — it passes when the suite is green |
| `authorization` | can any role reach data outside its scope | a signature on the release console | a reviewer pressing sign |
| `accessibility` | is any keyboard or screen-reader path blocked | a signature on the release console | **a person doing the walkthrough** |
| `clinical_language` | is the wording what a clinician approved | the copy-review tally, recorded from the release console | a clinical reviewer approving the copy |
| `projection_parity` | is what the screens show what the records say | a ledger rebuild, run and recorded from the release console | somebody running it once |

So: **four actions on `/review/release`, and one real job.**

The four console actions are minutes of work each. The recorded results expire
when their inputs change — the copy version for clinical language, the build
or data generation for parity — so they cannot silently go stale, and they do
not need re-running on a timer for the sake of it.

### The one thing that cannot be shortened

The accessibility walkthrough. It means a person:

- completing a clinician's primary tasks with the keyboard only,
- going over focus order, reflow, control size, error recovery and signing in
  with a screen reader,
- and writing down what happened.

The automated scan runs over every public and signed-in route on every build
and finds no serious or critical violation. That is real evidence and it is
not a substitute. A package that implied otherwise would be the most expensive
sentence in it.

Until that is done and signed, **no real participant can be enrolled at all** —
not "should not", cannot: the signup path reads the tier and refuses.

---

## What shelving the three gate owner names changed

**Nothing about timing.** The names were shelved on 23 September. Where no
individual is named, any reviewer may sign, and the release console says so on
screen so nobody mistakes the absence of a rule for a rule.

What is deferred is *accountability for who signs*, not the signing. If the
three names arrive later, the mechanism is already built: from then on only
the named person's signature is accepted and everybody else is told who to
ask.

---

## The four release-checklist jobs — "a name and a date" explained

These are the four lines in the release definition that no computation can
answer. They are **jobs, not decisions** — which is why the answer to each is a
person and a date rather than an option.

1. **`accessibility.manual-and-human-testing`** — somebody operates the product
   with a keyboard and a screen reader, runs an unassisted task study, and
   writes down what happened. *This is the one on the critical path above.*
2. **`defects.reproduction-and-regression`** — does every confirmed
   high-priority defect have a test that reproduces it? There is **no defect
   register in this repository**: defects have been fixed with a test and a
   commit message rather than tracked as rows, so nothing can enumerate them to
   check. Either a tracker of record is named and reconciled against the work
   register, or this line is agreed to mean the work register itself. That is a
   decision somebody has to make; it is currently neither.
3. **`docs.superseded-point-here`** — a sweep of the documents, making every
   superseded handoff and status document carry a pointer to the current work
   register. A machine cannot tell a superseded document from a current one
   without being told which is which.
4. **`acceptance.owner-and-reviewers`** — the product owner and the required
   reviewers accept the scoped release. The last line, and the only one that
   cannot be anything but a signature. Everything above it is evidence *for*
   this decision rather than a substitute for it.

Only the first of the four holds enrollment shut. The other three leave the
release checklist visibly incomplete, which is the honest state and is what it
currently reports.

---

## The sequence, if the goal is real testing users soon

1. **Today:** deploy with no enrollment code. Colleagues test against
   fabricated data under Track 1. Nothing is waiting on anybody.
2. **This week:** a reviewer signs `authorization`, runs the parity rebuild,
   and records the clinical-language result on `/review/release`. Three of the
   five gates close.
3. **The blocking job:** somebody does the accessibility walkthrough and signs
   it. Name and date needed.
4. **Then, and only then:** set `EMDR_ENROLLMENT_CODE`. The tier flips to pilot
   because the facts changed, not because anybody declared it, and the signup
   path opens on its own.

Step 4 is deliberately last. Setting the code earlier is not dangerous — the
gates still hold enrollment shut — but it means the deployment reads as "a
demonstration whose operator intends a pilot", which is a state worth passing
through quickly rather than living in.
