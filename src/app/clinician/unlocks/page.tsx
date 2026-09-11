import Link from "next/link";

import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import { ClinicianPage } from "@/components/clinical/ClinicianPage";
import { Panel } from "@/components/app/surfaces";
import { MODULES } from "@/lib/modules";
import { decideUnlock } from "@/lib/actions";
import { testOpenGated } from "@/lib/gating";

// Answering a member's request to open a gated module.
//
// THE OTHER HALF OF A WORKFLOW THAT HAD NO DOOR. `decideUnlock` has existed in
// lib/actions.ts with a table, events and an audit family, and nothing imported
// it — so a request, once made, could never be answered. The caseload has
// counted `pending_unlocks` the whole time and there was nowhere to go.
//
// TENANT-SCOPED, like every other clinical surface. The query joins `users` and
// filters on the clinician's own tenant: an unlock queue that spanned tenants
// would let a clinician decide for somebody outside their care.
//
// A REASON IS REQUIRED AND THE MEMBER READS IT. `decideUnlock` refuses without
// one, and the member's own modules screen prints it back. "Not opened" with no
// reason is the version of this that damages trust, and a decision a member
// cannot read is one they cannot disagree with.
//
// WHAT AN UNLOCK IS NOT. It relaxes the clinician gate and nothing else. The
// daily check-in read, the cooldown, the per-day cap and the kill switch are
// all downstream and still hold — an unlocked module is refused on a day the
// member's own answers say so.

export const dynamic = "force-dynamic";
export const metadata = { title: "Module requests — Steady Clinical" };

interface Row {
  id: string;
  user_id: string;
  member_name: string;
  module_id: string;
  member_note: string | null;
  requested_at: string;
  status: string;
  decision_reason: string | null;
  decided_at: string | null;
}

export default async function UnlockQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ decided?: string; error?: string }>;
}) {
  const clinician = await requireClinician();
  const { decided, error } = await searchParams;
  const c = await data();
  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? PLATFORM_TENANT_ID;

  const rows = (await c.all(
    `SELECT mu.id, mu.user_id, u.name AS member_name, mu.module_id, mu.member_note,
            mu.requested_at, mu.status, mu.decision_reason, mu.decided_at
       FROM module_unlocks mu
       JOIN users u ON u.id = mu.user_id
      WHERE u.tenant_id = ? AND u.role = 'member'
      ORDER BY CASE mu.status WHEN 'requested' THEN 0 ELSE 1 END,
               mu.requested_at DESC`,
    [tenantId],
  )) as Row[];

  const waiting = rows.filter((r) => r.status === "requested");
  const answered = rows.filter((r) => r.status !== "requested");
  const moduleName = (id: string) => MODULES.find((m) => m.id === id)?.name ?? id;

  return (
    <ClinicianPage title="Module requests" layer="actions" here="/clinician/unlocks">
      <div className="space-y-6">
        {error && (
          <p className="rounded-2xl border border-support/40 bg-support/10 px-4 py-3 text-sm text-support-deep">
            {error}
          </p>
        )}
        {decided && (
          <p className="rounded-2xl border border-ground/15 bg-app-surface px-4 py-3 text-sm text-app-ink">
            Recorded as <strong>{decided === "unlocked" ? "opened" : "not opened"}</strong>. The
            member sees your reason on their own screen.
          </p>
        )}

        {testOpenGated() && (
          <Panel title="Gated modules are open in this environment">
            <p className="measure text-sm text-app-ink">
              <code>EMDR_OPEN_GATED</code> is on, so members can reach gated modules without a
              decision here. Requests are still recorded and still answered — but to review the
              request-and-approve path as it behaves in production, set{" "}
              <code>EMDR_OPEN_GATED=0</code>.
            </p>
          </Panel>
        )}

        <Panel
          title={`Waiting for a decision (${waiting.length})`}
          footnote="A decision needs a reason, and the member reads it on their own modules screen. An unlock relaxes this gate only — the daily check-in, the cooldown, the per-day cap and the kill switch all still apply."
        >
          {waiting.length === 0 ? (
            <p className="measure text-sm text-olive">
              Nothing waiting. A member asks from their own modules screen, and it appears here.
            </p>
          ) : (
            <ul className="space-y-4">
              {waiting.map((r) => (
                <li key={r.id} className="rounded-2xl border border-ground/10 bg-app-surface px-4 py-4">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <Link
                      href={`/clinician/member/${r.user_id}`}
                      className="font-medium text-app-ink underline"
                    >
                      {r.member_name}
                    </Link>
                    <span className="text-app-ink">{moduleName(r.module_id)}</span>
                    <span className="text-xs text-olive">asked {r.requested_at.slice(0, 10)}</span>
                  </div>
                  {r.member_note && (
                    <p className="measure mt-2 rounded-xl bg-linen px-3 py-2 text-sm text-app-ink">
                      <span className="font-medium">They said:</span> {r.member_note}
                    </p>
                  )}
                  <form action={decideUnlock} className="mt-3 space-y-2">
                    <input type="hidden" name="unlockId" value={r.id} />
                    <label className="block text-sm">
                      <span className="font-medium text-app-ink">
                        Your reason — the member reads this
                      </span>
                      <textarea
                        name="reason"
                        rows={2}
                        required
                        minLength={3}
                        maxLength={1000}
                        placeholder="What you decided and why, in words they can act on."
                        className="mt-1 w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        name="decision"
                        value="unlocked"
                        className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-app-surface hover:opacity-90"
                      >
                        Open the module
                      </button>
                      <button
                        name="decision"
                        value="denied"
                        className="rounded-full border border-ground/25 px-4 py-2 text-sm font-medium text-app-ink hover:bg-linen"
                      >
                        Not yet
                      </button>
                    </div>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`Already answered (${answered.length})`}>
          {answered.length === 0 ? (
            <p className="text-sm text-olive">Nothing answered yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {answered.map((r) => (
                <li key={r.id} className="border-b border-ground/10 pb-2 last:border-0">
                  <span className="text-app-ink">{r.member_name}</span>{" "}
                  <span className="text-olive">· {moduleName(r.module_id)} ·</span>{" "}
                  <strong className="text-app-ink">
                    {r.status === "unlocked" ? "opened" : r.status}
                  </strong>{" "}
                  <span className="text-olive">{(r.decided_at ?? "").slice(0, 10)}</span>
                  {r.decision_reason && (
                    <span className="text-olive"> — &ldquo;{r.decision_reason}&rdquo;</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </ClinicianPage>
  );
}
