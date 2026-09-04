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
import { ClinicalFigure, SmallMultiples } from "@/components/charts/clinical";
import { EVERYDAY_FUNCTION } from "@/lib/measures/house";
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

  // EVERY validated instrument on file, not the two that happened to have a
  // chart. PHQ-9 is the repeated outcome measure across this programme, and it
  // was reaching the screen only as a row in the table below — so a person
  // whose whole outcome series is PHQ-9 had an "Outcome trends" section that
  // drew nothing, or drew a single intake dot from an instrument taken once.
  const INSTRUMENTS: {
    id: string; label: string; unit: string; max: number; lowerIsBetter: boolean;
    disclosure?: string;
  }[] = [
    { id: "phq-9", label: "PHQ-9", unit: "total, 0–27", max: 27, lowerIsBetter: true },
    { id: "gad-7", label: "GAD-7", unit: "total, 0–21", max: 21, lowerIsBetter: true },
    { id: "pcl-5", label: "PCL-5", unit: "total, 0–80", max: 80, lowerIsBetter: true },
    // THE HOUSE MEASURE, last and labelled. It is drawn in the same frame as
    // the three above, which is exactly why it carries its disclosure: a panel
    // beside PHQ-9 borrows PHQ-9's authority, and this one has none to borrow.
    // It also runs the other way — higher is better — so an unlabelled reader
    // would take its rise for a decline.
    {
      id: EVERYDAY_FUNCTION.id,
      label: EVERYDAY_FUNCTION.title,
      unit: `total, 0–${EVERYDAY_FUNCTION.max}`,
      max: EVERYDAY_FUNCTION.max,
      lowerIsBetter: false,
      disclosure: EVERYDAY_FUNCTION.disclosure,
    },
  ];
  const measureSeries = INSTRUMENTS.map((i) => ({
    label: i.label,
    unit: i.unit,
    max: i.max,
    lowerIsBetter: i.lowerIsBetter,
    disclosure: i.disclosure,
    points: screenings
      .filter((s) => s.instrument === i.id)
      .map((s) => ({ date: s.created_at.slice(0, 10), value: s.total_score }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  })).filter((m) => m.points.length > 0);

  // The shared window: the whole span of readings on file, so every panel is
  // drawn against the same dates.
  // Whether anything has been repeated at all. Everything the figure claims —
  // its title, its summary, its footnote — turns on this, because a record with
  // no repeated instrument has no trend and should not be framed as having one.
  const anyTrend = measureSeries.some((m) => m.points.length > 1);
  const allDates = measureSeries.flatMap((m) => m.points.map((p) => p.date)).sort();
  const windowFrom = allDates[0] ?? member.created_at.slice(0, 10);
  const windowTo = allDates[allDates.length - 1] ?? windowFrom;

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

  // EVERY plan version, not only the current one. `program_plans` is
  // append-only — a revision is a new row — so the history is already there,
  // and it is what the plan-response half of the progress view annotates
  // against. Dates only: the plan's CONTENT belongs on the plan tab, and
  // putting it on the chart would turn a mark into an argument.
  const planVersions = (await c.all(
    `SELECT created_at FROM program_plans WHERE user_id = ? ORDER BY created_at`,
    [member.id],
  )) as { created_at: string }[];
  const planMarks = planVersions.map((v, i) => ({
    date: v.created_at.slice(0, 10),
    label: i === 0 ? "Plan written" : `Plan revised (version ${i + 1})`,
  }));

  // Latest unlock row per module (unlocks are ordered newest-first), so the
  // specialist controls show current access state.
  const unlockByModule = new Map<string, (typeof unlocks)[number]>();
  for (const u of unlocks) if (!unlockByModule.has(u.module_id)) unlockByModule.set(u.module_id, u);
  const gatedModules = MODULES.filter((m) => m.tier === "gated");

  return (
    <PersonShell person={person} active="/measures" title="Measure history">
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

      {measureSeries.length > 0 && (
        <section className="mt-8">
          {/* The heading follows the data. "Outcome trends" over a record where
              every instrument was taken once promises a reading the page cannot
              give, and that is the majority of records here. */}
          <h2 className="type-display text-2xl font-medium">
            {anyTrend ? "Outcome trends" : "Measures on file"}
          </h2>
          {/* ALIGNED SMALL MULTIPLES, one panel per instrument on one shared
              date axis.

              This was a two-column grid of independent charts, each of which
              placed a reading by its INDEX in its own series. Two instruments
              measured on different days therefore put the same date in
              different places, and a series of three readings stretched across
              the same width as one of twelve — so reading across the panels,
              which is the only thing small multiples are for, compared
              positions that meant nothing. A three-month gap also drew exactly
              as wide as a one-week gap, which turns an absence of data into a
              smooth decline.

              Scales stay separate: a PHQ-9 and a PCL-5 do not share a y axis. */}
          <div className="mt-3 rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
            <ClinicalFigure
              title={anyTrend ? "Validated measures over time" : "Validated measures on file"}
              summary={
                anyTrend
                  ? `${measureSeries.length} instrument${measureSeries.length === 1 ? "" : "s"} on file, each on its own scale and all on one date axis from ${windowFrom} to ${windowTo}.`
                  // A record where nothing has been repeated has no trend to
                  // show, and a figure titled "over time" spanning one day
                  // promises one. Most records here are in this state.
                  : `${measureSeries.length} instrument${measureSeries.length === 1 ? "" : "s"} on file, each taken once. Nothing has been repeated yet, so there is no change to read.`
              }
              footnote={`${anyTrend ? "Readings taken, joined in order — no fitted line and no value between two readings. Each panel is scaled to its own instrument, so the panels are read down the dates rather than across the heights." : "Each panel is scaled to its instrument's full range. A single reading is shown as a number rather than plotted, because one point is not a trend."}${
                planMarks.length > 0 ? ` ${planMarks.length} plan version${planMarks.length === 1 ? "" : "s"} on record.` : ""
              }`}
            >
              <SmallMultiples
                series={measureSeries}
                from={windowFrom}
                to={windowTo}
                annotations={planMarks.filter((m) => m.date >= windowFrom && m.date <= windowTo)}
              />
            </ClinicalFigure>
          </div>
          {itqSeries.length > 0 && (
            <p className="mt-3 text-sm text-olive">
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
