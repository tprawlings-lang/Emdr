import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { getModule } from "@/lib/modules";
import { loadPersonHeader } from "@/lib/clinical/person-header";
import { PersonShell } from "@/components/clinical/PersonShell";
import { relativeAge } from "@/components/clinical/primitives";
import { Panel } from "@/components/app/surfaces";
import { ThoughtsWorkspace } from "@/components/clinical/ThoughtsWorkspace";
import { thoughtsSurfaceAvailable } from "@/lib/clinical/thoughts-flags";
import { loadThoughtForReview } from "@/lib/clinical/thought-review-load";
import { sessionDay, sessionHeading } from "@/lib/clinical/session-label";
import {
  sessionEvents, sequenceGaps, SOURCE_LABEL,
  type PostSessionCheck,
} from "@/lib/clinical/session-detail";
import { listThoughts } from "@/lib/clinical/thought-store";
import { THOUGHT_STATUS_LABEL } from "@/lib/clinical/thoughts";
import type { TenantContext } from "@/lib/repository";

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

  // The checks written after it. A separate row with its own timestamp, and on
  // a screen called Session response arguably the response — it was not on this
  // page at all.
  const checkRows = (await c.all(
    `SELECT id, distress, oriented, safe_tonight, delayed_risk, recovery_confirmed,
            escalated, created_at
       FROM post_session_checks WHERE session_id = ? AND user_id = ?
      ORDER BY created_at ASC`,
    [sid, id]
  )) as Array<{
    id: string; distress: number; oriented: number; safe_tonight: number;
    delayed_risk: number; recovery_confirmed: number; escalated: number; created_at: string;
  }>;
  const checks: PostSessionCheck[] = checkRows.map((r) => ({
    id: r.id, distress: r.distress,
    oriented: r.oriented === 1, safeTonight: r.safe_tonight === 1,
    delayedRisk: r.delayed_risk, recoveryConfirmed: r.recovery_confirmed === 1,
    escalated: r.escalated === 1, createdAt: r.created_at,
  }));

  const row = {
    id: s.id, moduleId: s.module_id,
    moduleName: getModule(s.module_id)?.name ?? s.module_id,
    status: s.status,
    preSuds: s.pre_suds, postSuds: s.post_suds, peakSuds: s.peak_suds,
    hardStopReason: s.hard_stop_reason,
    startedAt: s.started_at, endedAt: s.ended_at,
  };
  const sequence = sessionEvents(row, checks);
  const gaps = sequenceGaps(row, checks);

  // The notes already recorded against THIS session. The page offered a
  // recorder and then linked to "all notes for <person>", which is the hunt
  // through the record the handoff asks this screen to end: a clinician could
  // attach a note here and had no way to see the ones already attached.
  const ctx: TenantContext = { tenantId, personId: clinician.id };
  const attached = (await listThoughts(ctx, id).catch(() => []))
    .filter((t) => t.sourceSessionId === s.id);

  const delta = s.pre_suds !== null && s.post_suds !== null ? s.post_suds - s.pre_suds : null;

  // The session this note will be attached to.
  //
  // WHY THE CONTROL IS HERE AND NOT ONLY ON THE THOUGHTS PAGE. The note-taking
  // pipeline has worked since Phase 0 and `clinician_thoughts.source_session_id`
  // has existed just as long — and nothing ever set it, because every entry
  // point was a screen about a PERSON. So Session Prep put the newest note
  // under its "Last session" heading whatever session it concerned, and a note
  // written three sessions ago read as a note about last time. The fix is not a
  // field; it is an entry point that knows which session it is on.
  //
  // §26's session-response screen is that entry point: a clinician reading what
  // happened in a session is exactly the person with something to say about it,
  // and the id is already in the route.
  const notesAvailable = thoughtsSurfaceAvailable("CLINICIAN_THOUGHTS_CAPTURE");
  const sessionRef = { id: s.id, moduleId: s.module_id, startedAt: s.started_at };

  return (
    <PersonShell person={person} active="/sessions" title="Session response">
      <p className="text-sm">
        <Link href={`/clinician/member/${id}/sessions`} className="text-state-info underline">
          ← All sessions
        </Link>
      </p>

      <h2 className="type-display mt-3 text-xl font-medium text-ground">
        {getModule(s.module_id)?.name ?? s.module_id}
      </h2>
      {/* One format for one session. This read "2026-06-12 15:00" directly
          above a panel saying "12 June", which is two ways of naming the same
          row on one screen. The day only — the heading above already names the
          module, and repeating it here would trade one redundancy for another. */}
      <p className="text-sm text-olive">
        {sessionDay(sessionRef)} · {relativeAge(s.started_at, person.now)} ago
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
              {/* A TIME OR AN HONEST DASH. Three of these lines have no
                  recorded time of their own and used to borrow the session's,
                  so a reader counting down this column saw the highest reading
                  happening in the first minute. */}
              <span className="shrink-0 font-mono text-xs text-olive" data-testid="event-time">
                {e.at ? e.at.slice(11, 16) : "—"}
              </span>
              <span className="text-sm text-ground/90">
                {e.text}{" "}
                <span className="text-xs text-olive" data-testid="event-source">
                  ({SOURCE_LABEL[e.source]})
                </span>
              </span>
            </li>
          ))}
        </ol>
        {gaps.length > 0 && (
          <ul className="mt-3 space-y-1">
            {gaps.map((g, i) => (
              <li key={i} className="measure text-xs text-olive">{g}</li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="attached" className="mt-6">
        <h3 id="attached" className="text-xs font-semibold uppercase tracking-wide text-olive">
          Notes attached to this session
        </h3>
        {attached.length === 0 ? (
          <p className="measure mt-2 text-sm text-olive">
            Nothing has been recorded against this session yet. A note written below will name it.
          </p>
        ) : (
          <ul className="mt-2 space-y-2" data-testid="attached-notes">
            {attached.map((t) => (
              <li key={t.id} className="rounded-2xl border border-ground/10 bg-linen px-4 py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm text-ground/90">
                    {THOUGHT_STATUS_LABEL[t.status] ?? t.status}
                  </span>
                  <span className="text-xs text-olive">recorded {t.recordedAt.slice(0, 10)}</span>
                </div>
                {/* The words are NOT shown here. A thought's transcript is
                    stored encrypted and read through the workspace that can
                    show its versions and corrections; printing it flat on
                    another screen would be a second, quieter copy of clinical
                    text with none of that around it. */}
                <p className="mt-1 text-xs">
                  <Link href={`/clinician/member/${id}/thoughts`} className="text-state-info underline">
                    Open it in the notes workspace
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {notesAvailable && (
        <Panel
          title="A note about this session"
          className="mt-6"
          // NAMED TWICE ON PURPOSE AND NOT THREE TIMES. Both controls above say
          // which session they will attach to, because that is where a
          // wrong-session error gets caught. This footnote said it a third time
          // — the same defect the trajectory and load panels had — so it keeps
          // only the part the controls cannot say: what the attachment is FOR.
          footnote="Session Prep can then say which session a note came from, instead of only when you wrote it. A thought is not a formal note: nothing here is written into the clinical record and nothing here is shown to the patient."
        >
          <ThoughtsWorkspace
            personId={id}
            personName={person.name}
            sourceSession={{ id: s.id, label: sessionHeading(sessionRef) }}
            loadTranscript={loadThoughtForReview}
          />
        </Panel>
      )}

      <p className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link href={`/clinician/member/${id}/record`} className="text-state-info underline">
          Sign or correct this in the full record
        </Link>
        <Link href={`/clinician/member/${id}/thoughts`} className="text-state-info underline">
          All notes for {person.name}
        </Link>
      </p>
    </PersonShell>
  );
}
