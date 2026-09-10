import Link from "next/link";
import { ReviewPage } from "@/components/clinical/ReviewPage";
import { Panel, Note, WithNote, Callout } from "@/components/app/surfaces";
import { requireReviewAccess } from "@/lib/auth";
import {
  traceableStatements, traceStatement, PIPELINE_STAGES,
  type LineageState, type LineageTrace,
} from "@/lib/clinical/lineage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lineage — Steady Review" };

// Lineage (§26 p44: "/review/lineage — Trace screen statement to source —
// lineage_trace.v4 — replay; inspect; correct — complete, gap, superseded —
// immutable events; corrections append").
//
// The reviewer picks a sentence this product would show someone, and the
// screen walks it back through §30.1's pipeline until it either reaches a
// recorded event or runs out of things to read.
//
// NOTHING HERE IS DRAWN FROM THE ARCHITECTURE. The five stages come from the
// diagram, but whether each one resolved for THIS statement is a query. A
// lineage screen that renders five boxes with ticks has told the reviewer what
// the diagram already told them, and would keep saying it after the ledger
// stopped being written.
//
// The screen is therefore expected to show gaps, and does. In this environment
// most seeded history was reconstructed from the current-state rows by genesis
// backfill — those rows are not derived from their events, their events are
// derived from them — and saying so is the single most useful thing this page
// can tell somebody deciding how much of the demo's history to believe.

const STATE_COPY: Record<LineageState, { word: string; glyph: string; tone: "safe" | "caution" | "info"; meaning: string }> = {
  complete: {
    word: "Complete",
    glyph: "◆",
    tone: "safe",
    meaning: "Every stage resolved, and the events behind it were recorded when the thing happened.",
  },
  gap: {
    word: "Gap",
    glyph: "▲",
    tone: "caution",
    meaning: "A stage has no source. The statement is still true of the row it was read from — what is missing is the record of where the row came from.",
  },
  superseded: {
    word: "Superseded",
    glyph: "○",
    tone: "info",
    meaning: "A correction was appended over one of the source events. Both are below: corrections append and supersede, they never erase.",
  },
};

