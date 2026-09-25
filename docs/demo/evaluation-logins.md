# Evaluation tenant sign-ins (Handoff 11)

**Every account and every person below is synthetic.** The evaluation tenant refuses PHI
fields at the database (date of birth, record numbers, a safe person's contact), and every
screen in it says "Evaluation environment. No patient data."

Specified by [Handoff 11 W1](../handoffs/11-evolvedmd-evaluation-build.md). The caseload is
built by `npm run seed:evolvedmd`, or by **Rebuild the evaluation tenant** on `/admin/demo`
(demo admin, typed reason). Both remove only this tenant's rows and seed it again, anchored to
today, so dates stay current. A full demo reset removes the tenant too; rebuild it afterwards.
The admin panel lists the same accounts, read from the database.

## Password

Every staff and tester account uses the value of `EMDR_EVAL_PASSWORD` on the server, or
`evaluation1234` when it is unset. Set it on any shared host before seeding. The synthetic
patients cannot sign in (their password is disabled).

Sign in at `/login` with the **Demo role** dropdown left on *Any role*: these roles are not
among the six public demo personas, and a mismatched dropdown fails silently.

## Accounts

| Who | Email | Steady role | Lands on |
|---|---|---|---|
| Care manager (BHM), 95 patients | `bhm.alder@evaluation.invalid` | clinician, holds `care_manager` on the caseload | `/clinician/today` |
| Care manager (BHM), 93 patients | `bhm.birch@evaluation.invalid` | clinician, holds `care_manager` | `/clinician/today` |
| Care manager (BHM), 92 patients | `bhm.cedar@evaluation.invalid` | clinician, holds `care_manager` | `/clinician/today` |
| Psychiatric consultant | `consultant.dogwood@evaluation.invalid` | clinician, `consult` scope | `/clinician/today` |
| Primary care provider | `pcp.elm@evaluation.invalid` | `pcp_viewer` | `/pcp` |
| Primary care provider | `pcp.fir@evaluation.invalid` | `pcp_viewer` | `/pcp` |
| Leadership | `leadership.ginkgo@evaluation.invalid` | organization | `/organization/overview` |
| Member tester 1 (Alder's) | `tester1@evaluation.invalid` | member | `/app/today` |
| Member tester 2 (Birch's) | `tester2@evaluation.invalid` | member | `/app/today` |
| Member tester 3 (Cedar's) | `tester3@evaluation.invalid` | member | `/app/today` |

Member testers have an active zero-price membership, so they meet the app rather than the
paywall, and a care manager each. Everything else in their account they do themselves.

## What is in the caseload

- 280 patients (`Amber Harbor 001` and so on; `patient-001@evaluation.invalid` onward), about
  half depression, a third anxiety, the rest trauma presentations, most new to behavioral
  health care. Each has a care manager and a primary care provider.
- 16 weeks of PHQ-9 and GAD-7 every 14 days from each person's start, app check-ins, and
  alternating 45-minute visits and 15-minute check-ups, the next one scheduled.
- Trajectories: early responders, slow responders, non-responders past week 10, dropouts
  (quiet for more than 14 days), measure-overdue (still using the app), high engagement with
  flat scores, low engagement with improving scores, and an ordinary middle.
- Exactly one PHQ-9 item 9 positive (in the last fortnight) and one crisis check-in (two days
  ago), each with its alert.

## Not built yet

The screens that turn this into a triage queue, registry, visit prep, consultant review and
PCP summary are Handoff 11 packages 3 to 9. Until then a care manager sees their caseload
through the existing clinician screens, and the PCP page says its summary is not built.
