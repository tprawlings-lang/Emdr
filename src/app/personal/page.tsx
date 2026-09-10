import Link from "next/link";
import { PublicPage, BoundaryNote, CapabilityCard, ReviewCTA } from "@/components/site/PublicChrome";
import { byLayer } from "@/lib/site/registry";

export const metadata = {
  title: "Steady Personal — what a member actually sees",
  description:
    "The member surface: what it does between visits, what it refuses to do, and where each limit comes from.",
};

// Steady Personal (§26 p45: "/personal — Review member value and limits —
// member page examples — Review demo").
//
// A SEPARATE SCREEN FROM /platform, and it took reading p45 to see why. The
// repository had this filed as "naming only — content lives at /platform",
// which was wrong: /platform's purpose is "understand one system and three
// surfaces", and this one's is "review member VALUE AND LIMITS". Those are
// different questions, and the second is the one a clinician asks.
//
// SO THE LIMITS ARE THE PAGE, not a disclaimer at the bottom of it. A product
// page that lists what a member gets and then footnotes what it will not do has
// answered half the question it was given. Each section below names a thing the
// member surface does and, beside it, the thing it deliberately does not — and
// the pairs are not softened, because a reviewer who finds a limit themselves
// after being shown only capabilities stops believing the capabilities.

const WHAT_IT_DOES: Array<{ does: string; not: string }> = [
  {
    does:
      "Asks a short daily check-in and computes today's safest next step from the answers — grounding only, stabilization, or ordinary work.",
    not:
      "It does not decide that a member is well, or unwell. The check-in routes what happens next; it is not an assessment and produces no score anyone is told to act on.",
  },
  {
    does:
      "Runs grounding and preparation exercises that work without an account, a network round-trip, or a working database.",
    not:
      "It does not run trauma-memory processing on its own. Bilateral stimulation in this product is present-focused resourcing, and the configuration that would permit autonomous reprocessing is off and has never been signed.",
  },
  {
    does:
      "Keeps a companion conversation that remembers what a member has told it, and a safety plan in their own words.",
    not:
      "It does not replace a clinician, and it cannot clear a safety state. A model in this product may propose; only a person may accept.",
  },
  {
    does:
      "Records measures over time and shows the member their own trend, with the number of readings it is drawn from.",
    not:
      "It does not diagnose, and it does not predict. There is no risk score, because a score invites a decision the evidence cannot support.",
  },
  {
    does:
      "Puts crisis resources one press away on every screen, and keeps them reachable when everything else is down.",
    not:
      "It is not an emergency service and never claims to have contacted one. When it routes to a crisis line it says so plainly rather than implying somebody has been notified.",
  },
];

export default function PersonalPage() {
  return (
    <PublicPage
      eyebrow="Steady Personal"
      title="What a member actually sees"
      lede="The between-visit surface, described by what it does and what it refuses to do — because the second half is the part a reviewer cannot check for themselves from a feature list."
    >
      <div className="mt-8"><BoundaryNote /></div>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">Does, and does not</h2>
        <ul className="mt-4 space-y-4">
          {WHAT_IT_DOES.map((row) => (
            <li key={row.does} className="rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4">
              <p className="text-ground">{row.does}</p>
              <p className="mt-2 text-sm text-ground/80">
                <span className="font-medium">Not:</span> {row.not}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">The member capabilities</h2>
        <p className="mt-1 max-w-2xl text-ground/80">
          Each one carries its own status, and the status is the claim: what has been demonstrated
          is separated from what has been validated.
        </p>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {byLayer("personal").map((c) => <CapabilityCard key={c.id} c={c} />)}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">There is no public enrollment</h2>
        <p className="mt-2 max-w-2xl text-ground/80">
          A member reaches this surface through a care relationship, not a sign-up funnel. The
          demonstration environment contains fabricated people only, and every row in it is
          marked as fabricated in the database rather than by a banner on a page — so a export
          that leaves the building still carries the mark.
        </p>
        <p className="mt-3 max-w-2xl text-sm text-ground/80">
          <Link href="/platform" className="font-medium text-ground underline">
            How the three surfaces fit together
          </Link>
          {" · "}
          <Link href="/trust" className="font-medium text-ground underline">
            Safety, privacy and security
          </Link>
        </p>
      </section>

      <ReviewCTA heading="Review the member demo" />
    </PublicPage>
  );
}
