# Handoff 11: evolvedMD Evaluation Build

**Place at:** `docs/handoffs/11-evolvedmd-evaluation-build.md`
**Depends on:** Handoff 10 (skills, programs, sign-off plumbing), Handoff 03 containers, ADR 0011 tenancy (`care_manager` role already exists in `src/lib/tenancy.ts`)
**Does not change:** safety authority, crisis handling, BLS (stays off), wellness-lane member copy

---

## 0. What this build is

A fully working **evaluation tenant** for evolvedMD: their Behavioral Health Managers (BHMs), psychiatric consultant and leadership log in and run Steady end to end against a realistic synthetic caseload, and their staff use the member app themselves.

**No real patients and no PHI** in this build. That is what makes "as functional as possible" possible now, without waiting on a BAA or a HIPAA production environment. Every screen in this tenant shows a persistent banner: "Evaluation environment. No patient data."

### How evolvedMD works (design inputs)
- Onsite and virtual BHMs (licensed social workers, counselors, therapists) embedded in partner primary care practices.
- Patients see their BHM monthly: 45-minute visits plus 15-minute check-ups. Steady is the between-visit layer.
- A BHM carries roughly 90 to 100 active patients. The BHM surfaces must triage, not browse.
- Outcomes are PHQ-9 and GAD-7 response and remission, measured on a registry. Psychiatric consultant reviews patients not improving.
- evolvedBH is a psychopharmacology service line for patients who need more.
- Active in AZ, MA, NH, ME. Northeast sites are largely virtual.

---

## 1. Role mapping

| evolvedMD role | Steady role | Sees |
|---|---|---|
| Behavioral Health Manager | `care_manager` | Own caseload, triage queue, assignments, measures, visit prep, time log |
| Psychiatric consultant / evolvedBH prescriber | `clinician` with `consult` scope | Weekly not-at-target review across assigned BHMs |
| Primary care provider | new `pcp_viewer` | Monthly structured status for own patients only. Read-only |
| evolvedMD clinical and ops leadership | `organization` | Sites, teams, outcomes, engagement, safety events |
| evolvedMD staff testing the member app | `member` | Normal member experience, linked to a test BHM |
| Steady | `demo_admin` | Tenant config, seeding, reset |

`pcp_viewer` is the only new role. Add it to `roles.ts`, tenancy scoping, and the access register. It never sees free text, alerts, or anything outside its own patients.

---

## 2. Tenant configuration

New file `src/lib/tenants/evolvedmd.ts`, loaded by tenant id. Nothing evolvedMD-specific is hard-coded elsewhere.

```ts
export const EVOLVEDMD_TENANT: TenantConfig = {
  id: "evolvedmd-eval",
  mode: "evaluation",                      // banner on, PHI fields disabled, alerts to test inbox
  displayName: "evolvedMD",
  coBrand: { partnerLogo: "evolvedmd.svg", poweredBy: "Steady" },
  states: ["AZ", "MA", "NH", "ME"],
  sites: [/* configurable; seed generic names, never real partner clinic names */],
  measures: {
    phq9: { cadenceDays: 14, beforeVisit: true },
    gad7: { cadenceDays: 14, beforeVisit: true },
  },
  treatToTarget: {                          // defaults, editable by evolvedMD clinical lead
    responseReductionPct: 50,
    remissionPhq9Below: 5,
    reviewIfNotRespondingByWeek: 10,
  },
  escalation: {
    memberCrisisCopy: "988 plus care team contact",
    careTeamContact: { phone: null, hours: null }, // evolvedMD supplies
    alertSlaHours: 24,                     // shown to staff, not enforced
  },
  assignableCatalog: "signed-plus-partner-slots",
};
```

---

## 3. Workstreams

### W1. Evaluation tenant and synthetic caseload
- Seed 3 BHMs, 1 psychiatric consultant, 2 PCPs, 1 leadership user, and about 280 synthetic patients (about 95 per BHM) with 16 weeks of history.
- Mix: mostly depression and anxiety, a minority with trauma presentations, most new to behavioral health care.
- Trajectories must cover: early responders, slow responders, non-responders past week 10, dropouts, measure-overdue, high app engagement with flat scores, low engagement with good scores, one PHQ-9 item-9 positive, one crisis-script event.
- `npm run seed:evolvedmd` and a one-click reset in `/admin`. Deterministic seed so demos are repeatable.
- Synthetic names come from an obviously synthetic list. No realistic DOBs, MRNs, or addresses.

