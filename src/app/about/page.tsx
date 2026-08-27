import Link from "next/link";
import { PublicPage, BoundaryNote, ReviewCTA } from "@/components/site/PublicChrome";
import { BOUNDARY, SITE_CLAIMS_VERSION } from "@/lib/site/registry";
import { KNOWN_GAPS } from "@/lib/site/trust";

export const metadata = {
  title: "Why Steady — position, stage, and operating standards",
  description:
    "Why Steady exists, what stage it is actually at, how the team works, and the standards it holds its own claims to. Development prototype using fabricated data.",
};

// "Why Steady" (Redesign handoff §5, §10).
//
// This is the page most likely to drift back into a pitch, because a founding
// story invites confident language and nobody fact-checks a mission statement.
// So the rule applied here is the one the handoff sets for every other page:
// a claim about Steady must be checkable, and a claim that is not yet true is
// written as not yet true.
//
// Two things are deliberately kept off this page. There are no named advisors,
// customers, or clinicians — naming people implies endorsements that do not
// exist. And there are no traction numbers, because the environment they would
// be drawn from is fabricated.

const PRINCIPLES: Array<[string, string]> = [
  [
    "Safety decisions belong to people",
    "Every decision that can stop, pace, or escalate a session is made by ordered, human-authored rules that a clinician can read. A model can summarise and suggest. It cannot decide, and no setting exists that would let it.",
  ],
  [
    "History is appended, never rewritten",
    "Corrections supersede; they do not erase. The record of what the system believed at the time it acted survives the correction, because that is the record a reviewer actually needs.",
  ],
  [
    "A claim carries its evidence or it is not made",
    "Every capability on this site has a status, an owner, a review date, and — where one exists — the file or command that supports it. Where nothing supports a claim, the claim is marked planned rather than softened.",
  ],
  [
    "Gaps are published, not managed",
    `We keep a written register of what is missing and show it to reviewers before they ask. ${KNOWN_GAPS.length} open gaps are listed on the Trust Center today.`,
  ],
  [
    "The boundary is stated everywhere, not once",
    "The demonstration boundary appears on every public page and inside the product itself, because a disclosure read once on a landing page does not travel with the person who scrolled past it.",
  ],
];

