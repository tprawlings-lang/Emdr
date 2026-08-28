import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { getModule } from "@/lib/modules";
import { loadPersonHeader } from "@/lib/clinical/person-header";
import { PersonShell } from "@/components/clinical/PersonShell";
import { relativeAge } from "@/components/clinical/primitives";

export const dynamic = "force-dynamic";

// Session detail (§26: "Understand state and response — human-readable event
// sequence — Sign or correct"; page example "Session Response").
//
// "Human-readable event sequence" is the whole instruction. The raw row holds
// pre/post/peak distress and a status enum; a clinician needs what happened, in
// order, in sentences.
//
// The page example pairs "activation before and after each session" with a
// "clinical reading". The reading here is deliberately thin: it states the
// direction and refuses to interpret it. A session where distress rose is not
// a failed session, and a screen that implies it is will push clinicians toward
// the sessions that look good.

export default async function SessionDetailPage({
  params,
}: { params: Promise<{ id: string; sid: string }> }) {
  const { id, sid } = await params;
  const clinician = await requireClinician();
  const c = await data();
  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? "";

  const person = await loadPersonHeader({ personId: id, clinicianId: clinician.id, tenantId });
  if (!person) notFound();

  // Scoped to the person as well as the id: a session id from another record
  // must not resolve here.
  const s = (await c.get(
    `SELECT id, module_id, status, pre_suds, post_suds, peak_suds, hard_stop_reason,
            started_at, ended_at
       FROM therapy_sessions WHERE id = ? AND user_id = ?`,
    [sid, id]
  )) as {
    id: string; module_id: string; status: string;
    pre_suds: number | null; post_suds: number | null; peak_suds: number | null;
    hard_stop_reason: string | null; started_at: string; ended_at: string | null;
  } | undefined;
  if (!s) notFound();

  // The sequence, assembled from what is on the row. Each entry is a fact with
  // a time; nothing is inferred to fill a gap.
  const sequence: Array<{ at: string; text: string }> = [
    { at: s.started_at, text: `Session started — ${getModule(s.module_id)?.name ?? s.module_id}` },
  ];
  if (s.pre_suds !== null) {
    sequence.push({ at: s.started_at, text: `Distress before: ${s.pre_suds} of 10` });
  }
  if (s.peak_suds !== null) {
    sequence.push({ at: s.started_at, text: `Highest during the session: ${s.peak_suds} of 10` });
  }
  if (s.hard_stop_reason) {
    sequence.push({
      at: s.ended_at ?? s.started_at,
      text: `Fixed rule ended the session — ${s.hard_stop_reason}. No model made or cleared this.`,
    });
  }
  if (s.post_suds !== null) {
    sequence.push({ at: s.ended_at ?? s.started_at, text: `Distress after: ${s.post_suds} of 10` });
  }
  if (s.ended_at) sequence.push({ at: s.ended_at, text: "Session ended" });

  const delta = s.pre_suds !== null && s.post_suds !== null ? s.post_suds - s.pre_suds : null;

  return (
    <PersonShell person={person} active="/sessions">
      <p className="text-sm">
        <Link href={`/clinician/member/${id}/sessions`} className="text-state-info underline">
          ← All sessions
        </Link>
      </p>

      <h2 className="type-display mt-3 text-xl font-medium text-ground">
        {getModule(s.module_id)?.name ?? s.module_id}
      </h2>
      <p className="text-sm text-olive">
        {s.started_at.slice(0, 16)} · {relativeAge(s.started_at, person.now)} ago
      </p>

      <section aria-labelledby="reading" className="mt-5 rounded-3xl border border-ground/10 bg-linen p-5">
        <h3 id="reading" className="text-xs font-semibold uppercase tracking-wide text-olive">
          Clinical reading
        </h3>
        {delta === null ? (
          <p className="mt-1 text-ground/90">
            Distress was not recorded on both sides of this session, so there is no
            before-and-after to read. That is a missing measurement, not a zero change.
          </p>
        ) : (
          <p className="mt-1 text-ground/90">
            Distress moved from {s.pre_suds} to {s.post_suds} ({delta > 0 ? "+" : ""}{delta}).{" "}
            {/* States the direction and stops. Interpretation is the
                clinician's job, and a session where distress rose is not a
                failed session. */}
            One session is a data point, not a trend.
          </p>
        )}
      </section>

      <section aria-labelledby="sequence" className="mt-5">
        <h3 id="sequence" className="text-xs font-semibold uppercase tracking-wide text-olive">
          What happened
        </h3>
        <ol className="mt-3 space-y-2">
          {sequence.map((e, i) => (
            <li key={i} className="flex gap-3 rounded-2xl border border-ground/10 bg-linen px-4 py-2.5">
              <span className="shrink-0 font-mono text-xs text-olive">{e.at.slice(11, 16)}</span>
              <span className="text-sm text-ground/90">{e.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <p className="mt-6 text-sm">
        <Link href={`/clinician/member/${id}/record`} className="text-state-info underline">
          Sign or correct this in the full record
        </Link>
      </p>
    </PersonShell>
  );
}
