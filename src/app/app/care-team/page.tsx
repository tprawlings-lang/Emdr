import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { data } from "@/lib/data";
import { MemberPage } from "@/components/member/MemberPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Care team — Steady" };

// Care team (§26: "See verified access — provider role and consent — Message or
// revoke").
//
// The screen answers one question a member is entitled to ask and previously
// could not: who can see this, and how do I stop that?
//
// It is written against what is actually true rather than what the product
// intends. This deployment has no assigned care team — /demo, /trust and the
// home FAQ all say so — and a screen listing a clinician here would contradict
// them, which is the notification-truth defect in a new place. So the empty
// state is the honest state, and it says which of the two reasons it is:
// nobody has been granted access, versus this environment has no care team to
// grant it to.

export default async function CareTeamPage() {
  const user = await requireMember();
  const c = await data();

  // Consent is the record of access, so it is what this screen reads. Revoked
  // rows are excluded rather than shown greyed: a withdrawn consent is not a
  // relationship, and listing it invites the reading that it is dormant.
  const consents = (await c.all(
    `SELECT policy_version, scope, granted_at FROM consents
      WHERE user_id = ? AND revoked_at IS NULL ORDER BY granted_at DESC`,
    [user.id]
  )) as Array<{ policy_version: string; scope: string; granted_at: string }>;

  return (
    <MemberPage
      layer="evidence"
      title="Care team"
      lede="Who can see your information, what they can see, and how to withdraw it."
    >
      <section aria-labelledby="access" className="rounded-3xl border border-ground/10 bg-linen p-6">
        <h2 id="access" className="font-medium text-ground">Who has access right now</h2>

        {/* The truthful answer for this environment, stated plainly and in the
            same terms the trust page uses. */}
        <p className="measure mt-2 text-ground/90">
          No clinician is assigned to you in this environment, and nobody is monitoring your
          activity.
        </p>
        <p className="measure mt-3 text-sm text-olive">
          When a care team exists, each person appears here with their role, what they can
          see, and a way to withdraw their access — and withdrawing it takes effect
          immediately rather than at the end of a period.
        </p>
      </section>

      <section aria-labelledby="consents" className="mt-6">
        <h2 id="consents" className="text-xs font-semibold uppercase tracking-wide text-olive">
          Permissions you have given
        </h2>
        {consents.length === 0 ? (
          <p className="measure mt-3 text-sm text-olive">
            You have not granted any data-sharing permissions yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {consents.map((c2) => (
              <li key={`${c2.scope}-${c2.granted_at}`} className="rounded-3xl border border-ground/10 bg-linen p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-ground">{c2.scope}</p>
                  <p className="font-mono text-xs text-olive">{c2.policy_version}</p>
                </div>
                <p className="mt-1 text-sm text-olive">Given {c2.granted_at.slice(0, 10)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="measure mt-8 text-sm text-olive">
        You can change what the companion remembers at any time in{" "}
        <Link href="/app/settings/memory" className="text-state-info underline">
          companion memory
        </Link>
        , and that is separate from anything a care team would see.
      </p>
    </MemberPage>
  );
}