function Trace({ trace }: { trace: LineageTrace }) {
  const state = STATE_COPY[trace.state];
  return (
    <>
      <WithNote
        note={
          <Note
            tone={state.tone}
            title={`${state.glyph} ${state.word}`}
            boundary="A complete trace says the statement rests on recorded events. It does not say the events are accurate, or that the person they describe agrees with them."
          >
            <p>{state.meaning}</p>
          </Note>
        }
      >
        <Panel
          title="The statement"
          footnote={`Read from the ${trace.table} row ${trace.rowId}.`}
        >
          <p className="measure text-base text-app-ink">{trace.statement}</p>
          <p className="mt-3 text-sm">
            <Link href={trace.screen.href} className="text-state-info underline">
              Shown on {trace.screen.label}
            </Link>
          </p>
        </Panel>
      </WithNote>

      <Panel
        title="Back through the pipeline"
        className="mt-6"
        footnote="Read downward: each row is one stage of the write path, walked in reverse from the screen to the thing that happened."
      >
        <ol className="space-y-0">
          {trace.steps.map((s, i) => (
            <li
              key={s.stage}
              className={`grid gap-1 py-3 sm:grid-cols-[13rem_1fr] sm:gap-4 ${
                i > 0 ? "border-t border-ground/5" : ""
              }`}
            >
              <div>
                <span className="text-sm font-medium text-app-ink">{s.stage}</span>
                <span className="mt-0.5 block text-xs text-olive">{s.role}</span>
              </div>
              <div>
                <span
                  className={`text-sm font-medium ${
                    s.resolved ? "text-state-safe" : s.notApplicable ? "text-olive" : "text-state-caution"
                  }`}
                >
                  <span aria-hidden>{s.resolved ? "◆" : s.notApplicable ? "–" : "▲"}</span>{" "}
                  {s.resolved ? "resolved" : s.notApplicable ? "does not apply" : "gap"}
                </span>
                <p className="measure mt-0.5 text-sm text-ground">{s.found || s.gap}</p>
                {s.version && (
                  <p className="mt-0.5 font-mono text-xs text-olive">{s.version}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel
        title="The events themselves"
        className="mt-6"
        footnote="Append order. An event marked reconstructed was written from the row by genesis backfill rather than recorded when the thing happened."
      >
        {trace.events.length === 0 ? (
          <p className="measure text-sm text-ground">
            None. No event in the ledger names this row, so there is nothing here to show —
            which is the finding, not an empty state.
          </p>
        ) : (
          <ul className="divide-y divide-ground/5">
            {trace.events.map((e) => (
              <li key={e.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-sm font-medium text-app-ink">{e.type}</span>
                  <span className="font-mono text-xs text-olive">{e.id}</span>
                </div>
                <p className="mt-1 text-xs text-olive">
                  Occurred {e.occurredAt} · recorded {e.recordedAt} · {e.actorType} · via{" "}
                  {e.sourceSystem}
                </p>
                {e.reconstructed && (
                  <p className="mt-1 text-xs text-state-caution">
                    <span aria-hidden>▲</span> Reconstructed from the row it supports.
                  </p>
                )}
                {e.supersededBy && (
                  <p className="mt-1 text-xs text-state-info">
                    <span aria-hidden>○</span> Corrected by {e.supersededBy}. This event stays
                    in the ledger.
                  </p>
                )}
                {e.supersedes && (
                  <p className="mt-1 text-xs text-state-info">
                    <span aria-hidden>○</span> Corrects {e.supersedes}.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

export default async function ReviewLineagePage({
  searchParams,
}: {
  searchParams: Promise<{ statement?: string }>;
}) {
  await requireReviewAccess();
  const { statement } = await searchParams;
  const [candidates, trace] = await Promise.all([
    traceableStatements({ limit: 18 }),
    statement ? traceStatement(statement) : Promise.resolve(null),
  ]);

  return (
    <ReviewPage
      layer="audit"
      here="/review/lineage"
      title="Lineage"
      lede="Pick something this product would say about a person, and see whether it can be walked back to an event that was recorded when it happened."
    >
      {statement && !trace && (
        <Callout tone="caution" label="No such statement">
          <p className="measure">
            Nothing was read for <span className="font-mono text-xs">{statement}</span>. Either
            the row is gone or the address is wrong. Pick one from the list below.
          </p>
        </Callout>
      )}

      {trace && <Trace trace={trace} />}

      <Panel
        title={trace ? "Trace something else" : "Pick a statement"}
        className={trace ? "mt-6" : ""}
        footnote={`Read from the live tables, newest first — these are sentences the product would show, not examples. The traceable set is exactly what the projection layer builds: ${PIPELINE_STAGES.length} stages, and a row is traceable only if some projector writes it.`}
      >
        <ul className="divide-y divide-ground/5">
          {candidates.map((s) => (
            <li key={s.id}>
              <Link
                href={`/review/lineage?statement=${encodeURIComponent(s.id)}`}
                aria-current={s.id === statement ? "true" : undefined}
                className={`block rounded-xl px-3 py-2.5 transition-colors hover:bg-app-accent/40 ${
                  s.id === statement ? "bg-app-accent" : ""
                }`}
              >
                <span className="measure block text-sm text-app-ink">{s.statement}</span>
                <span className="mt-0.5 block text-xs text-olive">
                  {s.personLabel} · {s.table} · {s.at}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="What a correction does here" className="mt-6">
        <p className="measure text-sm text-ground">
          Nothing on this screen edits anything. A correction in Steady is an appended event
          that names the one it supersedes, and both stay readable afterwards — which is why a
          corrected statement traces to two events rather than to a changed one.
        </p>
        <p className="measure mt-3 text-sm text-olive">
          There is no button here to make that correction. The screens that write one are the
          member&rsquo;s own record correction and the clinician&rsquo;s review, because a
          correction needs somebody accountable for it, and a reviewer reading lineage is not
          that person.
        </p>
      </Panel>
    </ReviewPage>
  );
}
