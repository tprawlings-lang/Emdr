import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClinician } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { MODULES } from "@/lib/modules";
import { audit } from "@/lib/audit";
import { scoreItq } from "@/lib/instruments";
import TrendChart from "@/components/TrendChart";

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
      "SELECT instrument, total_score, answers_json, risk_flags_json, created_at FROM screenings WHERE user_id = ? ORDER BY created_at DESC"
    )
    .all(id) as {
    instrument: string;
    total_score: number;
    answers_json: string;
    risk_flags_json: string;
    created_at: string;
  }[];

  const pcl5Series = screenings
    .filter((s) => s.instrument === "pcl-5")
    .reverse()
    .map((s) => ({ date: s.created_at.slice(0, 10), value: s.total_score }));
  const itqSeries = screenings
    .filter((s) => s.instrument === "itq")
    .reverse()
    .map((s) => ({
      date: s.created_at.slice(0, 10),
      ...scoreItq(JSON.parse(s.answers_json)),
    }));

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
      <Link href="/clinician" className="text-sm text-olive underline">
        ← Back to queue
      </Link>
      <h1 className="mt-3 font-serif text-3xl font-medium">{member.name}</h1>
      <p className="text-sm text-olive">
        {member.email} · joined {member.created_at.slice(0, 10)}
      </p>

      {(pcl5Series.length > 0 || itqSeries.length > 0) && (
        <section className="mt-8">
          <h2 className="font-serif text-2xl font-medium">Outcome trends</h2>
          <div className="mt-2 grid gap-4 md:grid-cols-2">
            {pcl5Series.length > 0 && (
              <TrendChart
                title="PCL-5 total"
                max={80}
                series={[{ label: "PCL-5", color: "#2f3a33", points: pcl5Series }]}
              />
            )}
            {itqSeries.length > 0 && (
              <TrendChart
                title="ITQ symptom sums"
                max={24}
                series={[
                  {
                    label: "PTSD",
                    color: "#5c7884",
                    points: itqSeries.map((s) => ({ date: s.date, value: s.ptsdSum })),
                  },
                  {
                    label: "DSO",
                    color: "#c9a98f",
                    points: itqSeries.map((s) => ({ date: s.date, value: s.dsoSum })),
                  },
                ]}
              />
            )}
          </div>
          {itqSeries.length > 0 && (
            <p className="mt-2 text-sm text-olive">
              Latest ITQ classification:{" "}
              <span className="font-semibold">{itqSeries[itqSeries.length - 1].label}</span>{" "}
              (provisional, screen-based — diagnosis remains a clinical decision)
            </p>
          )}
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-serif text-2xl font-medium">Screenings</h2>
        <div className="mt-2 overflow-x-auto rounded-3xl border border-ground/10 bg-linen shadow-soft">
          <table className="w-full text-sm">
            <thead className="bg-sand/40 text-left">
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
                const itq =
                  s.instrument === "itq" ? scoreItq(JSON.parse(s.answers_json)) : null;
                return (
                  <tr key={i} className="border-t border-ground/10">
                    <td className="px-4 py-2 font-medium">{s.instrument}</td>
                    <td className="px-4 py-2">
                      {itq
                        ? `PTSD ${itq.ptsdSum}/24 · DSO ${itq.dsoSum}/24 — ${itq.label}`
                        : s.total_score}
                    </td>
                    <td className="px-4 py-2 text-support-deep">{flags.join(", ") || "—"}</td>
                    <td className="px-4 py-2">{s.created_at}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-2xl font-medium">Check-ins (last 14)</h2>
        <div className="mt-2 overflow-x-auto rounded-3xl border border-ground/10 bg-linen shadow-soft">
          <table className="w-full text-sm">
            <thead className="bg-sand/40 text-left">
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
                <tr key={c.checkin_date} className="border-t border-ground/10">
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
        <h2 className="font-serif text-2xl font-medium">Sessions (last 20)</h2>
        <div className="mt-2 overflow-x-auto rounded-3xl border border-ground/10 bg-linen shadow-soft">
          <table className="w-full text-sm">
            <thead className="bg-sand/40 text-left">
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
                <tr key={s.id} className="border-t border-ground/10">
                  <td className="px-4 py-2 font-medium">{moduleName(s.module_id)}</td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        s.status === "hard_stop"
                          ? "font-semibold text-support-deep"
                          : s.status === "completed"
                            ? "text-safe-deep"
                            : "text-olive"
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
          <h2 className="font-serif text-2xl font-medium">Unlock history</h2>
          <div className="mt-2 space-y-2">
            {unlocks.length === 0 && <p className="text-sm text-olive">None.</p>}
            {unlocks.map((u, i) => (
              <div key={i} className="rounded-3xl border border-ground/10 bg-linen p-4 text-sm shadow-soft">
                <p className="font-medium">
                  {moduleName(u.module_id)} — {u.status}
                </p>
                {u.decision_reason && <p className="text-olive">Reason: {u.decision_reason}</p>}
                <p className="text-xs text-olive/70">
                  requested {u.requested_at}
                  {u.decided_at ? ` · decided ${u.decided_at}` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2 className="font-serif text-2xl font-medium">Consent ledger</h2>
          <div className="mt-2 space-y-2">
            {consents.map((c, i) => (
              <div key={i} className="rounded-3xl border border-ground/10 bg-linen p-4 text-sm shadow-soft">
                <p className="font-medium">
                  {c.policy_version} · {c.scope}
                </p>
                <p className="text-xs text-olive/70">
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
