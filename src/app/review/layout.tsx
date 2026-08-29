import { requireReviewAccess } from "@/lib/auth";

// Persistent chrome for the review and administration console (§26).
//
// There is no nav component here any more — the console's navigation is the
// app shell's rail, rendered by ReviewPage on every screen. What this layout
// still owns is auth, enforced here rather than per page so a new review route
// cannot ship unauthenticated by forgetting a line.
//
// Review now has a role of its own (handoff 07 §1.2, p6). This used to be a
// plain clinician check with a comment saying the role was Wave 5 work — and
// the moment `reviewer` existed, that line became an infinite redirect: a
// reviewer was bounced to their landing page, which is inside this console,
// which bounced them again. Next rendered a page with no <main> and the e2e
// suite caught it.
//
// The guard admits reviewer, clinician and demo admin. The clinician is here
// because two screens record a clinician's sign-off on the autonomous flow and
// on BLS configuration, and that authority is theirs rather than the
// reviewer's.
export default async function ReviewLayout({
  children,
}: { children: React.ReactNode }) {
  await requireReviewAccess();
  return <>{children}</>;
}
