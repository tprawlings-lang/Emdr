import {
  COMPANION_ENTRY_COPY, COMPANION_ENTRY_MESSAGE, COMPANION_LIMITS,
} from "@/lib/experience/companion-entry";

/**
 * What a person is told before they type (handoff 09 §11).
 *
 * PLACED ABOVE THE CONVERSATION, not below it. That is the whole requirement —
 * §11 says "entry states it is AI and names its communication limits", and the
 * line this replaces sat under the message thread, where it is read after the
 * conversation it was meant to precede.
 *
 * NOT A DISMISSIBLE BANNER AND NOT A `<details>`. The emergency notice above it
 * is already a disclosure a person can collapse; making this the second one
 * teaches the eye that everything before the text box is furniture. It is four
 * short lines and it stays open.
 *
 * The tone is deliberately flat. This is the one place on a member surface
 * where warmth would be dishonest: the point of the panel is that the warmth
 * further down the page is generated.
 */
export function CompanionEntryNotice() {
  return (
    <section
      data-testid="companion-entry"
      aria-labelledby="companion-entry-heading"
      className="rounded-3xl border border-ground/15 bg-linen px-5 py-4"
    >
      <h2 id="companion-entry-heading" className="text-sm font-semibold text-ground">
        {COMPANION_ENTRY_MESSAGE[COMPANION_ENTRY_COPY.heading]}
      </h2>
      <p data-testid="companion-is-ai" className="measure mt-1.5 text-sm text-ground">
        {COMPANION_ENTRY_MESSAGE[COMPANION_ENTRY_COPY.isAi]}
      </p>
      <p className="mt-3 text-sm font-medium text-ground">
        {COMPANION_ENTRY_MESSAGE[COMPANION_ENTRY_COPY.limits]}
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {COMPANION_LIMITS.map((l) => (
          <li key={l.id} data-companion-limit={l.id} className="measure text-sm text-olive">
            {l.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
