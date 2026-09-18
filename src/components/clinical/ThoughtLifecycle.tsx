import { THOUGHT_LIFECYCLE } from "@/lib/clinical/thought-lifecycle";

// The four states, in one place (17 September handoff, P4).
//
// The page already separated the surfaces. What it never said in one place is
// which state a given piece of thinking is in and who can read it — a clinician
// had to assemble that from five footnotes spread down a long page, each true
// about its own corner.
//
// THE UNOBSERVABLE STATE IS LISTED, AND MARKED. "Filed" means the words reached
// a signed note, and the draft leaves this product as text with nothing
// reporting back. Dropping the row would let a reader assume the three states
// shown are all there are; a badge would be a claim nobody checked. It is
// listed, and it says plainly that nothing here can tell you.

export function ThoughtLifecycle() {
  return (
    <div data-testid="thought-lifecycle">
      <p className="measure text-sm text-ground">
        Four things can be true of something you say here. They are not the same, and who can read
        it changes between them.
      </p>
      <ul className="mt-3 space-y-3">
        {THOUGHT_LIFECYCLE.map((m) => (
          <li
            key={m.state}
            data-testid={`lifecycle-${m.state}`}
            className="rounded-xl border border-ground/10 px-4 py-3"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-medium text-app-ink">{m.label}</span>
              {!m.observable && (
                // Not a warning and not an error state. A fact about what this
                // product can see.
                <span className="rounded-full border border-ground/20 px-2 py-0.5 text-xs text-olive">
                  Steady cannot tell you this
                </span>
              )}
            </div>
            <p className="measure mt-1 text-sm text-app-ink">{m.means}</p>
            <p className="measure mt-0.5 text-xs text-olive">Who can read it: {m.readableBy}</p>
            <p className="measure mt-0.5 text-xs text-olive">{m.where}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
