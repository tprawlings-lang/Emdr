import Link from "next/link";
import { ClinicianPage } from "@/components/clinical/ClinicianPage";
import { requireClinician } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Referrals — Steady Clinical" };

// Referrals (§26: "Move intake to first contact").
//
// The capability does not exist, so the screen says so and renders nothing that
// implies otherwise. §14: "Explain what is absent and whether that is expected."
//
// The alternative — an empty list with the right columns and a filter bar — is
// worse than no screen. It reads as "no items today" rather than "this does not
// work yet", and a clinician who believes the first will stop checking.

// WHAT DOES EXIST, since one of the four questions was answered.
//
// Handoff 09 §11 decided how a referral export is assembled — passive
// compilation rather than member curation — and that decision was recorded
// before anything was built on it. The compiler now exists and the member can
// read its output. Sending still cannot happen, for two reasons that are
// absences rather than unfinished work, and naming them on the screen is what
// stops it from reading as merely unbuilt.

export default async function ReferralsPage() {
  await requireClinician();
  return (
    <ClinicianPage
      layer="actions"
      here="/clinician/referrals"
      title="Referrals"
      lede="Intake and referral tracking is not part of this environment."
    >

      <div className="mt-8 rounded-3xl border border-ground/10 bg-linen p-6">
        <p className="measure text-ground/90">There is no referral record, no eligibility check and no wait clock. This screen needs eligibility, consent, wait time and owner; none of those four exist as data yet.</p>
        <p className="measure mt-3 text-sm text-olive">A referral queue with no wait clock is worse than none: it reports movement it cannot measure, and the time-to-first-contact figure is the one thing this screen exists to make visible.</p>
      </div>

      <section aria-labelledby="packet" className="mt-6">
        <h2 id="packet" className="text-xs font-semibold uppercase tracking-wide text-olive">
          What a referral packet would contain
        </h2>
        <div className="mt-3 rounded-3xl border border-ground/10 bg-linen p-5">
          <p className="measure text-sm text-ground/90">
            Assembled from records that already exist: the consent scopes on file, the
            latest reading of each validated instrument with its version, the safety
            engine&apos;s most recent routing, engagement as counts, and the readiness
            track. Every value is a code, a count, a score, a date or a short label —
            nothing the member wrote, no session content, no clinician note, and none of
            the reasons behind a safety decision.
          </p>
          <p className="measure mt-3 text-sm text-olive">
            It cannot be disclosed. No consent scope in this product authorises sending a
            record outside it — the three that exist authorise running the care program,
            recording measures and running a session — and there is no destination. The
            member can read the whole packet under Profile and privacy, which is the
            condition attached to compiling it without asking them.
          </p>
          <p className="measure mt-3 text-sm text-olive">
            Defined in <code>src/lib/clinical/referral-packet.ts</code>.
          </p>
        </div>
      </section>

      <section aria-labelledby="instead" className="mt-6">
        <h2 id="instead" className="text-xs font-semibold uppercase tracking-wide text-olive">
          What does work
        </h2>
        <ul className="mt-3 space-y-3">
          <li className="rounded-3xl border border-ground/10 bg-linen p-5">
            <Link href="/clinician/caseload" className="font-medium text-ground underline">Caseload</Link>
            <p className="measure mt-1 text-sm text-olive">Who is already enrolled, ordered by need.</p>
          </li>
          <li className="rounded-3xl border border-ground/10 bg-linen p-5">
            <Link href="/clinician/patients" className="font-medium text-ground underline">Patients</Link>
            <p className="measure mt-1 text-sm text-olive">Find anyone in this tenant by name.</p>
          </li>
        </ul>
      </section>
    </ClinicianPage>
  );
}