### W2. BHM triage queue (`/clinician/today`, `/clinician/caseload`)
Default sort is **needs attention**, with a plain-language reason on every row. Deterministic rules, in priority order:
1. PHQ-9 item 9 positive since last review
2. Crisis script shown to member since last review
3. Distress after an assigned activity above threshold
4. Not at target: less than 50% PHQ-9 reduction at or after week 10
5. Measure overdue beyond cadence plus 7 days
6. No app activity in 14 days (member was previously active)
7. Visit in the next 2 days (visit prep ready)

"Reviewed" clears a row until something new happens. No per-patient scores in the list beyond the latest PHQ-9 and GAD-7 and their direction.

### W3. Between-visit measurement
- PHQ-9 and GAD-7 delivered to members on the tenant cadence and before each visit. Existing instruments and item-9 routing unchanged.
- Registry view per BHM: baseline, latest, percent change, week in care, status (responding, remission, not at target).
- Export: CSV in a column layout evolvedMD provides, and FHIR `Observation` with LOINC 44261-6 (PHQ-9 total) and 70274-6 (GAD-7 total). Export is a file in evaluation; no live integration.

### W4. Assign and track (the functional heart of Phase 3)
The clinician-assigned lane becomes useful **today** by assigning Steady's own signed content, not by waiting for WET.
- Assignable: every live Handoff 10 item (skills, Moving Toward units, Steadier Sleep units, lessons, and thought records once Phase 2 ships) plus partner protocol slots (W10).
- BHM picks content, optional note to member, optional due window. Member sees a "From your care team" section at the top of Home.
- BHM sees completion, distress before and after where collected, and last activity. Coded data only.
- **Member-controlled sharing:** on any entry (BA reflection, thought record) the member can tap "Share with my care team." Only shared entries are visible to the BHM. Sharing is per entry and revocable. Default is private. This needs sign-off row CV11_02.
- Unassigning is one tap and leaves the member's own history intact.

### W5. Visit prep
One screen and a printable one-page summary per patient before each visit:
- measure trend since last visit
- assignments and completion
- flags from W2 since last visit
- member-shared entries
- member's own "what I want to talk about" note (optional prompt sent 2 days before the visit)

Built for the 15-minute check-up: it must be readable in under a minute.

### W6. Psychiatric consultant review
Weekly list of patients not at target, grouped by BHM. For each: trajectory, adherence to assignments, time in care, current plan. Consultant records "no change," "recommend change," or "discuss" with a short note. The BHM sees the recommendation in their queue. This mirrors the systematic caseload review CoCM already runs.

### W7. PCP summary
Monthly structured status per patient: engaged or not, measure direction, whether a consultant recommendation is open. No free text, no alerts, no content details.

### W8. Care management time log
- Auto-capture BHM time spent in a patient's Steady record, plus manual entries.
- Monthly export per patient.
- Copy on the screen: "Time records for your billing team. Steady does not determine billing eligibility." Whether any of it counts toward CoCM or other codes is evolvedMD's determination.

### W9. Escalation mapping
- Member crisis path unchanged: scripted crisis interrupt, 988, SOS. Add evolvedMD care-team contact and hours from tenant config.
- Item-9 positives and crisis events create a top-priority queue item for the assigned BHM and appear on the leadership safety view.
- Evaluation mode: alerts route to a test inbox and a visible log, never to real phones or pagers.
- The copy must never promise a response time to members.

### W10. Partner protocol slots
- Slot loader for WET, CPT worksheets, IRT, and any evolvedMD worksheet. evolvedMD uploads its own materials; the uploader attests they hold the rights to use them.
- Empty slots render as "Partner protocol step N (licensed content loads here)." No placeholder may read as a usable prompt. Test: placeholder strings unreachable outside `mode: "evaluation"`.
- Uploaded protocol content is not live until the evolvedMD clinical lead signs the corresponding Lane E row.
- Narrative content from these slots is excluded from the companion (Handoff 10 §6 test).

