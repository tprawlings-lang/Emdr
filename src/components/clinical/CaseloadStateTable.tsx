import Link from "next/link";
import type { CaseloadState, CaseloadStateRow } from "@/lib/clinical/caseload-state";
import {
  FUNCTION_LABEL, RESPONSE_LABEL, FUNCTION_WINDOW_DAYS,
} from "@/lib/clinical/caseload-state";
import { PriorityBadge } from "./primitives";

// The caseload clinical-state table (expansion handoff 03 §6; Phase 4).
//
// §6's columns, in §6's order: Patient, Function, Trajectory, Response,
// Load/Readiness, Last contact. And the rule the whole table is built to
// satisfy: "every label opens evidence, calculation window, limitations, and
// source dates."
//
// SO EVERY ROW EXPANDS, and what it expands to is not more numbers — it is
// where the cell came from, what window it covers, and what it cannot support.
// A table of clinical states whose cells cannot be interrogated is a table that
// teaches a clinician to trust a label, and the label is exactly the part that
// compresses hardest.
//
// NO COMPOSITE COLUMN, AND NO SORTABLE SCORE. Phase 4's definition of done is
// "caseload has no composite score", and the temptation is the sort: a table of
// four descriptive states is harder to order than a table of numbers, so a
// number appears "just for sorting" and within a month it is the thing people
// read. The sort is the caseload model's band, decided on the server (§6:
// "user filters do not rewrite server clinical priority semantics").
//
// THE UNBUILT COLUMNS SAY SO. Trajectory and Load render "Not computed" with a
// reason, never an empty cell — a blank in a trajectory column reads as flat,
// which is a clinical claim nobody made.

