import Link from "next/link";
import { PublicPage } from "@/components/site/PublicChrome";

export const metadata = { title: "Accessibility — Steady" };

// Accessibility statement (Redesign handoff §16, §18). States what is tested,
// what is not, and how to report a barrier — rather than asserting conformance.
export default function AccessibilityPage() {
  return (
    <PublicPage
      eyebrow="Accessibility"
      title="Accessibility statement"
      lede="What is tested automatically, what has not been tested, and how to tell us about a barrier."
    >
      <div className="mt-10 space-y-8 text-ground/80">
        <section>
          <h2 className="type-display text-2xl font-medium text-ground">What is tested</h2>
          <p className="mt-2">
            An automated axe-core audit runs against the public surfaces on every change and
            blocks the build on any serious or critical violation. The suite also asserts
            keyboard reachability and that security headers are present on every response.
          </p>
          <p className="mt-2">
            Interfaces are built with semantic headings, visible focus, labelled form controls,
            and text that scales. Motion is restrained and reduced-motion preferences are
            honored, which matters more than usual in a product used by people who may be
            activated.
          </p>
        </section>

        <section>
          <h2 className="type-display text-2xl font-medium text-ground">What has not been tested</h2>
          <p className="mt-2">
            Automated checks catch a minority of real barriers. Steady has <strong>not</strong>{" "}
            had a manual screen-reader audit, an accessibility expert review, or testing with
            people who use assistive technology. No conformance level is claimed.
          </p>
        </section>

        <section>
          <h2 className="type-display text-2xl font-medium text-ground">Known limitations</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Human-factors testing of the session interface under stress has not been done, and is a condition of the existing clinical sign-off.</li>
            <li>Complex tables in the clinical console have not been audited with a screen reader.</li>
            <li>Content is currently English only.</li>
          </ul>
        </section>

        <section>
          <h2 className="type-display text-2xl font-medium text-ground">Reporting a barrier</h2>
          <p className="mt-2">
            If something is unusable, tell us through the same route as review access and
            describe what you were trying to do. Accessibility defects are treated as product
            defects, not enhancements.
          </p>
          <Link href="/request-review" className="mt-3 inline-block text-sm font-medium text-ground underline">
            Contact us →
          </Link>
        </section>
      </div>
    </PublicPage>
  );
}
