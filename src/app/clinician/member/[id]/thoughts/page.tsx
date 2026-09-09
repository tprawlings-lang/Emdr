import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import { audit } from "@/lib/audit";
import { loadPersonHeader } from "@/lib/clinical/person-header";
import { PersonShell } from "@/components/clinical/PersonShell";
import { Panel, Note, WithNote, Callout } from "@/components/app/surfaces";
import { ThoughtsWorkspace } from "@/components/clinical/ThoughtsWorkspace";
import { thoughtsSurfaceAvailable } from "@/lib/clinical/thoughts-flags";
import { AskSteady } from "@/components/clinical/AskSteady";
import {
  listThoughts, transcriptVersions, sessionForPerson,
} from "@/lib/clinical/thought-store";
import { itemsByIds, approvedMemory } from "@/lib/clinical/memory-store";
import { labelsFor, readableDay } from "@/lib/clinical/session-label";
import { ClinicalMemoryPanel } from "@/components/clinical/ClinicalMemoryPanel";
import { loadThoughtForReview } from "@/lib/clinical/thought-review-load";
import { listThreads, membershipsForPerson, buildTimelines } from "@/lib/clinical/thread-store";
import { scoreThread } from "@/lib/clinical/thread-match";
import { ThreadSuggestions } from "@/components/clinical/ThreadSuggestions";
import { ThreadTimeline } from "@/components/clinical/ThreadTimeline";
import type { TenantContext } from "@/lib/repository";

export const dynamic = "force-dynamic";

// Thoughts (§17.2, and §20's file map: "NEW. Thought history, source
// drill-down, capture/review launcher").
//
// It lives inside the person record rather than in a clinician app of its own,
// per §2's repository note — "Record Thoughts belongs inside the existing person
// workspace, not a stand-alone clinician app" — and Appendix B's reminder that
// the member page already follows a first-thirty-seconds design this should sit
// inside rather than beside.
//
// THE FLAG IS CHECKED HERE AND IN EVERY ACTION. §22: a disabled downstream
// surface must not appear just because data for it exists. A page that renders
// a recorder while the actions refuse it is worse than one that says the
// feature is off — the clinician speaks for ninety seconds and finds out
// afterwards.

// The threads view, built outside the component (Phase 3).
//
// Outside for two reasons. It reads the clock — recency is part of §10's score
// — and a clock read in a component body is the impure render the lint rule
// exists to catch; the same shape as `buildInputs` in the autonomous review
// page. And it reads ONCE for the whole surface: pending suggestions, refused
// ones, and the accepted members of every theme all come from the same two
// tables, so a component fetching its own would turn one page render into a
// query per theme.
async function buildThreadView(
  memberships: Awaited<ReturnType<typeof membershipsForPerson>>,
  threads: Awaited<ReturnType<typeof listThreads>>,
  loadItems: (ids: string[]) => Promise<Awaited<ReturnType<typeof itemsByIds>>>,
) {
  // One instant for the whole render. Scoring two suggestions against two
  // different clocks makes them very slightly incomparable, for no reason.
  const scoredAt = Date.now();
  const items = await loadItems(memberships.map((m) => m.memoryItemId));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const threadById = new Map(threads.map((t) => [t.id, t]));

  const asSuggestion = (m: (typeof memberships)[number]) => {
    const item = itemById.get(m.memoryItemId);
    const thread = threadById.get(m.threadId);
    if (!item || !thread) return null;
    // Recomputed with the same scorer the matcher used, so what the clinician
    // reads is why it was actually offered — a reason written separately would
    // drift from the thing that produced the suggestion.
    const { because } = scoreThread(item, thread, scoredAt);
    return {
      membershipId: m.id,
      threadLabel: thread.canonicalLabel,
      threadType: thread.threadType,
      itemText: item.displayText,
      itemStatementClass: item.statementClass,
      because,
      status: m.status as "proposed" | "rejected",
    };
  };
  // Accepts undefined too: `.map()` over a Map lookup yields `T | undefined`,
  // and a guard that only narrowed null would leave the undefined in the type.
  const keep = <T,>(x: T | null | undefined): x is T => !!x;

  // Which themes each item is already filed under, so the memory panel does not
  // offer to file something where it already is.
  const labelsByItem = new Map<string, string[]>();
  for (const m of memberships) {
    if (m.status !== "accepted") continue;
    const thread = threadById.get(m.threadId);
    if (!thread) continue;
    labelsByItem.set(m.memoryItemId, [...(labelsByItem.get(m.memoryItemId) ?? []), thread.canonicalLabel]);
  }

  return {
    labelsByItem,
    threadLabels: threads.map((t) => t.canonicalLabel),
    pending: memberships.filter((m) => m.status === "proposed").map(asSuggestion).filter(keep),
    refused: memberships.filter((m) => m.status === "rejected").map(asSuggestion).filter(keep),
    // One implementation of "which items are on this thread, in what order",
    // shared with the tests rather than reimplemented here.
    timelines: buildTimelines(threads, memberships, items).map((t) => ({
      threadId: t.thread.id,
      label: t.thread.canonicalLabel,
      threadType: t.thread.threadType,
      entries: t.entries.map(({ item: i }) => ({
        itemId: i.id,
        displayText: i.displayText,
        statementClass: i.statementClass,
        itemType: i.itemType,
        thoughtId: i.sourceThoughtId,
        createdAt: i.createdAt,
      })),
    })),
  };
}

