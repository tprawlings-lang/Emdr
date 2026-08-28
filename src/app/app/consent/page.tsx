import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { data } from "@/lib/data";
import { MemberPage } from "@/components/member/MemberPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Consent and sharing — Steady" };

// Consent and sharing (§26: "Choose storage and care-team sharing — consent
// projection — Save choices").
//
// Consent existed as a step buried in onboarding: agreed once, never shown
// again, and impossible to review without re-running a flow. §26 makes it a
// screen the member can return to, which is the difference between consent as
// a gate and consent as a standing choice.
//
// What this screen does NOT do: offer a toggle that does nothing. The
// underlying revocation path is a service action, and building a switch that
// writes nothing would be the same defect as a Send button with no recipient.
// So each grant is shown with what it covers and its policy version, and
// withdrawal routes to the place that actually performs it.

export default async function ConsentPage() {
  const user = await requireMember();
  const c = await data();

  const grants = (await c.all(
    `SELECT scope, policy_version, granted_at, revoked_at FROM consents
      WHERE user_id = ? ORDER BY granted_at DESC`,
    [user.id]
  )) as Array<{ scope: string; policy_version: string; granted_at: string; revoked_at: string | null }>;

  const active = grants.filter((g) => !g.revoked_at);
  const withdrawn = grants.filter((g) => g.revoked_at);

  return (
    <MemberPage
      title="Consent and sharing"
      lede="What you have agreed to, when, and under which version of the terms."
    >
      <section aria-labelledby="active">
        <h2 id="active" className="text-xs font-semibold uppercase tracking-wide text-olive">
          Active
        </h2>
        {active.length === 0 ? (
          <p className="measure mt-3 text-sm text-olive">
            You have no active consents on record. Sessions stay closed until consent is
            given, and grounding, the companion and crisis support stay open regardless.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {active.map((g) => (
              <li key={`${g.scope}-${g.granted_at}`} className="rounded-3xl border border-ground/10 bg-linen p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-ground">{g.scope}</p>
                  {/* The version matters: a member who agreed under v1 did not
                      agree to v2, and showing the version is what makes that
                      checkable rather than asserted. */}
                  <p className="font-mono text-xs text-olive">{g.policy_version}</p>
                </div>
                <p className="mt-1 text-sm text-olive">Given {g.granted_at.slice(0, 10)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Withdrawn consents are kept visible. A record that quietly disappears
          when revoked cannot be audited by the person it belongs to. */}
      {withdrawn.length > 0 && (
        <section aria-labelledby="withdrawn" className="mt-8">
          <h2 id="withdrawn" className="text-xs font-semibold uppercase tracking-wide text-olive">
            Withdrawn
          </h2>
          <ul className="mt-3 space-y-2">
            {withdrawn.map((g) => (
              <li key={`${g.scope}-${g.granted_at}`} className="text-sm text-olive">
                {g.scope} — given {g.granted_at.slice(0, 10)}, withdrawn{" "}
                {g.revoked_at!.slice(0, 10)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 rounded-3xl border border-ground/10 bg-ivory p-5">
        <p className="measure text-sm text-ground/90">
          Withdrawing consent stops new processing immediately. It does not erase what is
          already recorded — corrections and history append rather than delete, which is what
          makes the record trustworthy for you as well as for a reviewer.
        </p>
        <p className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href="/app/settings/memory" className="text-state-info underline">
            Companion memory
          </Link>
          <Link href="/app/care-team" className="text-state-info underline">
            Who has access
          </Link>
          <Link href="/privacy" className="text-state-info underline">
            How data is handled
          </Link>
        </p>
      </div>
    </MemberPage>
  );
}
