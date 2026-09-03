import Link from "next/link";

// A thread and its evidence over time (Phase 3's "build thread timeline").
//
// THE THIRD LINE OF PHASE 3'S DEFINITION OF DONE IS "thread evidence always
// opens source", and that is what this component is for. A thread is a claim
// that something keeps coming up; a clinician who cannot get from the claim to
// the sentences behind it is being asked to take Steady's word for a pattern,
// which is the one thing this product does not ask anyone to do.
//
// So every entry names the thought it came from and links to it. Not a
// tooltip, not a hover: a link, because the drill-down has to survive being
// printed, read on a phone, and used by someone with a keyboard.
//
// EACH ENTRY KEEPS ITS EPISTEMIC CLASS. A thread built of four observations and
// a thread built of four hypotheses look identical if the class is dropped at
// this layer — and they are not the same evidence. §4's rule does not stop
// applying because the items have been grouped.

export interface TimelineEntry {
  itemId: string;
  displayText: string;
  statementClass: string;
  itemType: string;
  /** The thought this came from, so the drill-down can reach the transcript. */
  thoughtId: string | null;
  createdAt: string;
}

const CLASS_SHORT: Record<string, string> = {
  clinician_observation: "observed",
  patient_report: "patient said",
  clinician_hypothesis: "wondering",
  clinician_uncertainty: "unsure",
};

export function ThreadTimeline({
  label,
  threadType,
  entries,
  personId,
}: {
  label: string;
  threadType: string;
  entries: TimelineEntry[];
  personId: string;
}) {
  const classes = new Set(entries.map((e) => e.statementClass));
  const allSpeculative =
    entries.length > 0 &&
    [...classes].every((c) => c === "clinician_hypothesis" || c === "clinician_uncertainty");

  return (
    <section className="rounded-2xl border border-ground/10 bg-app-surface px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-app-ink">{label}</h3>
        <span className="text-xs text-olive">{threadType}</span>
      </div>

      {allSpeculative && (
        // A thread made only of thinking-aloud is a thread that has not been
        // established, and saying so here is cheaper than a clinician
        // reconstructing it from four separate cards.
        <p className="measure mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span aria-hidden>▲</span> Everything under this theme is a hypothesis or an
          uncertainty. Nothing here has been recorded as observed.
        </p>
      )}

      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-olive">
          Nothing has been connected to this theme yet. It is a name waiting for evidence, not a
          finding.
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {entries.map((e) => (
            <li key={e.itemId} className="border-l-2 border-ground/15 pl-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-xs font-medium text-olive">
                  {new Date(e.createdAt).toLocaleDateString()}
                </span>
                <span className="rounded-full bg-app-accent/60 px-2 py-0.5 text-xs text-app-ink">
                  {CLASS_SHORT[e.statementClass] ?? e.statementClass}
                </span>
                <span className="text-xs text-olive">{e.itemType.replace(/_/g, " ")}</span>
              </div>
              <p className="mt-1 text-sm text-app-ink">{e.displayText}</p>
              {e.thoughtId ? (
                <Link
                  href={`/clinician/member/${personId}/thoughts#${e.thoughtId}`}
                  className="mt-1 inline-block text-xs text-olive underline"
                >
                  Open the thought this came from
                </Link>
              ) : (
                <p className="mt-1 text-xs text-olive">
                  No source thought recorded for this item.
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
