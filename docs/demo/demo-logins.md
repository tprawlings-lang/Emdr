# Demo logins

**Every account below is fabricated. Every person, record, measure and event in this
environment is invented.** No real participant data exists here, and none may until the
review gates in [`../../README.md`](../../README.md) pass.

Specified by [handoff 07 §1.2 (p6) and §1.3 (p7)](../handoffs/07-demo-login-synthetic-population-and-planning-engine.pdf);
planned in [`../handoffs/07-PLAN.md`](../handoffs/07-PLAN.md).

---

## The six roles

Sign in at **`/login`**. In the demo environment the form shows a **Demo role** dropdown —
it is context for the presenter and grants nothing. The account decides what you can see.
Selecting *Demo Admin* and entering the clinician's credentials returns the same generic
failure as any other wrong pairing.

| Role | Email | Password | Lands on |
|---|---|---|---|
| **Patient** | `patient.demo@steady.local` | `patient1234` | `/app/today` |
| Patient (second persona) | `patient2.demo@steady.local` | `patient1234` | `/app/today` |
| **Clinician** | `clinician.demo@steady.local` | `clinician1234` | `/clinician/today` |
| **Reviewer** | `reviewer.demo@steady.local` | `reviewer1234` | `/review/safety` |
| **Organization** | `org.demo@steady.local` | `org1234` | `/organization/overview` |
| Organization (demo network) | `network.demo@steady.local` | `org1234` | `/organization/overview` |
| **Payer** | `payer.demo@steady.local` | `payer1234` | `/payer/overview` |
| **Demo Admin** | `admin.demo@steady.local` | `demoadmin1234` | `/admin/demo` |

A distinct password per role is deliberate. A shared one makes "which role am I actually
signed in as?" a question the presenter answers from memory, in front of an audience.

`@steady.local` is not a routing domain. RFC 6762 reserves the whole `.local` TLD for
link-local multicast DNS, so none of these addresses can reach an inbox anywhere. A guard
in `tests/public-copy-guard.test.ts` fails the build if any fabricated address outside the
reserved ranges reaches a public page.

---

## Who each account is

| Account | Persona | What they have |
|---|---|---|
| `patient.demo@steady.local` | Alex Rivera | Three weeks into the programme and improving. Consent, processing-session consent, baseline and follow-up measures, check-ins, a safety plan, companion memory. The end-to-end member experience |
| `patient2.demo@steady.local` | Sam Okafor | Two days in, and PHQ-9 item 9 tripped the urgent queue. **Deliberately has no processing-session consent** — a demo where every gate is pre-satisfied demonstrates nothing about the gates |
| `clinician.demo@steady.local` | Dr. Maya Chen | Clinician **NE-C1** in NE Care Network A: a panel of 42 — forty of the fabricated profiles plus Alex and Sam — with 84 reviews attributed to this account. Caseload, safety queue, cited summaries, module decisions |
| `reviewer.demo@steady.local` | Dr. Ellis Nakamura | The review console: fixed safety-scenario replay, **planning signals and their lifecycle**, BLS oversight, the testing console, the audit trail, and **the four deciding screens** — access requests, clinical language, release gates, research (see below) |
| `org.demo@steady.local` | Jordan Idowu | Northside Behavioral Health — 4,820 covered lives across four sites, none of them named. Aggregate only |
| `network.demo@steady.local` | Dana Okonkwo | NE Care Network A — 42 of the 240 fabricated profiles. The account to use for the **Population** screen; `org.demo` reports on a different population and says so |
| `payer.demo@steady.local` | Priya Raman | Meridian Health Plan — 12,480 covered lives, one contract, five measures, 1,635 claims. Aggregate only |
| `admin.demo@steady.local` | Robin Achebe | Every fabricated tenant, person and event; environment state and QA |

---

## The 240 fabricated patients

Every profile in the demo population is also an account, because handoff 07 p14 lists one
per profile. A presenter can sign in as any of them to show a specific archetype from the
inside — the safety-paused person, the access-barrier person — rather than describing it.