function StateCell({
  label, tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "settled" | "watch" | "absent";
}) {
  // Not colour alone (§19). The word is the state; the tint is decoration, and
  // the "absent" tone is deliberately the quietest so an unbuilt column does
  // not compete with a real one.
  const cls =
    tone === "settled" ? "bg-emerald-50 text-emerald-900"
    : tone === "watch" ? "bg-amber-50 text-amber-900"
    : tone === "absent" ? "text-olive"
    : "bg-app-accent/40 text-app-ink";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${cls}`}>{label}</span>
  );
}

function functionTone(row: CaseloadStateRow): "neutral" | "settled" | "watch" | "absent" {
  if (row.functionState === "not_set" || row.functionState === "no_evidence") return "absent";
  if (row.functionState === "improving") return "settled";
  if (row.functionState === "lost_ground") return "watch";
  return "neutral";
}

function responseTone(row: CaseloadStateRow): "neutral" | "settled" | "watch" | "absent" {
  if (row.responseState === "insufficient") return "absent";
  if (row.responseState === "supportive") return "settled";
  if (row.responseState === "burden") return "watch";
  return "neutral";
}

export function CaseloadStateTable({ state }: { state: CaseloadState }) {
  if (state.rows.length === 0) {
    return (
      <p className="measure mt-4 text-sm text-ground">
        Nobody matches this view right now. That is a statement about the filter, not about your
        caseload.
      </p>
    );
  }

  return (
    <div className="mt-4">
      {/* Wide content scrolls in its own container; the page body never scrolls
          sideways. */}
      <div className="overflow-x-auto rounded-3xl border border-ground/10 bg-linen">
        <table className="w-full min-w-[52rem] border-collapse text-left">
          <caption className="sr-only">
            Caseload clinical state. Each person has a separate state per column; there is no
            combined score.
          </caption>
          <thead>
            <tr className="border-b border-ground/10 text-xs uppercase tracking-wide text-olive">
              <th scope="col" className="px-4 py-3 font-medium">Person</th>
              <th scope="col" className="px-4 py-3 font-medium">Function</th>
              <th scope="col" className="px-4 py-3 font-medium">Trajectory</th>
              <th scope="col" className="px-4 py-3 font-medium">Response</th>
              <th scope="col" className="px-4 py-3 font-medium">Load</th>
              <th scope="col" className="px-4 py-3 font-medium">Last contact</th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((r) => (
              <tr key={r.personId} data-testid="caseload-state-row" className="border-b border-ground/10 last:border-b-0 align-top">
                <th scope="row" className="px-4 py-3 font-normal">
                  <div className="flex flex-wrap items-center gap-2">
                    <PriorityBadge band={r.band} />
                    <Link
                      href={`/clinician/member/${r.personId}`}
                      className="font-medium text-ground underline-offset-2 hover:underline"
                    >
                      {r.displayName}
                    </Link>
                  </div>
                </th>
                <td className="px-4 py-3">
                  <StateCell label={FUNCTION_LABEL[r.functionState]} tone={functionTone(r)} />
                </td>
                <td className="px-4 py-3">
                  <StateCell label="Not computed" tone="absent" />
                </td>
                <td className="px-4 py-3">
                  <StateCell label={RESPONSE_LABEL[r.responseState]} tone={responseTone(r)} />
                </td>
                <td className="px-4 py-3">
                  <StateCell label="Not computed" tone="absent" />
                </td>
                <td className="px-4 py-3 text-xs text-olive">
                  {/* Null is its own state. A person nobody has contacted and a
                      person contacted today must not read the same. */}
                  {r.lastContactDays === null
                    ? "None recorded"
                    : r.lastContactDays === 0
                      ? "Today"
                      : `${r.lastContactDays}d`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* §6: "every label opens evidence, calculation window, limitations, and
          source dates." One disclosure per person rather than one per cell —
          six expanders on a row is a row nobody expands. */}
      <div className="mt-4 space-y-2">
        {state.rows.map((r) => (
          <details key={r.personId} className="rounded-2xl border border-ground/10 bg-linen px-4 py-3">
            <summary className="cursor-pointer text-sm text-app-ink">
              Where {r.displayName}&rsquo;s states come from
            </summary>
            <div className="mt-3 space-y-3 text-xs text-ground">
              <div>
                <p className="font-medium text-app-ink">Function — {FUNCTION_LABEL[r.functionState]}</p>
                {r.functionGoalTitle && <p className="text-olive">Goal: {r.functionGoalTitle}</p>}
                <p className="text-olive">
                  Window: the last {FUNCTION_WINDOW_DAYS} days
                  {r.functionEvidenceAt
                    ? ` · newest accepted evidence ${r.functionEvidenceAt.slice(0, 10)}`
                    : " · no accepted evidence in it"}
                </p>
                {r.functionLimitations.map((l, i) => (
                  <p key={i} className="measure text-olive">{l}</p>
                ))}
                <p className="mt-1">
                  <Link href={`/clinician/member/${r.personId}/goals`} className="underline">
                    Open the goals
                  </Link>
                </p>
              </div>

              <div>
                <p className="font-medium text-app-ink">Response — {RESPONSE_LABEL[r.responseState]}</p>
                <p className="measure text-olive">{r.responseDetail}</p>
                <p className="text-olive">
                  Computed under policy {state.columnVersions.response}. An association in the
                  record, never a claim about cause.
                </p>
                <p className="mt-1">
                  <Link href={`/clinician/member/${r.personId}/responses`} className="underline">
                    Open the response record
                  </Link>
                </p>
              </div>

              <div>
                <p className="font-medium text-app-ink">Trajectory and load</p>
                <p className="measure text-olive">{r.trajectory.note}</p>
                <p className="measure text-olive">{r.load.note}</p>
              </div>

              <div>
                <p className="font-medium text-app-ink">Why they are banded {r.band}</p>
                {r.reasons.length > 0 ? (
                  <ul className="list-disc pl-5 text-olive">
                    {r.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                ) : (
                  <p className="text-olive">No flags from the caseload model.</p>
                )}
              </div>
            </div>
          </details>
        ))}
      </div>

      <p className="measure mt-4 text-xs text-olive">
        Each column is its own state from its own source. There is no combined score, and these
        states are not comparable between people — {state.rows.length} shown, ordered by the
        caseload model ({state.model}) under policy {state.policyVersion}.
      </p>
    </div>
  );
}