### W11. Problem-solving module (new content)
Problem-solving treatment is a standard collaborative care intervention and Steady has none. Add a short structured program: define the problem, set a realistic goal, list options, weigh them, choose one, plan steps, review. Assignable by BHMs, self-startable at `STABILIZATION` tier.
- Steady drafts original content. It needs sign-off (CV11_03) by Altschuler and Allen, or evolvedMD loads its own worksheets through W10 instead.

### W12. Evaluation feedback
- Feedback button on every staff screen: what they were trying to do, what happened, a 1 to 5 usefulness rating.
- Usage log of which staff features were used and for how long. Staff only. Never member data.
- Weekly evaluation digest for you and evolvedMD's lead.

### W13. Leadership view
`/organization/outcomes` and `/organization/safety` filtered to the tenant: engagement, measure completion rates, assignment completion, response and remission counts on synthetic data, safety events. Label every figure "synthetic evaluation data." Never show these to anyone as outcomes.

---

## 4. Off in this build
- BLS and autonomous processing (unchanged).
- Real patients, real names, PHI fields.
- Live EHR or registry integration (export files only).
- Messaging between BHM and member (keeps the evaluation away from clinical communication obligations; revisit for pilot).

## 5. From evaluation to a real-patient pilot
All of these are required before any evolvedMD patient uses Steady:
1. BAA with evolvedMD, and with each subprocessor that touches PHI (including the model provider behind the companion).
2. Production HIPAA environment: Postgres cutover, backups, access logging, retention and deletion policy.
3. Independent security review and penetration test.
4. Lane E and CV11 rows signed; evolvedMD clinical lead signs off on escalation mapping and the assignable catalog.
5. evolvedMD decides whether the pilot runs as quality improvement or research, and whether any review board is involved.
6. Consent and member terms reviewed by counsel for multi-state use (AZ, MA, NH, ME).

## 6. Questions for evolvedMD (drives customization)
1. Registry and EHR systems in use, and the export columns they want.
2. Preferred PHQ-9 and GAD-7 cadence between visits.
3. Treat-to-target thresholds their consultants use.
4. Care-team contact and hours to show members; who receives alerts.
5. Which interventions BHMs use most (behavioral activation, problem solving, CBT skills, others), and whether they have worksheets to load.
6. Whether they want a PCP view at all.
7. Which sites or states for the eventual pilot, and whether virtual Northeast sites are the better first fit.

## 7. New sign-off rows (CV11)

| Row | Item | Reviewer |
|---|---|---|
| CV11_01 | Triage rules and thresholds (W2) | evolvedMD clinical lead + one Steady reviewer |
| CV11_02 | Member-controlled sharing of entries (W4) | Altschuler, Allen |
| CV11_03 | Problem-solving module content (W11) | Altschuler, Allen |
| CV11_04 | Escalation mapping and member crisis copy (W9) | evolvedMD clinical lead |
| CV11_05 | Visit prep member prompt (W5) | Altschuler, Allen |

## 8. Build order

| Order | Package | Size |
|---|---|---|
| 1 | Tenant config, `pcp_viewer`, evaluation mode banner and PHI lock | 1 session |
| 2 | W1 synthetic caseload and reset | 1 to 2 sessions |
| 3 | W4 assign and track (with the Handoff 10 signed content) | 2 sessions |
| 4 | W2 triage queue | 1 session |
| 5 | W3 measurement cadence, registry view, exports | 1 to 2 sessions |
| 6 | W5 visit prep | 1 session |
| 7 | W6 consultant review, W7 PCP summary | 1 to 2 sessions |
| 8 | W9 escalation mapping | 1 session |
| 9 | W8 time log, W12 feedback, W13 leadership view | 2 sessions |
| 10 | W10 partner slots | 1 session |
| 11 | W11 problem-solving module (after CV11_03) | 1 session |

Each package: `npm run test:safety` and e2e green, route register updated, README RESUME block updated. Add a test that the evaluation tenant cannot accept any field flagged as PHI.
