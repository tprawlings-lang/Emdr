import Link from "next/link";
import { requireClinician } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { decideUnlock, logout, reviewAlert } from "@/lib/actions";
import { MODULES } from "@/lib/modules";

const SEVERITY_STYLE: Record<string, string> = {
  urgent: "bg-red-100 text-red-800 border-red-300",
  high: "bg-amber-100 text-amber-800 border-amber-300",
  moderate: "bg-sky-100 text-sky-800 border-sky-300",
  info: "bg-stone-100 text-stone-700 border-stone-300",
};

export default async function ClinicianDashboard({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const clinician = await requireClinician();
  const { error } = await searchParams;
  const db = getDb();

  const alerts = db
    .prepare(
      `SELECT a.*, u.name AS member_name FROM alerts a
       JOIN users u ON u.id = a.user_id
       WHERE a.status = 'open'
       ORDER BY CASE a.severity WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END,
                a.created_at ASC`
    )
    .all() as {
    id: string;
    user_id: string;
    alert_type: string;
    severity: string;
    detail: string;
    created_at: string;
    member_name: string;
  }[];

  const unlockRequests = db
    .prepare(
      `SELECT mu.*, u.name AS member_name FROM module_unlocks mu
       JOIN users u ON u.id = mu.user_id
       WHERE mu.status = 'requested'
       ORDER BY mu.requested_at ASC`
    )
    .all() as {
    id: string;
    user_id: string;
    module_id: string;
    member_note: string | null;
    requested_at: string;
    member_name: string;
  }[];

  const members = db
    .prepare(
      `SELECT u.id, u.name, u.email,
        (SELECT total_score FROM screenings s WHERE s.user_id = u.id AND s.instrument = 'pcl-5' ORDER BY s.created_at DESC LIMIT 1) AS pcl5,
        (SELECT checkin_date FROM checkins c WHERE c.user_id = u.id ORDER BY c.checkin_date DESC LIMIT 1) AS last_checkin,
        (SELECT COUNT(*) FROM alerts a WHERE a.user_id = u.id AND a.status = 'open') AS open_alerts
       FROM users u WHERE u.role = 'member' ORDER BY open_alerts DESC, u.name`
    )
    .all() as {
    id: string;
    name: string;
    email: string;
    pcl5: number | null;
    last_checkin: string | null;
    open_alerts: number;
  }[];

  const moduleName = (id: string) => MODULES.find((m) => m.id === id)?.name ?? id;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Specialist dashboard</h1>
          <p className="text-sm text-stone-600">Signed in as {clinician.name}</p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/clinician/audit" className="text-sm underline">
            Audit console
          </Link>
          <form action={logout}>
            <button className="text-sm text-stone-500 underline">Sign out</button>
          </form>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error === "reason_required"
            ? "A documented reason is required for unlock decisions."
            : "A review note is required to close an alert."}
        </p>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-bold">
          Risk queue{" "}
          <span className="ml-1 rounded-full bg-stone-900 px-2 py-0.5 text-sm text-white">
            {alerts.length}
          </span>
        </h2>
        {alerts.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No open alerts.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {alerts.map((a) => (
              <div key={a.id} className={`rounded-lg border p-4 ${SEVERITY_STYLE[a.severity]}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {a.severity.toUpperCase()} · {a.alert_type.replaceAll("_", " ")} ·{" "}
                    <Link href={`/clinician/member/${a.user_id}`} className="underline">
                      {a.member_name}
                    </Link>
                  </p>
                  <span className="text-xs">{a.created_at}</span>
                </div>
                <p className="mt-1 text-sm">{a.detail}</p>
                <form action={reviewAlert} className="mt-3 flex flex-wrap gap-2">
                  <input type="hidden" name="alertId" value={a.id} />
                  <input
                    name="note"
                    required
                    placeholder="Assessment, action taken, follow-up schedule (required)"
                    className="min-w-72 flex-1 rounded-lg border border-stone-400 bg-white px-3 py-1.5 text-sm text-stone-900"
                  />
                  <button className="rounded-lg bg-stone-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-stone-700">
                    Mark reviewed
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-bold">
          Unlock requests{" "}
          <span className="ml-1 rounded-full bg-stone-900 px-2 py-0.5 text-sm text-white">
            {unlockRequests.length}
          </span>
        </h2>
        {unlockRequests.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No pending requests.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {unlockRequests.map((r) => (
              <div key={r.id} className="rounded-lg border border-violet-300 bg-violet-50 p-4">
                <p className="font-semibold text-violet-900">
                  {moduleName(r.module_id)} ·{" "}
                  <Link href={`/clinician/member/${r.user_id}`} className="underline">
                    {r.member_name}
                  </Link>
                  <span className="ml-2 text-xs font-normal">requested {r.requested_at}</span>
                </p>
                {r.member_note && (
                  <p className="mt-1 text-sm text-violet-900">Member note: “{r.member_note}”</p>
                )}
                <p className="mt-2 text-xs text-violet-800">
                  Review the member&apos;s trend, trigger inventory, and recent sessions before
                  deciding. Your reason is recorded in the audit ledger.
                </p>
                <form action={decideUnlock} className="mt-3 flex flex-wrap gap-2">
                  <input type="hidden" name="unlockId" value={r.id} />
                  <input
                    name="reason"
                    required
                    placeholder="Clinical reason for this decision (required)"
                    className="min-w-72 flex-1 rounded-lg border border-stone-400 bg-white px-3 py-1.5 text-sm"
                  />
                  <button
                    name="decision"
                    value="unlocked"
                    className="rounded-lg bg-green-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-800"
                  >
                    Unlock
                  </button>
                  <button
                    name="decision"
                    value="denied"
                    className="rounded-lg bg-stone-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-stone-800"
                  >
                    Deny for now
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-bold">Members</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-100 text-left">
              <tr>
                <th className="px-4 py-2">Member</th>
                <th className="px-4 py-2">Latest PCL-5</th>
                <th className="px-4 py-2">Last check-in</th>
                <th className="px-4 py-2">Open alerts</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t border-stone-100">
                  <td className="px-4 py-2">
                    <Link href={`/clinician/member/${m.id}`} className="font-medium underline">
                      {m.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{m.pcl5 ?? "—"}</td>
                  <td className="px-4 py-2">{m.last_checkin ?? "Never"}</td>
                  <td className="px-4 py-2">{m.open_alerts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
