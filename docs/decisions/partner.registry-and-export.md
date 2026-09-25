# Product owner — decision sheet

**Reference:** `partner.registry-and-export`  
**First asked:** 2026-09-25  
**Sheet generated:** by `scripts/gen-decision-signoffs.ts` from the decision register

---

## The question

For the partner: which registry and EHR systems do your teams use, and which columns should the PHQ-9 and GAD-7 export have?

## What happens while this is unanswered

The export is a file in the evaluation (CSV, and FHIR Observations coded with LOINC 44261-6 and 70274-6), in a generic column layout until the partner's is known.

## The choices

### A. Send your column layout  — *suggested*

The CSV matches what your registry imports, column for column.

*What would change:* The export's columns change to yours.

### B. Use the generic layout

One row per measure: patient reference, instrument, date, total score, change from baseline.

*What would change:* Nothing changes.

---

## Decision

Tick one.

- [ ] **A** — Send your column layout
- [ ] **B** — Use the generic layout
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
