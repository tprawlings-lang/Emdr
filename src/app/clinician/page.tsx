import Link from "next/link";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { decideUnlock, logout, reviewAlert } from "@/lib/actions";
import { MODULES } from "@/lib/modules";

const SEVERITY_STYLE: Record<string, string> = {
  urgent: "bg-support/15 text-support-deep border-support/50",
  high: "bg-pause-soft text-ground border-pause/60",
  moderate: "bg-mist/25 text-ground border-mist/60",
  info: "bg-linen text-ground/80 border-ground/15",
};

export default async function ClinicianDashboard({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const clinician = await requireClinician();
  const { error } = await searchParams;
  const c = await data();

  const alerts = await c.all(`SELECT a.*, u.name AS member_name FROM alerts a
       JOIN users u ON u.id = a.user_id
       WHERE a.status = 'open'
       ORDER BY CASE a.severity WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END,
                a.created_at ASC`, []) as {
    id: string;
    user_id: string;
    alert_type: string;
    severity: string;
    detail: string;
    created_at: string;
    member_name: string;
  }[];

  const unlockRequests = await c.all(`SELECT mu.*, u.name AS member_name FROM module_unlocks mu
       JOIN users u ON u.id = mu.user_id
       WHERE mu.status = 'requested'
       ORDER BY mu.requested_at ASC`, []) as {
    id: string;
    user_id: string;
    module_id: string;
    member_note: string | null;
    requested_at: string;
    member_name: string;
  }[];

  const members = await c.all(`SELECT u.id, u.name, u.email,
        (SELECT total_score FROM screenings s WHERE s.user_id = u.id AND s.instrument = 'pcl-5' ORDER BY s.created_at DESC LIMIT 1) AS pcl5,
        (SELECT checkin_date FROM checkins c WHERE c.user_id = u.id ORDER BY c.checkin_date DESC LIMIT 1) AS last_checkin,
        (SELECT COUNT(*) FROM alerts a WHERE a.user_id = u.id AND a.status = 'open') AS open_alerts
       FROM users u WHERE u.role = 'member' ORDER BY open_alerts DESC, u.name`, []) as {
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
          <h1 className="font-serif text-3xl font-medium">Specialist dashboard</h1>
          <p className="text-sm text-olive">Signed in as {clinician.name}</p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/clinician/clinical" className="text-sm text-olive underline">
            Steady Clinical
          </Link>
          <Link href="/clinician/autonomous" className="text-sm text-olive underline">
            Autonomous review
          </Link>
          <Link href="/clinician/bls" className="text-sm text-olive underline">
            BLS Part 6
          </Link>
          <Link href="/clinician/testing" className="text-sm text-olive underline">
            Testing
          </Link>
          <Link href="/clinician/audit" className="text-sm text-olive underline">
            Audit console
          </Link>
          <form action={logout}>
            <button className="text-sm text-olive underline">Sign out</button>
          </form>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-2xl border border-support/40 bg-support/10 px-4 py-3 text-sm text-support-deep">
          {error === "reason_required"
            ? "A documented reason is required for unlock decisions."
            : "A review note is required to close an alert."}
        </p>
      )}

      <section className="mt-8">
        <h2 className="font-serif text-2xl font-medium">
          Risk queue{" "}
          <span className="ml-1 rounded-full bg-ground px-2.5 py-0.5 text-sm text-ivory">
            {alerts.length}
          </span>
        </h2>
        {alerts.length === 0 ? (
          <p className="mt-3 text-sm text-olive">No open alerts.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {alerts.map((a) => (
              <div key={a.id} className={`rounded-3xl border p-5 ${SEVERITY_STYLE[a.severity]}`}>
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
                    className="min-w-72 flex-1 rounded-2xl border border-ground/20 bg-linen px-4 py-2 text-sm text-ground focus:border-sage focus:outline-none"
                  />
                  <button className="rounded-full bg-ground px-5 py-2 text-sm font-medium text-ivory transition-colors hover:bg-olive">
                    Mark reviewed
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl font-medium">
          Unlock requests{" "}
          <span className="ml-1 rounded-full bg-ground px-2.5 py-0.5 text-sm text-ivory">
            {unlockRequests.length}
          </span>
        </h2>
        {unlockRequests.length === 0 ? (
          <p className="mt-3 text-sm text-olive">No pending requests.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {unlockRequests.map((r) => (
              <div key={r.id} className="rounded-3xl border border-clay/50 bg-clay/15 p-5">
                <p className="font-semibold">
                  {moduleName(r.module_id)} ·{" "}
                  <Link href={`/clinician/member/${r.user_id}`} className="underline">
                    {r.member_name}
                  </Link>
                  <span className="ml-2 text-xs font-normal">requested {r.requested_at}</span>
                </p>
                {r.member_note && (
                  <p className="mt-1 text-sm text-ground/90">Member note: “{r.member_note}”</p>
                )}
                <p className="mt-2 text-xs text-olive">
                  Review the member&apos;s trend, trigger inventory, and recent sessions before
                  deciding. Your reason is recorded in the audit ledger.
                </p>
                <form action={decideUnlock} className="mt-3 flex flex-wrap gap-2">
                  <input type="hidden" name="unlockId" value={r.id} />
                  <input
                    name="reason"
                    required
                    placeholder="Clinical reason for this decision (required)"
                    className="min-w-72 flex-1 rounded-2xl border border-ground/20 bg-linen px-4 py-2 text-sm focus:border-sage focus:outline-none"
                  />
                  <button
                    name="decision"
                    value="unlocked"
                    className="rounded-full bg-safe-deep px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-safe"
                  >
                    Unlock
                  </button>
                  <button
                    name="decision"
                    value="denied"
                    className="rounded-full bg-olive px-5 py-2 text-sm font-medium text-ivory transition-colors hover:bg-ground"
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
        <h2 className="font-serif text-2xl font-medium">Members</h2>
        <div className="mt-3 overflow-x-auto rounded-3xl border border-ground/10 bg-linen shadow-soft">
          <table className="w-full text-sm">
            <thead className="bg-sand/40 text-left">
              <tr>
                <th className="px-4 py-2">Member</th>
                <th className="px-4 py-2">Latest PCL-5</th>
                <th className="px-4 py-2">Last check-in</th>
                <th className="px-4 py-2">Open alerts</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t border-ground/10">
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
