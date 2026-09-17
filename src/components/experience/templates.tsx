import Link from "next/link";
import { EvidenceDetails } from "./EvidenceDetails";
import type { ProjectionMeta } from "@/lib/presentation/envelope";

// The three page templates.
//
//   | Work list          | Scope and filters; rows; evidence panel; action result |
//   | Person workspace   | Identity; local navigation; summary; task content      |
//   | Analysis and review| Question; result; limitations; evidence; decision      |
//
// WHY A COMPONENT AND NOT A CONVENTION. The handoff's layout rules are already
// written down, and writing them down is what has not worked: UX 010 reports
// "large explanation blocks and narrow columns bury working content" across
// screens built by people who had read the rule. A rule in a document is
// re-derived per screen, and a screen is shipped by whoever is in a hurry.
//
// SO THE RULES ARE IN THE TYPES AND THE ORDER, where they cost nothing to obey
// and are awkward to break:
//
//   ONE PRIMARY ACTION. `primaryAction` is one optional object, not a list.
//   "Present one prominent primary action when the task has one" is then not a
//   discipline; there is no second slot to put another in.
//
//   A DUE DATE MUST NAME THE POLICY THAT CREATED IT. `due` carries both the
//   moment and the rule. "Due state only when a real policy creates a due
//   date" — a screen that wants an urgent-looking date has to say which rule
//   produced it, and inventing one is then a visible lie rather than a style
//   choice.
//
//   LIMITATIONS ARE REQUIRED, NOT OPTIONAL. `AnalysisReview` will not compile
//   without them, and renders a stated absence rather than nothing when the
//   array is empty. "Explain insufficient evidence by naming what is missing";
//   a reading whose limits are silent reads as a reading with none.
//
//   THE EVIDENCE SLOT CANNOT BE SKIPPED, ONLY ANSWERED. It takes a
//   ProjectionMeta — rendered through the disclosure, so a screen cannot print
//   `clinician_patient.v1+clinical-policy-2026-08-t1` into its own prose and
//   call it an evidence panel — or an explicit `{ perRow }` saying the
//   evidence sits with each row and where to find it. Not every clinical
//   reading is fed by one envelope: the trajectory screen opens a window
//   disclosure per domain, which is better than a page-level panel for that
//   shape. What it may not do is have no answer.
//
//   PROSE IS MEASURED, WORK IS NOT. Explanation renders inside `.measure`;
//   rows and task content get the full column. "Give clinical work useful
//   horizontal space. Keep long reading content in a narrower text column" —
//   two rules that contradict each other unless something knows which is which.
//
// THE ORDER IS THE TEMPLATE. A caller supplies the parts and cannot rearrange
// them, which is the whole point of the Analysis template in particular:
// "Trajectory: put findings first and technical explanation later."

/**
 * Where the evidence for this screen is.
 *
 * A union rather than an optional, because "optional" and "forgotten" render
 * identically and only one of them is a decision.
 */
export type EvidenceSlot =
  | { projection: ProjectionMeta }
  /** Evidence sits with each row. The note says where, in words. */
  | { perRow: string };

function Evidence({ slot, className = "" }: { slot: EvidenceSlot; className?: string }) {
  if ("projection" in slot) return <EvidenceDetails meta={slot.projection} className={className} />;
  return <p className={`measure text-sm text-olive ${className}`}>{slot.perRow}</p>;
}

export interface PrimaryAction {
  href: string;
  label: string;
}

/** A due date and the rule that produced it. Both, or neither. */
export interface DueState {
  at: string;
  /** The policy that creates this deadline, named on screen. */
  policy: string;
}

