import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { MemberPage } from "@/components/member/MemberPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Messages — Steady" };

// Messages (§26: "Communicate securely — care-team thread and boundary — Send").
//
// There is no messaging in this system. No table, no thread, no delivery path,
// and no care team to reach — the same absence the escalation channel has.
//
// So this screen renders that, and does not render an empty inbox. An inbox
// with a composer and no recipient is worse than no screen at all: it invites a
// member to write something they need someone to read, and then holds it. That
// is the notification-truth defect with a text box attached — a claim of
// delivery made by the presence of a Send button rather than by a sentence.
//
// §14's rule applies exactly: "Explain what is absent and whether that is
// expected." It is expected. The screen says so, and points at what does work.

export default async function MessagesPage() {
  await requireMember();
  return (
    <MemberPage
      title="Messages"
      lede="Secure messaging with a care team is not part of this environment."
    >
      <div className="rounded-3xl border border-ground/10 bg-linen p-6">
        <p className="measure text-ground/90">
          There is no message thread here, and no Send button, because there is nobody
          assigned to receive one. Nothing in this environment is monitored.
        </p>
        <p className="measure mt-3 text-sm text-olive">
          When messaging exists, this screen will show the thread, who can read it, and how
          long a reply usually takes — and it will say when a message was actually delivered
          rather than when it was sent.
        </p>
      </div>

      {/* What does work, named rather than left for the member to find. */}
      <section aria-labelledby="instead" className="mt-6">
        <h2 id="instead" className="text-xs font-semibold uppercase tracking-wide text-olive">
          Reaching a person now
        </h2>
        <ul className="mt-3 space-y-3">
          <li className="rounded-3xl border border-ground/10 bg-linen p-5">
            <a href="tel:988" className="font-medium text-ground underline">Call or text 988</a>
            <p className="measure mt-1 text-sm text-olive">
              The Suicide &amp; Crisis Lifeline, staffed by people, at any hour. It does not
              depend on Steady working.
            </p>
          </li>
          <li className="rounded-3xl border border-ground/10 bg-linen p-5">
            <Link href="/crisis" className="font-medium text-ground underline">All crisis resources</Link>
            <p className="measure mt-1 text-sm text-olive">
              Including your own safe-person contact, if you have added one.
            </p>
          </li>
          <li className="rounded-3xl border border-ground/10 bg-linen p-5">
            <Link href="/app/companion" className="font-medium text-ground underline">The companion</Link>
            <p className="measure mt-1 text-sm text-olive">
              Available any time, and not a person — it says so itself, and it cannot provide
              crisis care.
            </p>
          </li>
        </ul>
      </section>
    </MemberPage>
  );
}
