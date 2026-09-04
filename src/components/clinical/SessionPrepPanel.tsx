import Link from "next/link";
import { SECTION_TITLE, type PrepSection, type SessionPrep } from "@/lib/clinical/session-prep";

// Session Prep, rendered (§11, Phase 4).
//
// ONE MINUTE IS THE DESIGN CONSTRAINT. §11: "keep Session Prep short enough to
// scan in about one minute." So sections with nothing in them do not render as
// empty headings — an empty section costs a line of a clinician's attention and
// returns nothing — and the whole brief collapses to a single honest sentence
// when there is nothing to say.
//
// STEADY NOTICED IS VISUALLY DISTINCT, which is Phase 4's second line of done.
// Not a badge in the corner: a different ground, a different heading treatment,
// and its own sentence saying what it is. The other four sections are records.
// This one is Steady drawing a line between two records, and a reader who
// cannot tell those apart at a glance is being asked to weigh them the same.
//
// EVERY MACHINE-DERIVED ITEM CARRIES ITS "WHY AM I SEEING THIS", inline rather
// than behind a hover. §11 asks for the action; a tooltip is not one on a
// phone, on a keyboard, or on paper.
//
// A HYPOTHESIS IS RENDERED AS A HYPOTHESIS. The statement class travels on the
// claim, so this reads it rather than trusting the sentence to have been worded
// carefully — §9's "no fact promotion" surviving the last hop, which is the hop
// where it is usually lost.

const CLASS_NOTE: Record<string, string> = {
  clinician_hypothesis: "recorded as a hypothesis",
  clinician_uncertainty: "recorded as an uncertainty",
  patient_report: "the patient's words",
};

const DETERMINISTIC_ORDER: PrepSection[] = [
  // Life goals second: what a person can do again is what the session is for,
  // and a brief that led with the record and buried the goal would have the
  // emphasis backwards.
  // Observed responses third (expansion handoff 02 §9): the goals say what the
  // session is for, and this says what has and has not tended to follow the
  // work — read together, before the follow-ups the clinician set themselves.
  // Changes and trends fourth (expansion handoff 04 §9): after what the work
  // is for and what has followed it, so a domain that moved is read against
  // what was being worked on rather than as a free-standing verdict.
  "last_session", "life_goals", "observed_responses", "changes_and_trends",
  "revisit", "between_visit", "active_threads",
];

export function SessionPrepPanel({
  prep,
  personId,
}: {
  prep: SessionPrep;
  personId: string;
}) {
  const filled = DETERMINISTIC_ORDER.filter((s) => prep.sections[s].length > 0);
  const noticed = prep.sections.steady_noticed;
  const nothing = filled.length === 0 && noticed.length === 0;

  return (
    <section className="rounded-2xl border border-ground/10 bg-app-surface px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-app-ink">Before this session</h2>
        <span className="text-xs text-olive">
          {prep.provenance.authorizedEvidence} record{prep.provenance.authorizedEvidence === 1 ? "" : "s"} considered
        </span>
      </div>

      {nothing ? (
        <p className="measure mt-3 text-sm text-ground">
          There is nothing to bring forward. No recorded thoughts, no open follow-ups and no
          active themes for this person — this is an empty record, not a brief that failed to
          load.
        </p>
      ) : (
        <>
          {filled.map((section) => (
            <div key={section} className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-olive">
                {SECTION_TITLE[section]}
              </h3>
              <ul className="mt-2 space-y-1.5">
                {prep.sections[section].map((c, i) => (
                  <li key={`${section}-${i}`} className="measure text-sm text-app-ink">
                    {c.text}
                    {c.statementClass && CLASS_NOTE[c.statementClass] && (
                      <span className="text-olive"> — {CLASS_NOTE[c.statementClass]}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {noticed.length > 0 && (
            // Its own ground, its own frame, its own sentence. This is the
            // difference between a record and a machine drawing a line between
            // two records, and it has to be legible before anything is read.
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                {SECTION_TITLE.steady_noticed}
              </h3>
              <p className="measure mt-1 text-xs text-amber-900/80">
                Steady put these together from your records. Nothing here is a clinical finding,
                and none of it was written by a person.
              </p>
              <ul className="mt-3 space-y-3">
                {noticed.map((c, i) => (
                  <li key={`noticed-${i}`}>
                    <p className="measure text-sm text-app-ink">
                      {c.text}
                      {c.statementClass && CLASS_NOTE[c.statementClass] && (
                        <span className="text-olive"> — {CLASS_NOTE[c.statementClass]}</span>
                      )}
                    </p>
                    {c.why && (
                      <p className="measure mt-1 text-xs text-amber-900/90">
                        <span className="font-medium">Why am I seeing this?</span> {c.why}
                      </p>
                    )}
                    <Link
                      href={`/clinician/member/${personId}/thoughts`}
                      className="mt-1 inline-block text-xs text-olive underline"
                    >
                      Open the records behind it
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {prep.omitted.length > 0 && (
        // Reported, not swallowed. A brief that quietly drops a claim looks
        // exactly like one that never had it, and the difference is whether
        // something is wrong with the assembler.
        <p className="measure mt-4 text-xs text-olive">
          {prep.omitted.length} statement{prep.omitted.length === 1 ? " was" : "s were"} withheld
          because {prep.omitted.length === 1 ? "it" : "they"} could not be tied to a record you are
          allowed to see.
        </p>
      )}

      <p className="measure mt-4 text-xs text-olive">
        Assembled from records up to {new Date(prep.evidenceCutoff).toLocaleString()}. Candidate
        items nobody kept and connections nobody accepted are not included.
      </p>
    </section>
  );
}
