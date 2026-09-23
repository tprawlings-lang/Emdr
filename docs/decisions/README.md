# Decisions waiting on a person

One sheet per question. Each says what the product does in the meantime, so a question can be left open deliberately rather than by accident.

**Nothing is waiting on a decision.** Every question below has been answered.

## Answered, and still waiting on something

The decision is not in doubt. What is missing is the information needed to act on it.

| For | Still needed |
|---|---|
| Service operations | Who reviews the unclaimed list each day. The product needs nothing; the rota does. |
| Product owner | A name and a date for each of the four jobs. The screen-reader walkthrough is the one that matters today: it is a gate the environment policy requires, so real enrolment stays shut until somebody has done it and signed it off. |

## Already answered

Kept, with the answer and its date, so the code is not left carrying a rationale nobody can find and the next person does not re-open it.

| Question | Decided | On |
|---|---|---|
| Who signs each of the three release gates a machine cannot check — that no role can reach data outside its scope, that no keyboard or screen-reader path is blocked, and that the numbers are what the records say? | A — one named person per check — and the three names are SHELVED, decided 23 September. The mechanism is built and stays built: where a name is set, only that person's signature is accepted and everybody else is told who to ask. No name has been invented to fill the gap and a test keeps it that way, so until names are given any reviewer may sign and the console says so on screen. THIS DOES NOT HOLD ANYTHING SHUT: an unnamed gate is signable today, so shelving the names delays accountability for who signs, not the signing itself. Revisit when the reviewing individuals are appointed. | 2026-09-23 |
| How long does each activity take, and should a clinician see a different figure from the member? | Shelved. The set of activities may change — modules added — so settling eleven numbers now would be settling a list that is about to move. The two disagreeing lists stay, and a member can still see two figures for the same activity on different screens; that is a known cost of waiting rather than an oversight. Revisit when the module set is settled. | 2026-09-23 |
| Should the product be able to record that a clinician wrote a note between visits, opened session preparation, read a trajectory, or adjusted a plan link? | B — build all four. A clinician should be able to record a thought between visits, that they prepared for a session, that they read somebody's trajectory, and that they adjusted a plan link, and each should show on the person's record. This reverses the 19 September decision to shelf them, which is recorded rather than overwritten. | 2026-09-23 |
| When work has no clinician, after how long should it escalate, and to whom? | A — a named person reviews the unclaimed list daily and assigns what is there. Nothing escalates automatically, which is now a chosen operating control rather than an absent rule. No code changes: the count, the number of people behind it and the age of the oldest are already on the clinician's home screen. WHO that person is remains an operational appointment. | 2026-09-23 |
| Should being somebody's assigned clinician restrict who may act on them? | A — anyone on the team may act. Being somebody's clinician records who is accountable and does not gate access, so a member in an Immediate band never waits for one person to come back from leave, and stepping in is recorded as cover. No change: this is what the product already does, now deliberately rather than by default. | 2026-09-23 |
| On the busiest clinician screen: should a row's detail stay beside the list or move below it, and should the one-line orienting sentence move above the counts? | B — the row's detail moves below the list rather than beside it, matching every other work screen. The list and the detail are no longer visible at once, which is the cost. The orienting sentence stays where it is: that was a separate option and was not chosen. | 2026-09-23 |
| Four release lines only a person can answer: has anybody operated the product with a keyboard and a screen reader and written down what happened; is there a defect register, and does every confirmed high-priority defect have a reproduction test; has somebody made each superseded document point at the current record; and do the product owner and reviewers accept the scoped release? | A — a name and a date against each of the four. They are jobs rather than decisions. THE NAMES AND DATES ARE STILL OUTSTANDING. The accessibility walkthrough is the urgent one: it is a gate the environment policy requires, so until somebody has operated the product with a keyboard and a screen reader and signed that off, no real participant can be enrolled at all. | 2026-09-23 |
| Is this a pilot with real people or a demonstration with fabricated data? | Real consented participants are what the pilot is FOR, and no environment takes one until the gates that protect them pass. Two tiers, with the current one read from live facts rather than declared. | 2026-09-19 |
| Should the system know that a person is a particular clinician's patient, as a standing fact? | Build it. A person is assigned to a named clinician and it stays until somebody changes it, with the history kept. Accountability rather than access. | 2026-09-23 |
| When should a recorded gate result stop counting — on a clock, or when the thing it was measured against changes? | On change, with no time cap. A result expiring on a timer closes the pilot tier overnight with nothing having changed, which teaches an operator to re-run a check they have no reason to believe is stale. | 2026-09-23 |

---

*Generated by `scripts/gen-decision-signoffs.ts`. Do not edit by hand — edit the register.*