| | |
|---|---|
| Address | `st-<region>-<nnn>@steady.local` — e.g. `st-ne-001@steady.local`, `st-we-060@steady.local` |
| Regions | `ne`, `mw`, `so`, `we`, numbered 001–060 within each |
| Password | `patient1234` — the same as the patient role |

The manifest in [`../../src/lib/demo-population-manifest.ts`](../../src/lib/demo-population-manifest.ts)
says which archetype each id carries. Useful ones to have ready:

| Profile | Why |
|---|---|
| `st-ne-008@steady.local` | Safety pause — a fixed gate, a hold, and a bounded re-entry |
| `st-ne-007@steady.local` | Access barrier — missed activity that is scheduling, not disengagement |
| `st-ne-001@steady.local` | Early response — high engagement, early observed improvement |
| `st-ne-004@steady.local` | No change — regular use, no material measure movement |
| `st-mw-013@steady.local` | Late-arrival edge case: recorded 74 days after it occurred (an Early-response profile otherwise) |
| `st-so-021@steady.local` | Partial measure: four of nine items answered, so no total can be scored (a Sporadic-use profile otherwise) |
| `st-we-044@steady.local` | Revoked consent, recorded on the row *and* as an event — this one is also a Safety pause, so it carries both |

These are 240 more credentials, and they are deliberate rather than incidental: the
environment contains no PHI, every person in it is invented, and the alternative — accounts
nobody can open — would mean an archetype can be described but never shown. They must never
be reused outside this demo.

---

## What each role cannot reach

The interesting half at a demonstration, and the half a reviewer should test. Each of these
is enforced server-side and covered by a guard — not by hiding a link.

| Role | Cannot see |
|---|---|
| Patient | Other people, aggregate comparisons, model internals |
| Clinician | Unassigned patients, the payer cost model, system configuration |
| Reviewer | Routine treatment decisions, credential management |
| Organization | Payer-wide data, or another organization |
| Payer | Patient-level clinical records, or person search |
| Demo Admin | Any production environment or real data |

**The organization and payer accounts cannot read each other's console.** Until handoff 07,
one `admin` role served both, and the boundary between them existed only in a comment.

**No aggregate account can reach a person.** `/clinician/*` and `/app/*` both bounce them.
That is not only a redirect: the organization's population has `display_name` NULL for all
4,820 people, so the drilldown is impossible rather than refused.

---

## Rotating the passwords

Handoff 07 p7 requires secrets to be storable outside source control and rotated before each
external review cycle. The environment is authoritative — set any of these and it wins over
the value in `src/lib/demo-seed.ts`, no commit required:

```
EMDR_DEMO_PASSWORD_MEMBER
EMDR_DEMO_PASSWORD_CLINICIAN
EMDR_DEMO_PASSWORD_REVIEWER
EMDR_DEMO_PASSWORD_ORGANIZATION
EMDR_DEMO_PASSWORD_PAYER
EMDR_DEMO_PASSWORD_DEMO_ADMIN
```

The passwords are re-hashed on the next `npm run demo -- reset`.

**Why the defaults are written down here.** They are weak, and they are in one known place
on purpose. This environment holds fabricated people and no PHI, so the realistic failure is
a reviewer locked out of a demonstration — and a default nobody can guess means a fresh
clone cannot be signed into at all. A credential written in one documented location is safer
than one circulated in a chat thread. They must never be reused for anything that is not
this demo, and they are never rendered on a public page: `tests/public-copy-guard.test.ts`
and `tests/e2e/enrollment-closed.spec.ts` both fail the build if one appears.

---

## Signing in from the command line

```bash
npm run demo -- reset      # rebuild every account and its history from seed
npm run demo -- baseline   # print the dataset fingerprint
```

If a member record looks empty, run the reset before concluding anything — the timeline, the
cited summary and the trajectory are all assembled from the event log, and without the
genesis backfill they render blank.

---

## Walking the review console

Sign in as the reviewer and open **`/review/release`**. The demo is seeded so that every
state a reviewer needs to recognise is on screen at once, because most of them cannot be
produced by clicking through a fresh console.