function ActionButton({ action }: { action: PrimaryAction }) {
  return (
    <Link
      href={action.href}
      className="inline-flex items-center rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-linen transition-opacity hover:opacity-90"
    >
      {action.label}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Work list
// ---------------------------------------------------------------------------

/**
 * Scope and filters; rows; evidence panel; action result.
 *
 * THE RESULT COMES FIRST ON SCREEN even though the handoff lists it last,
 * because it is the answer to something the reader just did. "Every action
 * reports what actually happened" is worth nothing if the report is below the
 * rows that pushed it off the fold.
 */
export function WorkList({
  purpose, scope, result, evidence, children,
}: {
  /** One short sentence saying what this list is for. The title is the shell's. */
  purpose: string;
  /** The scope strip and filters. */
  scope?: React.ReactNode;
  /** What just happened, if anything did. */
  result?: React.ReactNode;
  /** Where the evidence behind the rows is. */
  evidence: EvidenceSlot;
  /** The rows. */
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="measure text-olive">{purpose}</p>
      {result && <div className="mt-4">{result}</div>}
      {scope && <div className="mt-4">{scope}</div>}
      <div className="mt-5">{children}</div>
      <Evidence slot={evidence} className="mt-8" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Person workspace — the summary slot
// ---------------------------------------------------------------------------

export interface PersonStatus {
  /** What is true right now, in one sentence. */
  statement: string;
  /** Why it is that. Separate from the statement so a reader can disagree
   *  with the reasoning rather than only with the conclusion. */
  reason: string;
  /** What is not known. Empty is a real answer and renders as one. */
  missing: string[];
  /** A deadline and the rule that created it, or nothing. */
  due?: DueState | null;
  /** One action, when there is work. */
  primaryAction?: PrimaryAction;
}

/**
 * The status block every person-record section opens with.
 *
 * "Each destination must open with a concise status statement, one primary
 * action when work exists, the reason for the status, evidence freshness,
 * missing information, ownership, and any real due state."
 *
 * SEVEN THINGS, AND THIS RENDERS FIVE OF THEM. Ownership and evidence
 * freshness belong to the record rather than to the section, and the person
 * workspace already carries them in its identity strip, directly above this
 * block. Rendering them here too put "Unassigned · Evidence 1 d ago" twice on
 * one screen, eighty pixels apart, from one source — which is the density this
 * work is meant to remove, arriving as a side effect of a checklist.
 *
 * The requirement is that the DESTINATION opens with all seven, and it does.
 * They are not props here because a prop nothing renders is an invitation to
 * render it.
 */
export function PersonSummary({ status }: { status: PersonStatus }) {
  return (
    <section
      aria-label="Status"
      className="rounded-2xl border border-ground/10 bg-app-surface px-5 py-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="measure font-medium text-ground">{status.statement}</p>
          <p className="measure mt-1 text-sm text-olive">{status.reason}</p>
        </div>
        {status.primaryAction && <ActionButton action={status.primaryAction} />}
      </div>

      {/* The due state names its rule, because the type made it. */}
      {status.due && (
        <p className="mt-4 border-t border-ground/10 pt-3 text-sm text-state-caution">
          Due {status.due.at.slice(0, 10)} under {status.due.policy}
        </p>
      )}

      {/* Absence as a named state, never a blank. §30.8: "Show present values
          and list missing sources." */}
      <p className={`measure text-sm text-olive ${status.due ? "mt-3" : "mt-4 border-t border-ground/10 pt-3"}`}>
        {status.missing.length === 0
          ? "Nothing needed for this reading is missing."
          : `Not known: ${status.missing.join("; ")}.`}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Analysis and review
// ---------------------------------------------------------------------------

/**
 * Question; result; limitations; evidence; decision.
 *
 * The order is not negotiable and it is the reason this exists. A reader
 * arriving at a clinical reading gets the question it answers, then the
 * answer, then what the answer cannot tell them — before any of the
 * arithmetic. "Put findings first and technical explanation later. Descriptive
 * status cannot be mistaken for a forecast."
 */
export function AnalysisReview({
  question, limitations, evidence, decision, children,
}: {
  /** What this screen answers, as a question a clinician would ask. */
  question: string;
  /** What this reading cannot tell the reader. Required. */
  limitations: string[];
  /** Where the evidence behind the result is. */
  evidence: EvidenceSlot;
  /** What the reader may do about it, if anything. */
  decision?: React.ReactNode;
  /** The result. */
  children: React.ReactNode;
}) {
  return (
    <div>
      {/* The question, as a question. A heading reading "Trajectory" tells a
          reader what the screen is called; this tells them what it is for. */}
      <p className="measure text-olive">{question}</p>

      <div className="mt-5">{children}</div>

      <section aria-label="Limitations" className="mt-8 border-t border-ground/10 pt-5">
        <h2 className="text-sm font-semibold text-app-ink">What this cannot tell you</h2>
        {limitations.length === 0 ? (
          // FAIL LOUD RATHER THAN QUIETLY. An empty array is almost always a
          // screen that has not thought about it, and a blank space reads as a
          // reading with no limits — which no clinical reading has.
          <p className="measure mt-2 text-sm text-state-caution">
            No limitation has been recorded for this reading. That is a gap in this screen, not a
            statement that the reading is unqualified.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {limitations.map((l) => (
              <li key={l} className="measure text-sm text-ground">{l}</li>
            ))}
          </ul>
        )}
      </section>

      <Evidence slot={evidence} className="mt-6" />

      {decision && (
        <section aria-label="Decision" className="mt-8 border-t border-ground/10 pt-5">
          {decision}
        </section>
      )}
    </div>
  );
}
