import { handoffProgress, type Handoff, type HandoffStepState } from "@/lib/clinical/handoff";

// Proposal, delivery, receipt, decision — four answers, never one (UX 007).
//
//   "Handoff workflow says it does not notify the recipient. Display delivery
//   status honestly and surface pending work. Acceptance: proposal, delivery,
//   receipt, and acceptance cannot be confused."
//
// The screen was honest and unreadable in the same sentence: "nobody has been
// notified — there is no delivery path in this build, so tell them." True, and
// it answered four questions at once, so a clinician waiting on a transfer
// could not tell which of them it was answering. Has it been sent? Has she seen
// it? Has she decided? A single disclaimer lets a reader supply whichever
// answer they were expecting.
//
// TWO OF THE FOUR ARE PERMANENTLY NEGATIVE and that is the content, not a gap.
// "Not sent, because there is no channel" and "not known, because nothing
// records a read" are answers. A blank space is not, and "nobody has been
// notified" was being read as both of them and as neither.
//
// The glyph is never the only signal: each row carries the state in words.

const STYLE: Record<HandoffStepState, { glyph: string; word: string; cls: string }> = {
  done:         { glyph: "◆", word: "done",        cls: "text-state-safe" },
  pending:      { glyph: "◷", word: "waiting",     cls: "text-state-caution" },
  not_possible: { glyph: "—", word: "not possible", cls: "text-olive" },
  not_recorded: { glyph: "?", word: "not known",   cls: "text-olive" },
  refused:      { glyph: "▲", word: "answered no", cls: "text-state-support" },
};

export function HandoffProgress({ h }: { h: Handoff }) {
  const steps = handoffProgress(h);
  return (
    <ol aria-label="Transfer progress" className="mt-3 space-y-1.5">
      {steps.map((s) => {
        const style = STYLE[s.state];
        return (
          <li key={s.step} className="text-sm">
            <span className={`font-medium ${style.cls}`}>
              <span aria-hidden>{style.glyph}</span> {s.label}
            </span>
            <span className="text-olive"> — {style.word}</span>
            {s.at && <span className="text-olive"> · {s.at}</span>}
            <span className="measure block text-xs text-olive">{s.said}</span>
          </li>
        );
      })}
    </ol>
  );
}
