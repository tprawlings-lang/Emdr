// What counts as session state, written down once.
//
// The Expansion Handoff's non-negotiable 5: "Tools cannot write session
// state." Its §5.3: the Tool Runtime "receives a read-only snapshot of session
// state. It has no import path to the state writer; enforce with a lint rule
// and a dependency test." A rule about "session state" is only enforceable once
// somebody says which tables that is, so this is that list — and the test that
// holds the boundary reads it rather than restating it.
//
// THE DEFINITION IS BEHAVIOURAL, NOT NOMINAL. A table is here because
// something that decides ACCESS, or decides WHAT A SESSION MAY TARGET, reads
// it. That is why `user_triggers` is on the list although nobody would call a
// trigger map "session state": its `intensity_score` is the only thing keeping
// a trigger out of self-guided processing. `recent-trigger` disables any
// trigger at 7 or above with "bring this one to your specialist", so whoever
// can write that number decides what a person may process on their own.

/** Tables the access gate, the safety engine, or session target selection read.
 *  No model-invoked tool may write any of them. */
export const SESSION_STATE_TABLES = [
  // The access gate and safety engine (read by gating.ts and safety/*).
  "therapy_sessions",
  "module_unlocks",
  "screenings",
  "checkins",
  "consents",
  "readiness_assessments",
  // What a session may target. The intensity on a trigger is an access rule
  // wearing a data field.
  "user_triggers",
] as const;

/**
 * Companion memory types that become the TARGET of a processing session.
 *
 * Row-level rather than table-level, because the memory store is mostly the
 * companion's own notes — tone preferences, topics to avoid — and a model
 * writing those is the feature. A `focus_area` is different: it is offered back
 * as a focus choice in `safe-target`, `future-template` and `relational`, so a
 * model that writes one has chosen something a person may be asked to process.
 *
 * DELIBERATELY NOT HERE, AND SAID SO: `grounding_tool` and the calm place. They
 * feed resourcing, which strengthens a positive resource rather than engaging
 * distressing material. That is a different harm model and a decision for the
 * advisors, recorded here so it reads as a choice and not an oversight.
 */
export const SESSION_TARGET_MEMORY_TYPES = ["focus_area"] as const;
