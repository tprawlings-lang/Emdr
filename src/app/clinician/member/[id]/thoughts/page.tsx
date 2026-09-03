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
import {
  listThoughts, getThought, currentTranscript, transcriptVersions,
} from "@/lib/clinical/thought-store";
import { listItemsForThought, itemsByIds } from "@/lib/clinical/memory-store";
import { runExtraction } from "@/lib/clinical/extraction";
import { listThreads, membershipsForPerson } from "@/lib/clinical/thread-store";
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

  return {
    pending: memberships.filter((m) => m.status === "proposed").map(asSuggestion).filter(keep),
    refused: memberships.filter((m) => m.status === "rejected").map(asSuggestion).filter(keep),
    timelines: threads.map((thread) => ({
      threadId: thread.id,
      label: thread.canonicalLabel,
      threadType: thread.threadType,
      entries: memberships
        .filter((m) => m.threadId === thread.id && m.status === "accepted")
        .map((m) => itemById.get(m.memoryItemId))
        .filter(keep)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((i) => ({
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
  const thoughts = available ? await listThoughts(ctx, id) : [];

  const threadView = threadsAvailable
    ? buildThreadView(
        await membershipsForPerson(ctx, id),
        await listThreads(ctx, id, "active"),
        (ms) => itemsByIds(ctx, ms),
      )
    : Promise.resolve({ pending: [], refused: [], timelines: [] });
  const { pending, refused, timelines } = await threadView;

  // Counted up front rather than inside the row: a query per rendered row is
  // how a list that is fine at five thoughts is unusable at two hundred.
  const versionCounts = new Map(
    await Promise.all(
      thoughts.map(async (t) => [t.id, (await transcriptVersions(ctx, t.id)).length] as const)
    )
  );

  await audit({
    actorId: clinician.id, actorRole: "clinician", family: "clinical",
    type: "clinician_thoughts_opened", target: id,
    detail: { count: thoughts.length },
  });

  /** Reads one thought's current transcript for the review step.
   *
   *  A server action rather than a fetch: it re-authenticates and re-resolves
   *  the tenant on every call, so the id the browser sends is checked against
   *  the caller's own scope rather than trusted because the page rendered. */
  async function loadTranscript(thoughtId: string) {
    "use server";
    const who = await requireClinician();
    const cc = await data();
    const row = (await cc.get("SELECT tenant_id FROM users WHERE id = ?", [who.id])) as
      | { tenant_id: string } | undefined;
    const scope: TenantContext = {
      tenantId: row?.tenant_id ?? PLATFORM_TENANT_ID, personId: who.id,
    };
    const thought = await getThought(scope, thoughtId);
    if (!thought) return null;
    const t = await currentTranscript(scope, thought);
    if (!t) return null;

    // ORGANIZING HAPPENS HERE, not in the recorder. The clinician has already
    // stopped speaking and is waiting on one spinner; splitting transcription
    // and extraction into two waits would show them two, for a step they did
    // not ask for separately.
    //
    // Its failure is not this function's failure. An extractor that cannot run
    // leaves a perfectly good transcript, and returning null here would throw
    // that away and tell the clinician their recording could not be loaded —
    // which is untrue and is the one thing they are worried about.
    let candidates: Awaited<ReturnType<typeof listItemsForThought>> = [];
    if (thoughtsSurfaceAvailable("CLINICIAN_THOUGHTS_EXTRACTION")) {
      const existing = await listItemsForThought(scope, thoughtId);
      const alreadyRun = existing.length > 0;
      if (!alreadyRun && thought.status === "processing") {
        await runExtraction(scope, thoughtId);
      }
      candidates = (await listItemsForThought(scope, thoughtId)).filter((i) => i.status === "candidate");
    }

    const after = await getThought(scope, thoughtId);
    return {
      transcript: { text: t.text, hash: t.hash, version: t.version, provider: t.provider },
      transcriptOnly: after?.status === "review_transcript_only",
      candidates: candidates.map((i) => ({
        id: i.id,
        itemType: i.itemType,
        statementClass: i.statementClass,
        displayText: i.displayText,
        normalizedLabel: i.normalizedLabel,
        // The quoted span, resolved from the transcript rather than stored
        // twice. A second copy of the words is a second thing that can drift
        // from what the clinician actually said.
        quote: i.span ? t.text.slice(i.span.start, i.span.end) : null,
        numericFacts: i.numericFacts,
      })),
    };
  }

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
              loadTranscript={loadTranscript}
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
                      <span className="text-sm text-app-ink">{t.recordedAt}</span>
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
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

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