| Gate | What it demonstrates |
|---|---|
| **Demo identity** | **Reopened.** It was signed off, and the evidence under it has since changed — so the approval no longer applies and the screen says which fingerprint it was approved at. This is the behaviour the whole design exists for, and the one thing you cannot create by hand. |
| Safety regression | Signed off against the evidence currently on the screen. |
| Accessibility | Approved as an **attestation**, with a pointer to where the evidence lives. The system cannot check a screen-reader path, and the screen does not pretend otherwise. |
| Clinical language | Not cleared — one surface is still under change request on `/review/clinical`. The gate reads that screen, so the two cannot disagree. |
| Projection parity | Not run. It rebuilds the ledger, so it is offered on request rather than on page load. |
| The rest | Untouched, and deliberately distinguishable from every state above. |

Then open **`/review/access`**. Four requests, one in each state — awaiting a decision, an
active grant, a **grant whose window has closed**, and a denial with its reason. The expired
one is the one worth pausing on: an approval that has run out is not access, and a demo
showing only "approved" teaches the opposite.

Two things to try, because both are refused rather than discouraged:

- Approve the pending request while signed in as the account that raised it. You cannot —
  the request was raised by the admin account, so sign in as `admin.demo@steady.local` to
  see the refusal, and as the reviewer to decide it.
- Approve an attested gate on `/review/release` without filling in where the evidence lives.

**`/review/clinical`** shows the six gate-state sentences a member actually reads, pulled
from the module that ships them rather than transcribed. The safety-stop wording is left
under change request with the reviewer's reason attached.

**`/review/research`** is cohort-level only. There is no person-level column and no path to
one. Requesting an export writes a signed row to the disclosure register with its filter
hash, row count and suppressed-cell count.

---

## Walking Clinician Thoughts

Sign in as the clinician, open any member, and go to **Thoughts**. Press Record, speak for a
few seconds, stop. No microphone content is used — a fabricated transcript is chosen from the
recording's bytes, and every one of them says so in its own text.

Steady then organizes the transcript into **candidate items**. Nothing is in the record yet.

What to look for on the cards:

- **The kind of claim comes before the sentence.** "You were wondering" and "You observed
  this" are different rows, and a hypothesis says in words that it will not read as
  established. This is the whole point of the layer: "I think this may connect to her sister"
  must not become "her sister is an active theme".
- **A quoted patient statement is filed as the patient's.** "there is no point" is recorded as
  her words, not as an assessment of her.
- **An approximate number says it is approximate.** The transcript says "maybe four hours", so
  the card says four, approximate.
- **Nothing is pre-selected.** Save stays disabled until every card is answered.

**At least one candidate on each transcript is wrong, on purpose.** The cancellation transcript
proposes *"Clinician assesses motivation as low"* — and the line it cites is the clinician
saying they do **not** want it read that way. The lateness transcript proposes *"Lateness
reflects avoidance"* against a line that says "not reading that as avoidance yet". Neither can
be caught by a schema: the type and class are coherent, and only a reader who knows the
transcript can see the problem. That is what the review screen is for, and a fixture that was
always right would quietly demonstrate that the clinician's judgement is a formality.

Two more things worth trying:

- **Correct the transcript** (fix "semed" or "sleap") and press *Save correction and
  re-organize*. The items are redrawn against the corrected text. Editing without re-organizing
  is refused, because the cards quote offsets into the text you just changed.
- **Set `CLINICIAN_THOUGHTS_EXTRACTION=0`** and record again. The transcript still arrives and
  is still saveable; the screen says Steady could not organize it. That is a real state
  (`review_transcript_only`), not an error page.

Kept items land in clinical memory. They are not a formal note, and nothing is shared with the
patient.

---

## Session behaviour

- Sessions are cookie-based, `httpOnly`, signed with `EMDR_SESSION_SECRET`.
- Signing out everywhere, or changing a password, bumps a per-user token epoch and
  invalidates every token already issued for that account.
- Ten failed attempts within fifteen minutes locks an account for fifteen minutes. The
  lockout is counted from the append-only audit log, so it survives a restart.
- Every sign-in, failure and lockout is an audit event. A failure records *why* — no
  account, wrong password, or role mismatch — in the record, while the screen shows one
  generic message for all three.
