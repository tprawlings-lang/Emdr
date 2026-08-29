import { requireClinician } from "@/lib/auth";

// Persistent chrome for the review and administration console (§26).
//
// There is no nav component here any more — the console's navigation is the
// app shell's rail, rendered by ReviewPage on every screen. What this layout
// still owns is auth, enforced here rather than per page so a new review route
// cannot ship unauthenticated by forgetting a line.
//
// Review access is currently the same clinician check. §26 gives review its
// own role and scoped access requests (/review/access), and that is Wave 5
// work, not something to fake with a second copy of the same check.
export default async function ReviewLayout({
  children,
}: { children: React.ReactNode }) {
  await requireClinician();
  return <>{children}</>;
}
