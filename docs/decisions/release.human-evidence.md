# Product owner — decision sheet

**Reference:** `release.human-evidence`  
**First asked:** 2026-09-17  
**Sheet generated:** by `scripts/gen-decision-signoffs.ts` from the decision register

---

## The question

Four release lines only a person can answer: has anybody operated the product with a keyboard and a screen reader and written down what happened; is there a defect register, and does every confirmed high-priority defect have a reproduction test; has somebody made each superseded document point at the current record; and do the product owner and reviewers accept the scoped release?

## What happens while this is unanswered

The release console reports each as unanswered rather than assuming it. The accessibility one is now on the critical path for more than the checklist: it is one of the gates the environment policy requires before a real participant may be admitted.

## What this is holding up

- `accessibility.manual-and-human-testing`
- `defects.reproduction-and-regression`
- `docs.superseded-point-here`
- `acceptance.owner-and-reviewers`

## The choices

### A. Put a name and a date against each of the four  — *suggested*

For each one — the screen-reader walkthrough, the defect list, the old documents, the final acceptance — you say who does it and by when. They are jobs, not decisions.

*What would change:* The accessibility one is the urgent one: until somebody has operated the product with a keyboard and a screen reader and signed that off, real participants cannot be enrolled at all.

### B. Do the accessibility one now, the rest later

Only the screen-reader walkthrough is scheduled, because it is the one holding enrollment shut. The other three wait.

*What would change:* Unblocks the pilot. The release checklist stays incomplete and says so.

### C. Tell me there is no defect register

One of the four asks whether every confirmed serious defect has a test that reproduces it. If defects are not tracked anywhere, that line cannot be answered and should say so rather than sit open.

*What would change:* I record it as not applicable with the reason, instead of it reading as a job nobody has done.

---

## Decision

Tick one.

- [ ] **A** — Put a name and a date against each of the four
- [ ] **B** — Do the accessibility one now, the rest later
- [ ] **C** — Tell me there is no defect register
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
