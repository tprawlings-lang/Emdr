# Security and privacy — decision sheet

**Reference:** `gates.who-signs`  
**First asked:** 2026-09-23  
**Sheet generated:** by `scripts/gen-decision-signoffs.ts` from the decision register

---

## The question

Who signs each of the three release gates a machine cannot check — that no role can reach data outside its scope, that no keyboard or screen-reader path is blocked, and that the numbers are what the records say? A name and an address for each.

## What happens while this is unanswered

Any account with review access can sign any of the three, and the release console says so in those words — the absence of a decision rather than a decision. Every signature records who made it, with a date and a reference to the evidence, so it is auditable after the fact even while anybody can make it. Naming somebody tightens it immediately; no code changes.

## The choices

### A. Name one person for each check  — *suggested*

You give three names and email addresses. From then on, only the named person can sign their own check — the button refuses anybody else and tells them who to ask.

*What would change:* Nothing in the product changes except who the button accepts. Add the three names to the owner list; no code is written.

### B. Name one person for all three

One person is accountable for all three checks. Simpler to arrange, and it means one person is asserting that the screens work with a screen reader, that nobody can reach data they should not, and that the numbers are right.

*What would change:* Same as above with one name instead of three.

### C. Leave it open to any reviewer

Anybody with review access can sign any of the three. Every signature still records who made it, on what date, and where the evidence is — so it can be followed up afterwards, just not directed beforehand.

*What would change:* Nothing changes. The release screen goes on saying that no individual is named, so nobody mistakes the absence of a rule for a rule.

---

## Decision

Tick one.

- [ ] **A** — Name one person for each check
- [ ] **B** — Name one person for all three
- [ ] **C** — Leave it open to any reviewer
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
