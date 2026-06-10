import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClinician } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { MODULES } from "@/lib/modules";
import { audit } from "@/lib/audit";

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const clinician = await requireClinician();
  const { id } = await params;
  const db = getDb();

  const member = db
    .prepare("SELECT id, name, email, created_at FROM users WHERE id = ? AND role = 'member'")
    .get(id) as { id: string; name: string; email: string; created_at: string } | undefined;
  if (!member) notFound();

  // Record-access events belong in the audit trail too.
  audit({
    actorId: clinician.id,
    actorRole: "clinician",
    family: "security",
    type: "member_record_viewed",
    target: member.id,
  });

  const screenings = db
    .prepare(
      "SELECT instrument, total_score, risk_flags_json, created_at FROM screenings WHERE user_id = ? ORDER BY created_at DESC"
    )
    .all(id) as { instrument: string; total_score: number; risk_flags_json: string; created_at: string }[];

  const checkins = db
    .prepare(
      "SELECT * FROM checkins WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 14"
    )
    .all(id) as {
    checkin_date: string;
    activation: number;
    shutdown: number;
    dissociation: number;
    sleep_quality: number;
    recommended_action: string;
  }[];

  const sessions = db
    .prepare(
      "SELECT * FROM therapy_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 20"
    )
    .all(id) as {
    id: string;
    module_id: string;
    status: string;
    pre_suds: number | null;
    post_suds: number | null;
    peak_suds: number | null;
    hard_stop_reason: string | null;
    started_at: string;
  }[];

  const unlocks = db
    .prepare("SELECT * FROM module_unlocks WHERE user_id = ? ORDER BY requested_at DESC")
    .all(id) as {
    module_id: string;
    status: string;
    decision_reason: string | null;
    requested_at: string;
    decided_at: string | null;
  }[];

  const consents = db
    .prepare("SELECT policy_version, scope, granted_at, revoked_at FROM consents WHERE user_id = ?")
    .all(id) as { policy_version: string; scope: string; granted_at: string; revoked_at: string | null }[];

  const moduleName = (mid: string) => MODULES.find((m) => m.id === mid)?.name ?? mid;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/clinician" className="text-sm underline">
        ← Back to queue
      </Link>
      <h1 className="mt-3 text-2xl font-bold">{member.name}</h1>
      <p className="text-sm text-stone-600">
        {member.email} · joined {member.created_at.slice(0, 10)}
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-bold">Screenings</h2>
        <div className="mt-2 overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-100 text-left">
              <tr>
                <th className="px-4 py-2">Instrument</th>
                <th className="px-4 py-2">Score</th>
                <th className="px-4 py-2">Risk flags</th>
                <th className="px-4 py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {screenings.map((s, i) => {
                const flags = JSON.parse(s.risk_flags_json) as string[];
                return (
                  <tr key={i} className="border-t border-stone-100">
                    <td className="px-4 py-2 font-medium">{s.instrument}</td>
                    <td className="px-4 py-2">{s.total_score}</td>
                    <td className="px-4 py-2 text-red-700">{flags.join(", ") || "—"}</td>
                    <td className="px-4 py-2">{s.created_at}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">Check-ins (last 14)</h2>
        <div className="mt-2 overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-100 text-left">
              <tr>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Activation</th>
                <th className="px-4 py-2">Shutdown</th>
                <th className="px-4 py-2">Dissociation</th>
                <th className="px-4 py-2">Sleep</th>
                <th className="px-4 py-2">Routed to</th>
              </tr>
            </thead>
            <tbody>
              {checkins.map((c) => (
                <tr key={c.checkin_date} className="border-t border-stone-100">
                  <td className="px-4 py-2">{c.checkin_date}</td>
                  <td className="px-4 py-2">{c.activation}</td>
                  <td className="px-4 py-2">{c.shutdown}</td>
                  <td className="px-4 py-2">{c.dissociation}</td>
                  <td className="px-4 py-2">{c.sleep_quality}</td>
                  <td className="px-4 py-2">{c.recommended_action.replaceAll("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">Sessions (last 20)</h2>
        <div className="mt-2 overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-100 text-left">
              <tr>
                <th className="px-4 py-2">Module</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">SUDS pre → post (peak)</th>
                <th className="px-4 py-2">Hard-stop reason</th>
                <th className="px-4 py-2">Started</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-t border-stone-100">
                  <td className="px-4 py-2 font-medium">{moduleName(s.module_id)}</td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        s.status === "hard_stop"
                          ? "font-semibold text-red-700"
                          : s.status === "completed"
                            ? "text-green-700"
                            : "text-stone-500"
                      }
                    >
                      {s.status.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {s.pre_suds ?? "—"} → {s.post_suds ?? "—"} ({s.peak_suds ?? "—"})
                  </td>
                  <td className="px-4 py-2">{s.hard_stop_reason ?? "—"}</td>
                  <td className="px-4 py-2">{s.started_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="text-lg font-bold">Unlock history</h2>
          <div className="mt-2 space-y-2">
            {unlocks.length === 0 && <p className="text-sm text-stone-500">None.</p>}
            {unlocks.map((u, i) => (
              <div key={i} className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
                <p className="font-medium">
                  {moduleName(u.module_id)} — {u.status}
                </p>
                {u.decision_reason && <p className="text-stone-600">Reason: {u.decision_reason}</p>}
                <p className="text-xs text-stone-400">
                  requested {u.requested_at}
                  {u.decided_at ? ` · decided ${u.decided_at}` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-lg font-bold">Consent ledger</h2>
          <div className="mt-2 space-y-2">
            {consents.map((c, i) => (
              <div key={i} className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
                <p className="font-medium">
                  {c.policy_version} · {c.scope}
                </p>
                <p className="text-xs text-stone-400">
                  granted {c.granted_at}
                  {c.revoked_at ? ` · revoked ${c.revoked_at}` : " · active"}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
