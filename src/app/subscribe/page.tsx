import Link from "next/link";
import { PublicPage, BoundaryNote } from "@/components/site/PublicChrome";
import { BOUNDARY } from "@/lib/site/registry";

export const metadata = { title: "Membership — Steady" };

// Retail subscription is disabled for T0/T1 (Redesign handoff §12). The page
// remains so existing links resolve to a clear statement rather than a 404,
// and so nobody has to guess whether billing is quietly still running.
export default function SubscribeClosed() {
  return (
    <PublicPage
      eyebrow="Membership"
      title="Enrollment and billing are closed"
      lede={BOUNDARY.noEnrollment}
    >
      <div className="mt-8 space-y-6">
        <BoundaryNote />
        <p className="text-ground/80">
          Steady is being prepared as a platform for clinical, security, privacy, and
          partner review. There is no public purchase path, no free trial, and no
          subscription running in this environment.
        </p>
        <p className="text-ground/80">
          If you are evaluating Steady on behalf of a clinical team, a healthcare
          organization, a payer, an investor, or a security group, the way in is a
          review request.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/request-review" className="rounded-full bg-ground px-5 py-2 text-sm font-medium text-ivory">
            Request a review
          </Link>
          <Link href="/platform" className="rounded-full border border-ground/25 px-5 py-2 text-sm font-medium text-ground">
            See how the platform works
          </Link>
        </div>
        <p className="text-sm text-olive">
          If you are looking for immediate support, the{" "}
          <Link href="/crisis" className="underline">crisis resources page</Link> is public and
          always available.
        </p>
      </div>
    </PublicPage>
  );
}
