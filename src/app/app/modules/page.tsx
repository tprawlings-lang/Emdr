import Link from "next/link";

import { requireMember } from "@/lib/auth";
import { MemberPage } from "@/components/member/MemberPage";
import { MODULES } from "@/lib/modules";
import { getUnlock, testOpenGated } from "@/lib/gating";
import { requestUnlock } from "@/lib/actions";

// Asking a clinician to open a gated module.
//
// THE WORKFLOW EXISTED AND HAD NO DOOR. `requestUnlock` and `decideUnlock` have
// been in lib/actions.ts with a table, events, an audit family and a
// pending-unlock count on the clinician's caseload — and not one page or
// component imported either of them. A member could not ask and a clinician
// could not answer. This is the half a member does.
//
// It is exactly the failure tests/surface-reachability.test.ts says it cannot
// see: "a domain can be readable while none of its commands are." lib/actions
// is imported by half the app for sign-in, so the module graph called it
// reached while this command had no caller at all.
//
// WHAT IT DOES NOT DO. Requesting is not unlocking, and nothing here decides
// anything: the row lands as `requested` and waits for a clinician. The daily
// safety read, the cooldown, the per-day cap and the kill switch are all
// downstream of the unlock and are not touched by it — an unlocked module is
// still refused on a day the check-in says so.

export const dynamic = "force-dynamic";
export const metadata = { title: "Modules — Steady" };

const STATUS_COPY: Record<string, string> = {
  requested: "Waiting for your clinician",
  unlocked: "Open",
  denied: "Not opened",
  revoked: "Closed again",
};

export default async function MemberModulesPage({
  searchParams,
}: {
  searchParams: Promise<{ requested?: string }>;
}) {
  const user = await requireMember();
  const { requested } = await searchParams;
  const gated = MODULES.filter((m) => m.tier === "gated").sort((a, b) => a.order - b.order);
  const rows = await Promise.all(
    gated.map(async (m) => ({ module: m, unlock: await getUnlock(user.id, m.id) })),
  );
  // The demo switch that opens gated modules without a clinician. Said on the
  // screen rather than left to make the request form look broken: with it on, a
  // request is still recorded and still answered, and the module was already
  // reachable anyway.
  const openedForTesting = testOpenGated();

  return (
    <MemberPage
      layer="evidence"
      title="Modules that need a clinician"
      lede="Some parts of the programme open only when a clinician says they are right for you."
    >
      {requested && (
        <p className="mt-4 rounded-2xl border border-sage/50 bg-sage/10 px-4 py-3 text-sm text-ground">
          Your request was sent. Your clinician will answer it — there is nothing else to do,
          and you will see the answer here.
        </p>
      )}

      {openedForTesting && (
        <p className="measure mt-4 rounded-2xl border border-ground/15 bg-linen px-4 py-3 text-sm text-olive">
          <span className="font-medium text-ground">This is a testing environment.</span> Gated
          modules are open here without a clinician decision, so you may find a module already
          available while a request is still waiting. Both are true; neither is a fault.
        </p>
      )}

      <ul className="mt-8 space-y-4">
        {rows.map(({ module: m, unlock }) => {
          const status = unlock?.status ?? null;
          const pending = status === "requested";
          return (
            <li key={m.id} className="rounded-3xl border border-ground/10 bg-linen p-5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="font-medium text-ground">{m.name}</h2>
                {status && (
                  <span className="rounded-full border border-ground/20 px-2 py-0.5 text-xs text-ground">
                    {STATUS_COPY[status] ?? status}
                  </span>
                )}
                <span className="text-xs text-olive">{m.durationLabel}</span>
              </div>
              <p className="measure mt-1 text-sm text-olive">{m.objective}</p>

              {unlock?.decision_reason && (
                // THE CLINICIAN'S REASON, SHOWN. A decision a member cannot read
                // is a decision they cannot disagree with, and "not opened" with
                // no reason is the version of this that damages trust.
                <p className="measure mt-2 rounded-2xl bg-ivory px-4 py-3 text-sm text-ground">
                  <span className="font-medium">What your clinician said:</span>{" "}
                  {unlock.decision_reason}
                </p>
              )}

              {status === "unlocked" ? (
                <p className="mt-3 text-sm text-olive">
                  Open. It still follows the same daily safety questions as everything else.
                </p>
              ) : pending ? (
                <p className="mt-3 text-sm text-olive">
                  Asked on {String(unlock?.requested_at ?? "").slice(0, 10)}. Nothing else to do.
                </p>
              ) : (
                <form action={requestUnlock} className="mt-4">
                  <input type="hidden" name="moduleId" value={m.id} />
                  <label className="block">
                    <span className="text-sm font-medium text-ground">
                      Why would this help right now?
                    </span>
                    <span className="measure mt-0.5 block text-xs text-olive">
                      Optional, and your clinician reads it. A sentence is plenty.
                    </span>
                    <textarea
                      name="note"
                      rows={2}
                      maxLength={500}
                      className="mt-1 w-full rounded-2xl border border-ground/15 bg-ivory px-4 py-2.5 focus:border-sage focus:outline-none"
                    />
                  </label>
                  <button
                    type="submit"
                    className="mt-3 rounded-full bg-sage px-6 py-2.5 font-medium text-ground transition-colors hover:bg-sage-deep"
                  >
                    {status === "denied" ? "Ask again" : "Ask my clinician"}
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      <p className="measure mt-8 text-sm text-olive">
        Asking does not start anything. A clinician decides, and an open module still runs the
        same daily check-in and safety rules as the rest of the programme.{" "}
        <Link href="/app/plan" className="underline">
          Back to your plan
        </Link>
      </p>
    </MemberPage>
  );
}
