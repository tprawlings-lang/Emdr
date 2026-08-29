import { requireOrganization } from "@/lib/auth";

// Persistent chrome for every organization surface.
//
// Auth is enforced here rather than per page, so a new organization route
// cannot ship unauthenticated by forgetting a line — the same reason the
// clinician and review layouts do it. Navigation is the app shell's rail,
// rendered by OrgPage on each screen; there is no nav component.
export default async function OrganizationLayout({
  children,
}: { children: React.ReactNode }) {
  await requireOrganization();
  return <>{children}</>;
}
