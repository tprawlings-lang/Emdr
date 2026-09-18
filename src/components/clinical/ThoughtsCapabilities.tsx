import { thoughtsCapabilities } from "@/lib/clinical/thoughts-flags";

// What this page can do here, answered from the flags that decide it (UX 005).
//
//   "Thoughts contains stale future-phase copy beside working functions.
//   Remove implementation commentary and standardize product terms.
//   Acceptance: no contradictory capability claims remain."
//
// The paragraph this replaces read "Session preparation and patient-scoped
// questions are built in later phases", with the patient-scoped question box
// rendered a few hundred pixels above it and session preparation one click
// away on the record overview. Both had shipped; the sentence had not been read
// since.
//
// A SENTENCE CANNOT BE THE SOURCE OF TRUTH ABOUT WHAT EXISTS. This list comes
// from `thoughtsCapabilities`, which reads the same flags that decide whether
// each surface renders — so a capability turned on cannot still be described as
// future, and one turned off says so rather than vanishing, which is the
// difference between "not here" and "broken".
//
// No phase numbers and no flag names: those are implementation commentary, and
// a clinician reading "Phase 5" learns something about our backlog rather than
// about their patient.

export function ThoughtsCapabilities() {
  const rows = thoughtsCapabilities();
  const off = rows.filter((r) => !r.available);

  return (
    <div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.flag} className="measure text-sm">
            <span className="font-medium text-ground">{r.name}</span>
            <span className="text-olive">
              {" — "}
              {r.does}{" "}
              {r.available ? r.where : "Switched off in this environment."}
            </span>
          </li>
        ))}
      </ul>
      {off.length > 0 && (
        <p className="measure mt-3 text-xs text-olive">
          {/* A flag change never deletes or rewrites stored history, and saying
              so is the difference between a reader thinking something is gone
              and knowing it is closed. */}
          {off.length === 1 ? "One capability is" : `${off.length} capabilities are`} switched off
          here. Nothing recorded before is lost, and it appears again when the switch is turned
          back on.
        </p>
      )}
    </div>
  );
}