export default async function MemberThoughtsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const clinician = await requireClinician();
  const { id } = await params;
  const c = await data();

  // The acting tenant, from the clinician's own record. notFound rather than
  // forbidden for a member outside it: a 403 confirms the record exists.
  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? PLATFORM_TENANT_ID;

  const member = (await c.get(
    "SELECT id, name FROM users WHERE id = ? AND tenant_id = ? AND role = 'member'",
    [id, tenantId]
  )) as { id: string; name: string } | undefined;
  if (!member) notFound();

  const ctx: TenantContext = { tenantId, personId: clinician.id };
  const header = await loadPersonHeader({ personId: id, clinicianId: clinician.id, tenantId });
  if (!header) notFound();

  const available = thoughtsSurfaceAvailable("CLINICIAN_THOUGHTS_CAPTURE");
  const threadsAvailable = thoughtsSurfaceAvailable("CLINICIAN_THREADS");
  const extractionAvailable = thoughtsSurfaceAvailable("CLINICIAN_THOUGHTS_EXTRACTION");
  const askAvailable = thoughtsSurfaceAvailable("CLINICIAN_PATIENT_ASK");
  const thoughts = available ? await listThoughts(ctx, id) : [];

  const threadView = threadsAvailable
    ? buildThreadView(
        await membershipsForPerson(ctx, id),
        await listThreads(ctx, id, "active"),
        (ms) => itemsByIds(ctx, ms),
      )
    : Promise.resolve({
        labelsByItem: new Map<string, string[]>(), threadLabels: [] as string[],
        pending: [], refused: [], timelines: [],
      });
  const { labelsByItem, threadLabels, pending, refused, timelines } = await threadView;

  // The kept items — §5's layer 2, and the thing Phase 2 produces. Read here
  // rather than inside the panel so the page makes exactly one pass over this
  // person's memory for both the panel and the themes above it.
  const keptItems = extractionAvailable
    ? (await approvedMemory(ctx, id)).map((i) => ({
        id: i.id,
        displayText: i.displayText,
        statementClass: i.statementClass,
        itemType: i.itemType,
        normalizedLabel: i.normalizedLabel,
        approvedAt: i.approvedAt,
        sourceThoughtId: i.sourceThoughtId,
        threadLabels: labelsByItem.get(i.id) ?? [],
        supersedesId: i.supersedesId,
      }))
    : [];

  // Counted up front rather than inside the row: a query per rendered row is
  // how a list that is fine at five thoughts is unusable at two hundred.
  const versionCounts = new Map(
    await Promise.all(
      thoughts.map(async (t) => [t.id, (await transcriptVersions(ctx, t.id)).length] as const)
    )
  );

  // Which session each note came from, where it names one.
  //
  // RESOLVED FROM THE PERSON'S OWN RECORD, so a stored id that does not belong
  // to this person resolves to nothing rather than to a label — the same
  // predicate the write path verifies against, read back on the way out. Notes
  // written before session-linked notes existed name no session and say so
  // rather than being labelled with a guess.
  const sessionRefs = (
    await Promise.all(
      [...new Set(thoughts.map((t) => t.sourceSessionId).filter((v): v is string => !!v))].map(
        (sid) => sessionForPerson(ctx, { personId: id, sessionId: sid })
      )
    )
  ).filter((v): v is NonNullable<typeof v> => v !== null);
  const sessionLabels = labelsFor(sessionRefs);

  await audit({
    actorId: clinician.id, actorRole: "clinician", family: "clinical",
    type: "clinician_thoughts_opened", target: id,
    detail: { count: thoughts.length },
  });

  return (
    <PersonShell person={header} active="/thoughts" title="Thoughts">
      {!available ? (
        <Callout tone="info" label="Not enabled here">
          <p className="measure">
            Recording thoughts is switched off in this environment. Nothing that was recorded
            before is lost — a flag change never deletes or rewrites stored history — and this
            page will show it again when the feature is turned back on.
          </p>
        </Callout>
      ) : (
        <>
          {/* §12 asks for the query box in "the patient workspace or
              Thoughts/Threads view". It goes here, above the recorder, because
              this is where the material it searches was written — a clinician
              looking for what they wrote is already on this page, and a box on
              the record overview would search the same records from further
              away from them. */}
          {askAvailable && (
            <div className="mb-6">
              <AskSteady personId={id} />
            </div>
          )}

          <WithNote
            note={
              <Note
                tone="info"
                title="What this is for"
                owner={clinician.name}
                boundary="A thought is not a formal note. Nothing here is written into the clinical record, and nothing here is shown to the patient."
              >
                <p>
                  Say what you noticed after a session. Steady writes it down and you check what
                  it heard before anything is kept.
                </p>
              </Note>
            }
          >
            <ThoughtsWorkspace
              personId={id}
              personName={member.name}
              loadTranscript={loadThoughtForReview}
            />
          </WithNote>

          <Panel
            title="Recorded thoughts"
            className="mt-6"
            footnote="Newest first. A saved thought keeps every version of its transcript, so a correction never erases what was originally heard."
          >
            {thoughts.length === 0 ? (
              <p className="measure text-sm text-ground">
                Nothing recorded yet for {member.name}.
              </p>
            ) : (
              <ul className="divide-y divide-ground/5">
                {thoughts.map((t) => (
                  <li key={t.id} className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr] sm:gap-4">
                    <div>
                      {/* The day, not the stored stamp. This rendered
                          "2026-09-04 00:00:00" — a midnight nothing was
                          recorded at, in the same row as a human date. */}
                      <span className="text-sm text-app-ink">{readableDay(t.recordedAt)}</span>
                      <span className="mt-0.5 block text-xs text-olive">
                        {/* Word and glyph, never colour alone. */}
                        <span aria-hidden>
                          {t.status === "saved" ? "◆" : t.status === "discarded" ? "○" : "▲"}
                        </span>{" "}
                        {t.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="text-sm text-ground">
                      {t.audioDeletedAt
                        ? `Audio deleted ${t.audioDeletedAt}.`
                        : t.audioStorageKey
                          ? "Audio retained until its transcript is verified."
                          : "No audio was captured."}
                      {t.currentTranscriptId && (
                        <span className="mt-0.5 block text-xs text-olive">
                          {versionCounts.get(t.id) ?? 0} transcript version
                          {versionCounts.get(t.id) === 1 ? "" : "s"}
                        </span>
                      )}
                      {/* Which session it is about, when it is about one. A
                          note with no session says so plainly: every note
                          written before session-linked notes existed is one,
                          and labelling those with a nearby session would be a
                          guess presented as a record. */}
                      <span className="mt-0.5 block text-xs text-olive">
                        {t.sourceSessionId && sessionLabels.get(t.sourceSessionId)
                          ? `About ${sessionLabels.get(t.sourceSessionId)}`
                          : "Not attached to a session"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {extractionAvailable && (
            <Panel
              title="Kept items"
              className="mt-6"
              footnote="What you decided was true, in the form it was kept. This is the record; the transcript above is what was heard."
            >
              <ClinicalMemoryPanel
                personId={id}
                items={keptItems}
                existingThreadLabels={threadLabels}
              />
            </Panel>
          )}

          {threadsAvailable && (
            <>
              {pending.length > 0 && (
                <Panel title="Waiting on a Connect decision" className="mt-6">
                  <ThreadSuggestions suggestions={pending} rejected={refused} />
                </Panel>
              )}

              <Panel
                title="Themes on this record"
                className="mt-6"
                footnote="A theme is a name for something that keeps coming up. Every entry under it opens the thought it came from."
              >
                {timelines.length === 0 ? (
                  <p className="measure text-sm text-ground">
                    No themes yet. They appear once you connect a kept item to one.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {timelines.map((t) => (
                      <ThreadTimeline
                        key={t.threadId}
                        label={t.label}
                        threadType={t.threadType}
                        entries={t.entries}
                        personId={id}
                      />
                    ))}
                  </div>
                )}
              </Panel>
            </>
          )}

          <Panel title="Where a thought goes" className="mt-6">
            <p className="measure text-sm text-ground">
              A saved thought stays in this list, readable by people with access to this
              patient. It does not become a formal note, and a later AI draft that uses it
              still needs you to review and sign it.
            </p>
            <p className="measure mt-3 text-sm text-olive">
              Session preparation and patient-scoped questions are built in later phases.
              What this page holds — the recording, the transcript, the kept items and the
              themes they belong to — is what those phases will read from.{" "}
              <Link href="/review/audit" className="text-state-info underline">
                Every action here is in the audit trail.
              </Link>
            </p>
          </Panel>
        </>
      )}
    </PersonShell>
  );
}
