import Link from "next/link";
import {
  DOMAIN_LABEL, LEVEL_LABEL, EVIDENCE_LABEL,
  type EvidenceClass, type GoalDomain, type GoalLevel,
} from "@/lib/clinical/return-to-life-vocabulary";

// The compact Return-to-Life card for the patient overview (§9).
//
// §9 asks for "active goals, current accepted level, most recent evidence,
// change since last review". Four facts per goal and no more — this sits on a
// page that already carries the whole record, and a card that grew into a
// second goals page would push the record it was meant to summarise below the
// fold.
//
// CURRENT ACCEPTED LEVEL, and the word accepted is doing work. A goal with
// three suggestions waiting shows the level its ACCEPTED evidence supports,
// and says separately that something is waiting — because the alternative is a
// card whose number moves when a model guesses.
//
// NO PROGRESS BAR, NO PERCENTAGE. §9 warns against a "daily performance
// streak" on the patient side and the same reasoning applies here: a ladder is
// five described states, not a scale, and rendering it as a bar invites reading
// -1 as "40% recovered".

export interface GoalCardRow {
  goalId: string;
  title: string;
  domain: GoalDomain;
  currentLevel: GoalLevel | null;
  currentDescription: string | null;
  /** The most recent accepted evidence, if any. */
  latest: { occurredAt: string; evidenceClass: EvidenceClass } | null;
  /** Suggestions the clinician has not answered. */
  pendingCount: number;
  /** What changed since the last review, or null when there is nothing to
   *  compare against — rendered as "first time here" rather than as an
   *  invented comparison. */
  changeSinceReview: string | null;
}

export function ReturnToLifeCard({
  personId,
  goals,
}: {
  personId: string;
  goals: GoalCardRow[];
}) {
  return (
    <section className="rounded-2xl border border-ground/10 bg-app-surface px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-app-ink">Life goals</h2>
        <Link href={`/clinician/member/${personId}/goals`} className="text-xs text-olive underline">
          Open all
        </Link>
      </div>

      {goals.length === 0 ? (
        <p className="measure mt-3 text-sm text-ground">
          No life goals set with this person yet.{" "}
          <Link href={`/clinician/member/${personId}/goals`} className="underline">
            Add one
          </Link>{" "}
          — it starts from something they said they want to be able to do again.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {goals.map((g) => (
            <li key={g.goalId} className="border-l-2 border-ground/15 pl-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium text-app-ink">{g.title}</span>
                <span className="text-xs text-olive">{DOMAIN_LABEL[g.domain]}</span>
              </div>

              <p className="measure mt-1 text-sm text-app-ink">
                {g.currentDescription
                  ? g.currentDescription
                  : "Nothing recorded against this yet."}
                {g.currentLevel !== null && (
                  <span className="text-olive"> — {LEVEL_LABEL[g.currentLevel]}</span>
                )}
              </p>

              <p className="mt-1 text-xs text-olive">
                {g.latest
                  ? `${EVIDENCE_LABEL[g.latest.evidenceClass]}, ${new Date(g.latest.occurredAt).toLocaleDateString()}`
                  : "No accepted evidence yet"}
                {g.changeSinceReview ? ` · ${g.changeSinceReview}` : " · first time here"}
              </p>

              {g.pendingCount > 0 && (
                // Said separately from the level, on purpose: the level is what
                // accepted evidence supports, and this is a question waiting.
                <p className="mt-1 text-xs text-amber-900">
                  {g.pendingCount} suggestion{g.pendingCount === 1 ? "" : "s"} waiting on you.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
