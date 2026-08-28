import { requireClinician } from "@/lib/auth";
import { logout } from "@/lib/actions";
import { ReviewNav } from "@/components/clinical/ReviewNav";

// Persistent chrome for the review and administration console
// (Web GUI handoff §26, "Review and administration — 13 screens").
//
// These surfaces were top-level destinations in the clinician console, sitting
// beside the caseload as if audit, engine validation, BLS oversight and the
// testing console were daily clinical work. Handoff 05 §3.2 named the cost:
// they "appear as equal top-level destinations beside daily clinical work",
// which makes the clinician's own nav longer and their actual job harder to
// find. §26 separates them into a review role with its own home.
//
// Auth is enforced here rather than per page, so a new review route cannot ship
// unauthenticated by forgetting a line. Note that review access is currently
// the same clinician check — §26 gives review its own role and scoped access
// requests (/review/access), and that is Wave 5 work, not something to fake
// with a second copy of the same check.
export default async function ReviewLayout({
  children,
}: { children: React.ReactNode }) {
  const reviewer = await requireClinician();
  return (
    <>
      <ReviewNav name={reviewer.name} logout={logout} />
      {children}
    </>
  );
}
