# Pilot enrollment

**`/signup` is open when — and only when — `EMDR_ENROLLMENT_CODE` is set.** Unset means
closed, and closed behaves exactly as it did before this existed: the route redirects to
`/request-review`. A deployment that has never heard of this variable is unchanged by it.

Specified by nothing — this is a deliberate, reversible reopening of what
[Redesign handoff §12](../handoffs/) closed, for a limited pilot. Read
[what §12 closed](#what-12-closed-and-what-this-does-differently) before changing any of it.

---

## Turning it on

One variable, in the Render dashboard (or the environment, wherever this runs):

```
EMDR_ENROLLMENT_CODE=<the code you hand out>
```

Nothing else. There is no per-person invite, no expiry and no revocation — one code, handed
to whoever you want in the pilot, good for **25 accounts**. Removing the variable closes the
door again immediately; it does not delete anyone who already enrolled.

**The code is a weak credential and is meant to be.** It stops the open internet, not a
determined person. It cannot tell two holders apart, which is why the cap is a hard number
rather than a rate limit, and why every account it admits is written to the audit trail with
`via: "enrollment_gate"`.

---

## What §12 closed, and what this does differently

§12 closed public enrollment because the form was a retail front door: anybody who found the
page could put a real name and a real address into a review environment, and a reset without
closing it re-contaminated on the next visitor.

| | Old signup | Pilot enrollment |
|---|---|---|
| Who can reach it | Anyone | Anyone with the code |
| How many | Unbounded | 25, then it refuses and says so |
| Visible count | None | On the demo admin console |
| Mobile API | **Ungated** — created accounts freely | Same gate, same cap |
| Told what they are entering | Wellness acknowledgment only | Two acknowledgments, and the questions named before the first field |

The mobile row is the one worth dwelling on. `POST /api/mobile/v1/auth/signup` created member
accounts with no code and no cap for as long as §12 had the web form closed — the closure was
a sign, not a gate. Both doors now call `checkEnrollment()` in `src/lib/enrollment/gate.ts`,
**before** either validates anything, so a caller without a code cannot use the
"already exists" error to enumerate who is registered.

---

## What an enrollee is asked, and what they are told first

Two screens after the signup form, a real person is asked whether they have had suicidal
thoughts in the past thirty days. The daily check-in then asks about harm urges,
dissociation, sleep and substance use.

That is sensitive health information about an identifiable person, in an environment whose
own banner says it is not monitored in real time. **Both of those are true, and the second is
the one the person needs to have read.** So the signup page says, above the first field:

- This is a development prototype, not care. Nobody is watching in real time, and nobody will
  contact you because of what you enter.
- The next screens ask about suicidal thoughts, harm urges, sleep and substance use.
- Your answers are read by the people building this, as pilot feedback. They are not a
  medical record and are not shared with an insurer or employer.
- In an emergency, 988 and 911 work whether or not Steady does.

Then two separate checkboxes, neither pre-checked (compliance packet 3.4): one for what this
is, one for what happens to the answers. Two rather than one, because a single box lets a
reader agree to the half they noticed.

**Nobody is watching.** A hard stop or a positive harm-urge check-in from a real enrollee
raises the same alert a fabricated one does, on a console nobody is required to read. If that
changes — if positives should reach a person — it is a routing job, not a copy change, and it
is not built.

---

## The pilot's clinician

`clinician.pilot@steady.local` / `pilotclin1234`, created with the tenant.

**Without one the pilot is a room nobody can enter.** Every clinical surface resolves its
scope from `users.tenant_id`, so a tenant holding members and no clinician holds people
nobody can open — which is what separating the pilot from the fabricated population left
behind on the first attempt: answers that went in and were visible only as a count.

**Not `clinician.demo`, and that is not a preference.** A clinician belongs to one tenant.
Moving the demo clinician here would empty the caseload of the forty-two fabricated people
the whole demonstration rests on. Two populations need two clinicians for the same reason
they needed two tenants.

The account is marked `fabricated` — nobody is described by it, it is a login — which also
keeps it out of the enrolment count, so opening the door does not use up one of the
twenty-five places.

### What a participant's activity does to it

Verified end to end rather than assumed. A participant who reports a harm urge on a daily
check-in appears on `/clinician/today` within the same request cycle:

> **Needs attention 1** · ▲ Immediate · *Live Tester* — Harm urge reported on the check-in of
> 2026-09-10 · **Record contact**

and on `/clinician/caseload` in the Immediate band with *"Held by a safety decision"*. All
fourteen person tabs and all eleven clinician consoles render for a pilot participant.

---

## Where enrollees live

| | |
|---|---|
| **Provenance** | `real`. A human filled in the form, so their answers never pool with the fabricated population. This is what `demo-quality.ts` counts as "Real people in this environment". |
| **Tenant** | NE Care Network A — the demo clinician's tenant, so `clinician.demo@steady.local` sees them on `/clinician/caseload` alongside the fabricated panel. |
| **Membership** | A zero-price `provider: 'demo'` subscription, because `/app/onboarding` bounces to `/subscribe` without one and `/subscribe` says billing is closed. It is not a payment. |
| **Landing** | `/app/onboarding` — step 2 of 4, informed consent. Not `/app/welcome`, which is not a care-gate destination and renders blank when redirected to from a server action. |

---

## A reset deletes them

`resetDemoData` runs `DELETE FROM` over `users`, `persons`, `consents`, `checkins` and
`screenings` **unconditionally** and reports success. For a seeded population that is the
whole point. For a pilot it is every answer anybody gave, with no undo, and nothing in the
rebuilt baseline records that those people were ever here.

So **the reset refuses while enrolled people exist.** The admin console shows the count and
what would be lost, and proceeding needs a tick separate from the walkthrough-interrupt one —
different loss, different deliberation — which is recorded against the operator's account as
`demo_enrolled_discarded`.

Scoped deletion was considered and refused: the baseline hash is taken over whatever remains,
so leaving real rows behind would make two resets produce different hashes. Determinism and
preservation cannot both live in that operation, so the operation asks instead.

**Export anything you need before you tick it.**

---

## The nightly reset

`EMDR_DEMO_NIGHTLY_RESET=1` arms a job that resets the environment at an hour chosen so
nobody is watching. It is off by default. **Leave it off while a pilot is running** — it
calls `resetDemoData` directly and does not pass through the console's refusal.
