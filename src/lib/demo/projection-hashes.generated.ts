// GENERATED — do not edit by hand.
//
// Regenerate with: npm run gen:projection-hashes
//
// Expected projection hashes for the seeded dataset (handoff 07 Wave 8, p9's
// "Validate projections" control). Keyed by dataset version, so a hash is
// never compared across two datasets that were never meant to match.
//
// A null means the table is empty in the baseline, which is a fact about the
// seed rather than a missing entry — the two are told apart on the console.
//
// tests/projection-validation.test.ts fails if these drift from a fresh reset.

export const EXPECTED_PROJECTION_HASHES: Record<string, Record<string, string | null>> = {
  "demo-population-v1": {
    "checkins": "9cf96e90992484bf2c33f0b52c4ffaa343136c0bb37464f1eca80f27d90005f8",
    "therapy_sessions": "4fa924d0255c79e2a386a6b97340a5d7d80add479fdb51b878810c28977f76a6",
    "practice_completions": "e77308dc294cd8067f5a6ba817d8c685fc6e432e2ef99511075733db53e8c2cb",
    "lesson_reads": null,
    "consents": "944142252aa46d456c797f38495caea29ba9945a927441339fc7dd72e1bfeead",
    "module_unlocks": "08f6c233ba07117428e377d611bd9bae8cb8f8bc7feeb8cb889d651e063b06af"
  }
};
