# Service operations — decision sheet

**Reference:** `ops.unclaimed-work-escalation`  
**First asked:** 2026-09-19  
**Sheet generated:** by `scripts/gen-decision-signoffs.ts` from the decision register

---

## The question

When work has no clinician, after how long should it escalate, and to whom? This is about how the service is run rather than how the product is built, and a default chosen here would be this codebase inventing a duty-of-care rule.

## What happens while this is unanswered

Nothing escalates, and the Command Center says so beside the count: how many items are unclaimed, across how many people, and how long the oldest has waited — with no threshold and no caution colour, because either would imply a deadline nobody agreed.

## What this is holding up

- `presentation.unassigned-work-accumulates`

## The choices

### A. A named person reviews the list daily  — *suggested*

Nothing moves on its own. Somebody — a duty clinician, a team lead — looks at the unclaimed list once a day and assigns what is there.

*What would change:* No code changes; the count is already on the clinician's home screen. What it needs is somebody whose job it is.

### B. After a set number of days it goes to a named supervisor

Work nobody has picked up for, say, three days automatically becomes one named person's responsibility. You choose the number of days and the person.

*What would change:* Real work: the rule, the assignment, and a way for that person to see what landed on them. Nobody is notified — this build has no way to send anything.

### C. After a set number of days it goes to whoever is on duty

Same, but it lands with whoever is covering that day rather than one fixed person.

*What would change:* More work than the above, because the product has no concept of who is on duty. That would have to be built first.

### D. Leave it as it is

The unclaimed count stays visible with no deadline attached, and nobody is chased.

*What would change:* Nothing changes. The screen says plainly that nothing escalates, so the absence is visible rather than assumed.

---

## Decision

Tick one.

- [ ] **A** — A named person reviews the list daily
- [ ] **B** — After a set number of days it goes to a named supervisor
- [ ] **C** — After a set number of days it goes to whoever is on duty
- [ ] **D** — Leave it as it is
- [ ] **Something else** (write it below)

**If something else, or if the choice needs a condition:**

```


```

| | |
|---|---|
| **Name** | |
| **Role** | |
| **Signature** | |
| **Date** | |

---

*This sheet is generated from the decision register in the codebase. It is not a contract and it is not clinical advice: it records which way somebody accountable chose to go, so that what the product does afterwards can be checked against it.*
