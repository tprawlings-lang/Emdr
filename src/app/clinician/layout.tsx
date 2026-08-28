import Link from "next/link";
import { requireClinician } from "@/lib/auth";
import { logout } from "@/lib/actions";
import { ClinicianNav } from "@/components/clinical/ClinicianNav";

// Persistent chrome for every clinician surface.
//
// Before this, the console was a set of URLs rather than a product: no nav
// existed anywhere in the app, each page carried its own ad-hoc "← back" link
// pointing somewhere different, and the member trajectory sat four hops deep
// with nothing signposting the way. A reviewer who did not already know the
// route could not find it, which is a navigation defect that reads as a missing
// feature.
//
// Auth is enforced here rather than only per page, so a new console route
// cannot ship unauthenticated by forgetting a line.
export default async function ClinicianLayout({
  children,
}: { children: React.ReactNode }) {
  const clinician = await requireClinician();

  return (
    <>
      <ClinicianNav name={clinician.name} logout={logout} />
      {children}
    </>
  );
}
