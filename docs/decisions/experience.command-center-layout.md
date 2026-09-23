# Design — decision sheet

**Reference:** `experience.command-center-layout`  
**First asked:** 2026-09-19  
**Sheet generated:** by `scripts/gen-decision-signoffs.ts` from the decision register

---

## The question

On the busiest clinician screen: should a row's detail stay beside the list or move below it, and should the one-line orienting sentence move above the counts? Both are defensible and they produce visibly different screens.

## What happens while this is unanswered

The Command Center keeps its own layout: detail beside the list at wide widths and a dedicated detail view below it on a phone, with the orienting sentence after the counts.

## What this is holding up

- `experience.command-center-template`

## The choices

### A. Leave the screen as it is  — *suggested*

Opening a row shows its detail beside the list on a laptop, and as its own screen on a phone. The one-line summary stays under the counts.

*What would change:* Nothing changes.

### B. Move the detail below the list

Opening a row pushes its detail underneath the list instead of beside it, which is how the other work screens behave. More consistent; the list and the detail are no longer visible at once.

*What would change:* A rebuild of the busiest clinician screen. Worth doing only if the consistency is worth losing the side-by-side view.

### C. Move the summary line to the top

The sentence saying what you are looking at moves above the counts, so it is the first thing read rather than the fourth.

*What would change:* Small change, and it can be taken on its own without the one above.

---

## Decision

Tick one.

- [ ] **A** — Leave the screen as it is
- [ ] **B** — Move the detail below the list
- [ ] **C** — Move the summary line to the top
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
