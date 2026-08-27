import Link from "next/link";
import { PublicPage, BoundaryNote } from "@/components/site/PublicChrome";

export const metadata = { title: "Demo Privacy Notice — Steady" };

// Demo Privacy Notice (Redesign handoff §16). Replaces the consumer privacy
// policy, which described real member health data, deletion rights, and
// subscriptions — describing data flows that do not exist here and omitting the
// ones that do.
//
// §16 requires the public site, the fabricated demo, and any future real-person
// service to be distinguished. That distinction is the structure of this page.
export default function PrivacyPage() {
  return (
    <PublicPage
      eyebrow="Legal"
      title="Demo Privacy Notice"
      lede="What Steady collects from reviewers and visitors, and what it does not collect — because the environment holds no real health information."
    >
      <p className="mt-6 rounded-2xl border border-pause/50 bg-pause-soft px-5 py-4 text-sm text-ground">
        <strong>Draft pending legal review.</strong> Counsel has not yet reviewed this document.
        Every factual statement below has been checked against the running code. Version
        2026-08-27.
      </p>

      <div className="mt-8"><BoundaryNote /></div>

      <section className="mt-10">
        <h2 className="font-serif text-2xl font-medium text-ground">Three different things</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <caption className="sr-only">How the public site, the demo, and a future service differ</caption>
            <thead>
              <tr className="border-b border-ground/15 text-left">
                <th scope="col" className="py-2 pr-4 font-medium">Public site</th>
                <th scope="col" className="py-2 pr-4 font-medium">Fabricated demo</th>
                <th scope="col" className="py-2 font-medium">Future real-person service</th>
              </tr>
            </thead>
            <tbody className="text-ground/80">
              <tr className="border-b border-ground/10 align-top">
                <td className="py-2 pr-4">Explains Steady and collects review requests.</td>
                <td className="py-2 pr-4">Collects reviewer access and scripted synthetic activity.</td>
                <td className="py-2">Requires separate privacy, consent, clinical, security, and contracting review.</td>
              </tr>
              <tr className="border-b border-ground/10 align-top">
                <td className="py-2 pr-4">No health-data intake.</td>
                <td className="py-2 pr-4">No real health-data intake.</td>
                <td className="py-2"><strong>Not authorised by this notice.</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-10 space-y-8 text-ground/80">
        <section>
          <h2 className="font-serif text-2xl font-medium text-ground">What we collect</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><strong>Review requests:</strong> the name, organization, review path, and contact details you provide.</li>
            <li><strong>Access records:</strong> which review path was granted, when access was used, and which fabricated persona was entered. Recorded in a tamper-evident audit log.</li>
            <li><strong>Activity in the demo:</strong> everything you do in the environment is recorded against <em>fabricated</em> records — check-ins, sessions, alerts, decisions, and feedback.</li>
            <li><strong>Feedback:</strong> what you report, together with the configuration and generator version that produced what you were looking at.</li>
            <li><strong>Operational logs:</strong> a session cookie and standard hosting logs.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-serif text-2xl font-medium text-ground">What we do not collect</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Real patient, payer, or employee health information. None exists in any environment.</li>
            <li>Advertising or cross-site tracking identifiers. No analytics or advertising service is installed.</li>
            <li>Payment information. There is no purchase path.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-serif text-2xl font-medium text-ground">Where data goes</h2>
          <p className="mt-2">
            The environment runs on a commercial hosting provider. Encrypted backups are stored
            with an object-storage provider. Companion conversations in the demo are sent to a
            commercial model provider to generate a response — and because every persona is
            fabricated, no real person&rsquo;s content has ever been sent.
          </p>
          <p className="mt-2">
            <strong>No business associate agreement is in place with any vendor.</strong> That is
            a prerequisite before any real information could be processed, and it is listed
            openly on the <Link href="/trust" className="underline">Trust Center</Link>.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl font-medium text-ground">Retention</h2>
          <p className="mt-2">
            The demo dataset is reset to a versioned baseline, which removes prior synthetic
            activity. Audit records are append-only by design and are not deleted. Review
            requests are kept while a review is arranged and afterwards for records of who was
            granted access.
          </p>
          <p className="mt-2 text-sm">
            Append-only history and erasure rights are in tension. That tension is recorded as a
            known gap awaiting a legal determination rather than resolved quietly in code — no
            real person&rsquo;s data is affected while it remains open.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl font-medium text-ground">Your choices</h2>
          <p className="mt-2">
            You can ask what we hold about you as a reviewer, ask for it to be corrected, or ask
            us to end your access and remove your request record. Because the environment holds
            no real health information about you, there is no clinical record to request.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl font-medium text-ground">Security</h2>
          <p className="mt-2">
            Current and dormant controls, the complete list of places data leaves Steady, and the
            gaps we have already found are published on the{" "}
            <Link href="/trust" className="underline">Trust Center</Link> rather than summarised
            reassuringly here.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl font-medium text-ground">Contact</h2>
          <p className="mt-2">
            Privacy questions can be raised through the same route as review access. A named
            privacy contact will be published once counsel is engaged.
          </p>
        </section>
      </div>
    </PublicPage>
  );
}
