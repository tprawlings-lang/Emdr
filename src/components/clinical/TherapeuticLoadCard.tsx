import Link from "next/link";
import {
  LOAD_STATE_LABEL, LOAD_STATE_NOTE, type LoadState,
} from "@/lib/clinical/therapeutic-load-policy";

// The therapeutic-load card (expansion handoff 05 §8).
//
// §8 asks for a "clinician-only card" on the patient overview and adds the one
// design instruction that matters: "Do not show a mysterious readiness score."
//
// SO THERE IS NO NUMBER ON THIS CARD AND THERE IS NOWHERE TO PUT ONE. The state
// is a phrase, the evidence is two to four named bullets, and each bullet says
// what was seen rather than how much it counted for. §13's acceptance criterion
// is "no readiness number is displayed without explanation; preferred design is
// categorical evidence-backed state" — and the way to satisfy that permanently
// is for the component to have no numeric prop.
//
// THE STATE IS NEVER AN INSTRUCTION. "Evidence to review whether the next step
// fits" is a different sentence from "ready to progress", and the difference is
// the authority boundary §1 draws. The card also says outright, on every state,
// that nothing has been changed — because a clinician reading a recommendation
// on a screen has every reason to wonder whether the screen already acted on it.
//
// AND A BLOCKED STATE SHOWS THE CONSTRAINT AND STOPS. §1: "if the safety engine
// blocks an activity, Therapeutic Load displays that external constraint and
// stops. It does not compute a workaround." There are no dimensions to show in
// that case because none were computed, and the card says why rather than
// rendering an empty section.

export interface LoadCardBullet {
  label: string;
  detail: string;
}

function tone(state: LoadState): string {
  if (state === "blocked_by_safety") return "bg-rose-50 text-rose-900";
  if (state === "stabilize") return "bg-amber-50 text-amber-900";
  if (state === "consider_progression") return "bg-emerald-50 text-emerald-900";
  if (state === "insufficient_data") return "text-olive";
  return "bg-app-accent/40 text-app-ink";
}

export function TherapeuticLoadCard({
  personId,
  state,
  bullets,
  limitations,
  policyVersion,
  safetyHeadline,
  safeAlternative,
  href,
  linkLabel,
  boundary = true,
}: {
  personId: string;
  state: LoadState;
  bullets: LoadCardBullet[];
  limitations: string[];
  policyVersion: string;
  /** The safety engine's own words, when it is holding something. Shown
   *  verbatim: a constraint restated in this feature's voice is a constraint
   *  this feature could get wrong. */
  safetyHeadline: string | null;
  safeAlternative: string | null;
  href?: string;
  linkLabel?: string;
  boundary?: boolean;
}) {
  const target = href ?? `/clinician/member/${personId}/load`;

  return (
    <div data-testid="therapeutic-load-card">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone(state)}`}>
          {/* The word, never a figure. Colour is decoration; the state is the
              phrase, so a reader who cannot see the tint loses nothing. */}
          {LOAD_STATE_LABEL[state]}
        </span>
      </div>
      <p className="measure mt-2 text-sm text-app-ink">{LOAD_STATE_NOTE[state]}</p>

      {safetyHeadline && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/50 px-3 py-2">
          <p className="measure text-sm text-app-ink">{safetyHeadline}</p>
          {safeAlternative && (
            <p className="measure text-xs text-olive">Open instead: {safeAlternative}.</p>
          )}
          {/* The card's own attribution, for the surfaces where it stands
              alone — the overview and the drawer. The detail page carries a
              fuller version and suppresses its duplicate explanation rather
              than saying this twice. */}
          <p className="measure text-xs text-olive">
            That decision is made by the safety engine on its own rules. Nothing on this card can
            change it, and Steady has not computed a way around it.
          </p>
        </div>
      )}

      {bullets.length > 0 && (
        <ul className="mt-3 space-y-1">
          {bullets.map((b) => (
            <li key={b.label} data-testid="load-bullet" className="measure text-sm text-app-ink">
              <span className="font-medium">{b.label}</span>
              <span className="block text-xs text-olive">{b.detail}</span>
            </li>
          ))}
        </ul>
      )}

      {limitations.map((l) => (
        <p key={l} className="measure mt-2 text-xs text-olive">{l}</p>
      ))}

      {boundary && (
        <p className="measure mt-3 text-xs text-olive">
          Decision support, for you to accept or reject. Steady has not unlocked, scheduled, or
          started anything, and it does not decide who may access what — the safety engine does
          that, separately, on its own rules. Computed under {policyVersion}.
        </p>
      )}
      <p className="mt-2 text-xs">
        <Link href={target} className="underline">
          {linkLabel ?? "Open the load reading and its evidence"}
        </Link>
      </p>
    </div>
  );
}
