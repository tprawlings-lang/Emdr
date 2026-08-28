import { redirect } from "next/navigation";

// §26 names /clinician/today as the clinician home: "Know who needs attention
// — priority queue — Review now".
//
// This index used to be a second, older console — its own alert list, member
// table and unlock queue, overlapping the caseload and creating the two mental
// models handoff 05 §3.2 described. Its content is not lost: alerts and
// caseload rows are both work items on /clinician/today, which orders them
// together instead of leaving a clinician to reconcile two lists by hand.
//
// A redirect rather than a deletion, because /clinician is the address people
// have in muscle memory and in bookmarks.
export default function ClinicianHome() {
  redirect("/clinician/today");
}
