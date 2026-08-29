import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { MODULES } from "@/lib/modules";
import { audit } from "@/lib/audit";
import { scoreItq } from "@/lib/instruments";
import { decryptField } from "@/lib/crypto";
import { getProgramPlan } from "@/lib/program-plan";
import { clinicianCloseModule, clinicianOpenModule } from "@/lib/actions";
import TrendChart from "@/components/TrendChart";
import { loadPersonHeader } from "@/lib/clinical/person-header";
import { PersonShell } from "@/components/clinical/PersonShell";

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const clinician = await requireClinician();
  const { id } = await params;
  const c = await data();

  // Tenant scoping. This query read `WHERE id = ? AND role = 'member'` with no
  // tenant predicate, so a clinician with any member's id could open their
  // measures, screenings, check-ins and session history across tenants — and
  // the access was audited under their name, which makes it look sanctioned.
  //
  // §30.6 step 1 resolves the acting tenant before anything else, and §20.3
  // requires a cross-tenant request to return no record detail. notFound rather
  // than forbidden: a 403 confirms the record exists.
  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? "";

  const member = (await c.get(
    "SELECT id, name, email, created_at FROM users WHERE id = ? AND tenant_id = ? AND role = 'member'",
    [id, tenantId]
  )) as { id: string; name: string; email: string; created_at: string } | undefined;
  if (!member) notFound();

  const person = await loadPersonHeader({ personId: id, clinicianId: clinician.id, tenantId });
  if (!person) notFound();

  // Record-access events belong in the audit trail too.
  await audit({
    actorId: clinician.id,
    actorRole: "clinician",
    family: "security",
    type: "member_record_viewed",
    target: member.id,
  });

  const screenings = await c.all("SELECT instrument, total_score, answers_json, risk_flags_json, created_at FROM screenings WHERE user_id = ? ORDER BY created_at DESC", [id]) as {
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
      ...scoreItq(JSON.parse(decryptField(s.answers_json))),
    }));

  const checkins = await c.all("SELECT * FROM checkins WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 14", [id]) as {
    checkin_date: string;
    activation: number;
    shutdown: number;
    dissociation: number;
    sleep_quality: number;
    recommended_action: string;
  }[];

  const sessions = await c.all("SELECT * FROM therapy_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 20", [id]) as {
    id: string;
    module_id: string;
    status: string;
    pre_suds: number | null;
    post_suds: number | null;
    peak_suds: number | null;
    hard_stop_reason: string | null;
    started_at: string;
  }[];

  const unlocks = await c.all("SELECT * FROM module_unlocks WHERE user_id = ? ORDER BY requested_at DESC", [id]) as {
    module_id: string;
    status: string;
    decision_reason: string | null;
    override: number;
    requested_at: string;
    decided_at: string | null;
  }[];

  const consents = await c.all("SELECT policy_version, scope, granted_at, revoked_at FROM consents WHERE user_id = ?", [id]) as { policy_version: string; scope: string; granted_at: string; revoked_at: string | null }[];

  const moduleName = (mid: string) => MODULES.find((m) => m.id === mid)?.name ?? mid;
  const planRow = await getProgramPlan(member.id);

  // Latest unlock row per module (unlocks are ordered newest-first), so the
  // specialist controls show current access state.
  const unlockByModule = new Map<string, (typeof unlocks)[number]>();
  for (const u of unlocks) if (!unlockByModule.has(u.module_id)) unlockByModule.set(u.module_id, u);
  const gatedModules = MODULES.filter((m) => m.tier === "gated");

  return (
    <PersonShell person={person} active="/measures">
      {/* §26: "Review validated change — instrument-specific chart — open
          answers." The page example leads with the change in words — "PHQ-9
          increased 5 points in 14 days. Review due today." — before any chart,
          for the same reason the member's Progress screen does: a number
          arriving bare is a number the reader has to interpret, and two readers
          will interpret it differently.

          The programme plan used to render here too. It now lives on the plan
          tab: two copies of a model-drafted plan is two places for its review
          status to disagree. */}
      {/* The email used to render here. §27.2: "Use minimum-necessary display
          identity. Legal identity stays out of routine views unless required."
          A measures review does not need contact details, and the shell above
          already says who this is. */}
      <p className="text-sm text-olive">In the programme since {member.created_at.slice(0, 10)}</p>

      {(pcl5Series.length > 0 || itqSeries.length > 0) && (
        <section className="mt-8">
          <h2 className="type-display text-2xl font-medium">Outcome trends</h2>
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
        <h2 className="type-display text-2xl font-medium">Screenings</h2>
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
                  s.instrument === "itq" ? scoreItq(JSON.parse(decryptField(s.answers_json))) : null;
                return (
                  <tr key={i} className="border-t border-ground/10">
                    <td className="px-4 py-2 font-medium">{s.instrument}</td>
                    <td className="px-4 py-2">
                      {itq
                        ? `PTSD ${itq.ptsdSum}/24 · DSO ${itq.dsoSum}/24 — ${itq.label}`
                        : s.total_score}
                    </td>
                    <td className="px-4 py-2 text-state-support">{flags.join(", ") || "—"}</td>
                    <td className="px-4 py-2">{s.created_at}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="type-display text-2xl font-medium">Check-ins (last 14)</h2>
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
        <h2 className="type-display text-2xl font-medium">Sessions (last 20)</h2>
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
                          ? "font-semibold text-state-support"
                          : s.status === "completed"
                            ? "text-state-safe"
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

      <section className="mt-8">
        <h2 className="type-display text-2xl font-medium">Module access</h2>
        <p className="mt-1 text-sm text-olive">
          Open a gated module ahead of the program&apos;s pacing when your review supports it. An
          override relaxes prerequisites and the readiness track only — the daily check-in,
          cooldown, and cap safety gates still apply, and the member still moves through today&apos;s
          check-in. A reason is required and recorded.
        </p>
        <div className="mt-3 space-y-3">
          {gatedModules.map((mod) => {
            const u = unlockByModule.get(mod.id);
            const open = u?.status === "unlocked";
            const isOverride = open && u?.override === 1;
            return (
              <div key={mod.id} className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{mod.name}</p>
                    <p className="text-xs text-olive">
                      {open
                        ? isOverride
                          ? "Open by your override"
                          : "Unlocked"
                        : u?.status === "requested"
                          ? "Member has requested this"
                          : u?.status === "denied"
                            ? "Previously declined"
                            : "Not open"}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      open ? "bg-state-safe-bg/60 text-state-safe" : "bg-sand/50 text-olive"
                    }`}
                  >
                    {open ? "Open" : "Closed"}
                  </span>
                </div>
                {open ? (
                  <form action={clinicianCloseModule} className="mt-3 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="memberId" value={member.id} />
                    <input type="hidden" name="moduleId" value={mod.id} />
                    <input
                      type="text"
                      name="reason"
                      required
                      placeholder="Reason for closing (recorded)"
                      className="min-w-64 flex-1 rounded-2xl border border-ground/15 bg-ivory px-4 py-2 text-sm focus:border-sage focus:outline-none"
                    />
                    <button className="rounded-full border border-state-support/40 px-5 py-2 text-sm font-medium text-state-support transition-colors hover:bg-state-support hover:text-white">
                      Close module
                    </button>
                  </form>
                ) : (
                  <form action={clinicianOpenModule} className="mt-3 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="memberId" value={member.id} />
                    <input type="hidden" name="moduleId" value={mod.id} />
                    <input
                      type="text"
                      name="reason"
                      required
                      placeholder="Clinical reason for opening early (recorded)"
                      className="min-w-64 flex-1 rounded-2xl border border-ground/15 bg-ivory px-4 py-2 text-sm focus:border-sage focus:outline-none"
                    />
                    <button className="rounded-full border border-ground px-5 py-2 text-sm font-medium transition-colors hover:bg-ground hover:text-ivory">
                      Open module
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="type-display text-2xl font-medium">Unlock history</h2>
          <div className="mt-2 space-y-2">
            {unlocks.length === 0 && <p className="text-sm text-olive">None.</p>}
            {unlocks.map((u, i) => (
              <div key={i} className="rounded-3xl border border-ground/10 bg-linen p-4 text-sm shadow-soft">
                <p className="font-medium">
                  {moduleName(u.module_id)} — {u.status}
                </p>
                {u.decision_reason && <p className="text-olive">Reason: {u.decision_reason}</p>}
                <p className="text-xs text-olive">
                  requested {u.requested_at}
                  {u.decided_at ? ` · decided ${u.decided_at}` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2 className="type-display text-2xl font-medium">Consent ledger</h2>
          <div className="mt-2 space-y-2">
            {consents.map((c, i) => (
              <div key={i} className="rounded-3xl border border-ground/10 bg-linen p-4 text-sm shadow-soft">
                <p className="font-medium">
                  {c.policy_version} · {c.scope}
                </p>
                <p className="text-xs text-olive">
                  granted {c.granted_at}
                  {c.revoked_at ? ` · revoked ${c.revoked_at}` : " · active"}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </PersonShell>
  );
}
