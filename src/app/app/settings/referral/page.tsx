import { MemberPage } from "@/components/member/MemberPage";
import { requireMember } from "@/lib/auth";
import { data } from "@/lib/data";
import { buildReferralPacket } from "@/lib/clinical/referral-packet-store";
import { EXISTING_SCOPES, DISCLOSURE_SCOPE } from "@/lib/clinical/referral-packet";

export const dynamic = "force-dynamic";
export const metadata = { title: "What a referral would contain — Steady" };

// What a referral would contain, shown to the member (handoff 09 §11).
//
// §11 asked whether a referral export is assembled by the system or curated by
// the member, and the answer was PASSIVE COMPILATION — with a condition
// attached: the system "tells the member what it contains". This screen is that
// condition. Compiling somebody's record without asking them is only defensible
// if they can read the result before it goes anywhere, and this is the only
// place in the product where that is true.
//
// SO THE ABSENCES ARE THE POINT, not the fields. Anybody can show a list of
// what a packet holds. What a member actually wants to know is whether the
// things they typed into a companion at two in the morning are in it, and the
// answer is on this page with the reason beside it.
//
// AND IT CANNOT BE SENT. Not "is not sent yet" — cannot: no consent scope in
// this product authorises disclosing a record outside it, and there is no
// destination. Both are absences, and the screen states them rather than
// rendering a disabled button that implies the rest is built.

export default async function ReferralContentsPage() {
  const user = await requireMember();
  const c = await data();
  const row = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [user.id])) as
    | { tenant_id: string } | undefined;

  const packet = await buildReferralPacket({
    personId: user.id,
    tenantId: row?.tenant_id ?? "",
  });

  return (
    <MemberPage
      layer="evidence"
      title="What a referral would contain"
      lede="If you were ever referred on, this is what would go with you — and what would not."
    >
      <div className="rounded-3xl border border-state-caution/40 bg-state-caution-bg p-5">
        <p className="text-sm font-medium text-app-ink">Nothing here can be sent.</p>
        <p className="measure mt-2 text-sm text-app-ink">{packet.refusal}</p>
      </div>

      <section aria-labelledby="contents" className="mt-8">
        <h2 id="contents" className="text-xs font-semibold uppercase tracking-wide text-olive">
          What it would contain
        </h2>
        <p className="measure mt-2 text-sm text-olive">
          Assembled from what Steady already holds. You are not asked to choose any of
          it — being referred on is a poor moment to ask somebody to sort through
          their own history — so instead you get the whole of it, here, first.
        </p>
        <ul className="mt-4 space-y-4">
          {packet.sections.map((s) => (
            <li key={s.kind} className="rounded-3xl border border-ground/10 bg-linen p-5">
              <p className="font-medium text-ground">{s.title}</p>
              <p className="measure mt-1 text-sm text-olive">{s.why}</p>
              {s.absent ? (
                <p className="measure mt-3 text-sm text-olive">{s.absent}</p>
              ) : (
                <dl className="mt-3 space-y-2">
                  {s.fields.map((f) => (
                    <div key={f.label} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
                      <dt className="min-w-0 text-sm text-ground">
                        {f.label}
                        <span className="measure mt-0.5 block text-xs text-olive">{f.source}</span>
                      </dt>
                      <dd className="text-sm tabular-nums text-ground">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="never" className="mt-8">
        <h2 id="never" className="text-xs font-semibold uppercase tracking-wide text-olive">
          What it would never contain
        </h2>
        <ul className="mt-3 space-y-3">
          {packet.excluded.map((e) => (
            <li key={e.what} className="rounded-3xl border border-ground/10 bg-linen p-5">
              <p className="font-medium text-ground">{e.what}</p>
              <p className="measure mt-1 text-sm text-olive">{e.why}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* THE VOCABULARY, NOT THIS MEMBER'S CONSENTS. What this member granted is
          in "Consent on file" above, compiled from their own record. This lists
          every scope the product can record at all, because the point being
          made is about the SET: none of the three is a consent to disclose.
          It was headed "What you have agreed to", which named the wrong thing —
          it listed scopes this member had never been asked for. */}
      <section aria-labelledby="scopes" className="mt-8">
        <h2 id="scopes" className="text-xs font-semibold uppercase tracking-wide text-olive">
          Every consent Steady can ask for
        </h2>
        <ul className="mt-3 space-y-2">
          {EXISTING_SCOPES.map((s) => (
            <li key={s.scope} className="rounded-2xl border border-ground/10 bg-linen px-4 py-3">
              <p className="text-sm text-ground"><code>{s.scope}</code></p>
              <p className="measure mt-0.5 text-xs text-olive">{s.authorises}</p>
            </li>
          ))}
        </ul>
        <p className="measure mt-3 text-sm text-olive">
          These are the only three, and your own are listed under “Consent on file”
          above. None of the three is a consent to disclose. A referral would need one
          recorded under <code>{DISCLOSURE_SCOPE}</code>, and you have not been asked for
          it because there is nothing yet to ask about.
        </p>
      </section>
    </MemberPage>
  );
}