export default function About() {
  return (
    <PublicPage
      eyebrow="Why Steady"
      title="Built to be reviewed before it is used."
      lede="Steady is a development-stage behavioral health platform. This page describes what it is for, what stage it is honestly at, and the standards we hold our own claims to."
    >
      <div className="mt-8">
        <BoundaryNote />
      </div>

      {/* 1 — The problem, stated structurally */}
      <section className="mt-14">
        <h2 className="font-serif text-3xl font-medium text-ground">The problem we started from</h2>
        <p className="mt-3 text-ground/80">
          Behavioral health care is delivered in appointments. The weeks between them are
          where symptoms move, patterns form, and people quietly decide whether to
          continue. Almost none of that reaches the care team, and what does arrive is
          recalled at the next visit rather than observed when it happened.
        </p>
        <p className="mt-3 text-ground/80">
          There is no shortage of tools for the between-visit weeks. What is missing is a
          connection between those weeks and the clinician responsible for the care — a
          structured record that a person can act on, with the reasoning attached.
        </p>
        <p className="mt-3 text-sm text-olive">
          Steady is built to close that gap. It has not demonstrated that it does. That
          distinction is the whole point of the current stage — see{" "}
          <Link href="/evidence" className="underline">Evidence and validation</Link>.
        </p>
      </section>

      {/* 2 — The approach */}
      <section className="mt-14">
        <h2 className="font-serif text-3xl font-medium text-ground">The approach</h2>
        <p className="mt-3 text-ground/80">
          Steady is one platform with three layers rather than three products. A member
          experience produces structured, timestamped signals; a clinician workflow reads
          those signals with their provenance intact; and an event, policy, and audit layer
          connects the two over time and keeps the record reconstructable.
        </p>
        <p className="mt-3 text-ground/80">
          The consequence of that shape is that the clinical surface is not a dashboard
          built over a database. It is assembled from the same event history the member
          experience wrote, which is why a summary can cite the events it rests on and why
          a reviewer can rebuild the current state from the log and compare it.
        </p>
        <Link href="/platform" className="mt-4 inline-block text-sm font-medium text-ground underline">
          How the three layers fit together →
        </Link>
      </section>

      {/* 3 — Operating principles */}
      <section className="mt-14">
        <h2 className="font-serif text-3xl font-medium text-ground">How we build</h2>
        <p className="mt-2 text-ground/80">
          These are commitments enforced in the codebase and in the test suite, not
          aspirations.
        </p>
        <ul className="mt-6 space-y-4">
          {PRINCIPLES.map(([h, b]) => (
            <li key={h} className="rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4">
              <h3 className="font-medium text-ground">{h}</h3>
              <p className="mt-1 text-sm text-ground/80">{b}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 4 — Stage, stated without softening */}
      <section className="mt-14">
        <h2 className="font-serif text-3xl font-medium text-ground">What stage we are at</h2>
        <p className="mt-3 text-ground/80">
          Steady is a small, founder-led engineering effort at validation stage. It is not
          a deployed service, and it has no users in the ordinary sense — the only people
          in the environment are invented.
        </p>
        <ul className="mt-5 space-y-2 text-sm text-ground/80">
          {[
            "Public enrollment and subscription billing are closed.",
            "No real patient, payer, or employee health information has entered any Steady environment, and none may.",
            "No business associate agreement is in place with any vendor.",
            "No clinical review, independent security audit, or counsel determination has been completed.",
            "No pilot has been run, and no organization has deployed Steady.",
          ].map((t) => (
            <li key={t} className="flex gap-2">
              <span aria-hidden className="text-olive">·</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-olive">
          {BOUNDARY.noEnrollment} Those gates decide the timing; a schedule does not decide
          them.
        </p>
      </section>

      {/* 5 — Accountability */}
      <section className="mt-14">
        <h2 className="font-serif text-3xl font-medium text-ground">Who is accountable</h2>
        <p className="mt-3 text-ground/80">
          Every capability, control, and open gap published on this site carries a named
          accountable function and a review date. At this stage those functions are
          founder-held, and several of the roles a pilot would require are not yet filled —
          a clinical owner, a security owner, privacy and legal review, support, incident
          response, and an evaluation owner. We list them as unfilled rather than implying
          they are covered.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/trust"
            className="rounded-full border border-ground/25 px-5 py-2 text-sm font-medium text-ground"
          >
            Control status and known gaps
          </Link>
          <Link
            href="/organizations"
            className="rounded-full border border-ground/25 px-5 py-2 text-sm font-medium text-ground"
          >
            What a pilot would require
          </Link>
        </div>
      </section>

      {/* 6 — How to check the claims on this site */}
      <section className="mt-14">
        <h2 className="font-serif text-3xl font-medium text-ground">Checking what we say</h2>
        <p className="mt-3 text-ground/80">
          Status labels on this site come from one registry rather than being written page
          by page, and an automated test fails the build if a page states a status the
          registry does not, links to a retired purchase route, or uses a restricted
          compliance phrase outside an explicit denial. The published claim set is
          versioned so a reviewer can tie what they read to a specific build.
        </p>
        <p className="mt-3 text-sm text-olive">
          Current reviewed content version: <code>{SITE_CLAIMS_VERSION}</code>. If something
          on this site does not match what you see in the demonstration, that is a defect —
          tell us and we will correct the page or the claim.
        </p>
        <Link href="/evidence" className="mt-4 inline-block text-sm font-medium text-ground underline">
          Commands you can run yourself →
        </Link>
      </section>

      <ReviewCTA
        heading="Review it before you believe it"
        body="Reviewers receive scoped access to the fabricated environment, a guided scenario for their discipline, and the matching evidence packet."
      />
    </PublicPage>
  );
}
