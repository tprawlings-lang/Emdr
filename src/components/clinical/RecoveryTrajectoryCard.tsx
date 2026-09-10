import Link from "next/link";
import {
  STATE_NOTE, DOMAIN_META, stateLabelFor,
  type TrajectoryState, type DomainType,
} from "@/lib/clinical/trajectory-policy";

// The compact recovery-trajectory card (expansion handoff 04 §9).
//
// §9 asks for "a compact trajectory card with domain badges and a longitudinal
// chart link" on the clinician overview, and for the same shape inside Session
// Prep. This is that card, and the constraints it has to survive being compact
// are the whole difficulty:
//
//   IT SHOWS EVERY DOMAIN THAT REACHED A STATE, not only the ones that moved.
//   §4: "a patient can improve in one domain and worsen in another. Preserve
//   the disagreement." A card that listed findings alone would make every open
//   read as bad news and would hide the half of the picture that is going well.
//
//   IT HAS NO SUMMARY BADGE. There is no single state for a person on this card
//   and there is not going to be one — §1's "do not replace that chart with one
//   composite recovery score" is exactly what a person-level badge would be.
//
//   IT DOES NOT RANK THE DOMAINS AGAINST EACH OTHER. They are listed in the
//   engine's stable order. A card that sorted worst-first would be asserting
//   that sleep reversing is worse than a goal stalling, which is a clinical
//   judgement nobody made and which depends on the person.
//
//   AND EVERY STATE LINKS TO ITS EVIDENCE. §12's Phase 3 definition of done is
//   the single sentence "every state opens evidence", so the card is a set of
//   doorways rather than a set of conclusions.

export interface TrajectoryCardRow {
  domainType: DomainType;
  domainKey: string;
  label: string;
  state: TrajectoryState;
  headline: string;
  limitations: string[];
}

/** Colour is never the identity (§19) — the state word is always present. The
 *  tint is decoration, and `stable` is neutral rather than green because §3
 *  refuses to read holding steady as either a success or a failure. */
function tone(state: TrajectoryState): string {
  if (state === "improving") return "bg-emerald-50 text-emerald-900";
  if (state === "reversing" || state === "slowing" || state === "stalled") return "bg-amber-50 text-amber-900";
  if (state === "insufficient_data") return "text-olive";
  return "bg-app-accent/40 text-app-ink";
}

export function RecoveryTrajectoryCard({
  personId,
  rows,
  line,
  policyVersion,
  emptyNote,
  href,
  linkLabel,
  boundary = true,
}: {
  personId: string;
  rows: TrajectoryCardRow[];
  /** §8's sentence, naming domains and a window. Null when nothing moved. */
  line: string | null;
  policyVersion: string;
  /** What to say when there is nothing to show, in words. Never a blank card. */
  emptyNote: string | null;
  href?: string;
  /** What the link says. The card ships on surfaces that ARE the trajectory
   *  page, where "open the trajectory" is a link back to where you already
   *  are — so the destination and its name travel together. */
  linkLabel?: string;
  /** Whether to print the card's own boundary paragraph. False where the
   *  surrounding surface already states it: saying it twice on one screen
   *  teaches the reader to skip it, which costs the sentence its job. */
  boundary?: boolean;
}) {
  const target = href ?? `/clinician/member/${personId}/trajectory`;

  return (
    <div data-testid="recovery-trajectory-card">
      {emptyNote ? (
        <p className="measure text-sm text-olive">{emptyNote}</p>
      ) : (
        <>
          {line && <p className="measure text-sm text-app-ink">{line}</p>}
          <ul className="mt-3 space-y-2">
            {rows.map((r) => (
              <li
                key={`${r.domainType}:${r.domainKey}`}
                data-testid="trajectory-domain"
                className="rounded-xl border border-ground/10 px-3 py-2"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium text-app-ink">{r.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${tone(r.state)}`}>
                    {/* Per domain, never the raw state word: a lane with no
                        direction of improvement must not wear a recovery
                        label. */}
                    {stateLabelFor(r.domainType, r.state)}
                  </span>
                  <span className="text-xs text-olive">{DOMAIN_META[r.domainType].label}</span>
                </div>
                <p className="measure mt-1 text-xs text-olive">{r.headline}</p>
                {r.limitations.map((l) => (
                  <p key={l} className="measure text-xs text-olive">{l}</p>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
      {boundary && (
        <p className="measure mt-3 text-xs text-olive">
          {/* The sentence that must survive any wording review. Each clause is a
              different thing the card is not: not combined, not normative, not
              predictive, not causal. */}
          Each domain is read on its own scale and against this person&rsquo;s own earlier windows.
          Nothing is combined into one figure, nothing is compared to anybody else, and none of it
          says what will happen next. Computed under {policyVersion}.
        </p>
      )}
      <p className="mt-2 text-xs">
        <Link href={target} className="underline">
          {linkLabel ?? "Open the trajectory and its evidence"}
        </Link>
      </p>
    </div>
  );
}

/** The note under a state, for surfaces that have room for it. */
export function stateNote(state: TrajectoryState): string {
  return STATE_NOTE[state];
}
