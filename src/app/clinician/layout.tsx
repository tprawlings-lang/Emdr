import { requireClinician } from "@/lib/auth";

// Persistent chrome for every clinician surface.
//
// There is no nav component here any more. The console's navigation is the app
// shell's rail (§25's information layers, §28's frame), and every clinician
// page renders it through ClinicianPage or PersonShell — so a second nav bar
// above it would be two competing answers to "where am I", which is the exact
// defect the nav was added to fix, in a new place.
//
// What this layout still owns is auth, enforced here rather than only per page
// so a new console route cannot ship unauthenticated by forgetting a line.
export default async function ClinicianLayout({
  children,
}: { children: React.ReactNode }) {
  await requireClinician();
  return <>{children}</>;
}
