// The 240-profile seed manifest (handoff 07 §2.6, pp16–27).
//
// TRANSCRIBED, NOT GENERATED. The handoff prints all 240 rows, and that is the
// point of them: a fixed manifest is what makes "re-running the same version
// produces the same event ids, timestamps, values and projection hashes"
// (p14) a checkable claim rather than an aspiration. A generator that invented
// this population would produce a different one on every change to its own
// code.
//
// The transcription checked itself. p29's data-quality manifest specifies the
// balances — 240 exactly, 60 per region, 40 per age band, 10 per band per
// region, 30 per archetype — and `checkManifest()` below computes them from
// these rows. Every one passed on the first parse, which is worth more as
// evidence than proofreading 240 lines would have been.
//
// WHAT THESE ROWS ARE NOT. p12 states it and it belongs here too: archetypes
// create testable stories. They do not label real people, predict a diagnosis
// or decide care. Baseline and follow-up are fabricated measure values used to
// validate trajectory math — not diagnoses, treatment decisions or outcome
// claims. Race, ethnicity and language are here to audit representation and
// disparity (p13), never to select or restrict a person's care.

/** p11's four U.S. Census regions. A REPORTING dimension, not an estimate of
 *  clinical need — and if Steady later uses partner operating regions, they
 *  get a separate `care_region` field rather than overwriting this one. */
export type Region = "NE" | "MW" | "SO" | "WE";

export type AgeBand = "18-24" | "25-34" | "35-44" | "45-54" | "55-64" | "65+";

/** p13: self-described, multiple values permitted. Stored for representation
 *  and disparity audit; never a care-selection rule. */
export type Race = "AIAN" | "Asian" | "Black" | "NHPI" | "White" | "Multiracial";

/** p13: a SEPARATE field from race, never collapsed into it or inferred from
 *  a name. */
export type Ethnicity = "Hisp." | "Not Hisp.";

/** p13: preferred language plus interpreter need. Never treated as ability or
 *  motivation. */
export type Language = "English" | "Spanish" | "Mandarin";

/** p12's eight outcome patterns, 30 people each. */
export type Archetype =
  | "Early response" | "Steady response" | "Late response" | "No change"
  | "Sporadic use" | "Module mismatch" | "Access barrier" | "Safety pause";

/** The safety state the fixed scenarios put this person in. Deterministic
 *  inputs produce the expected gate output (p14). */
export type SafetyState = "No active gate" | "Fixed pause" | "Review event";

export interface ManifestRow {
  id: string;
  region: Region;
  state: string;
  ageBand: AgeBand;
  /** The exact fabricated age. p13 stores it and DISPLAYS the band, so a
   *  screen cannot accidentally become person-identifying by being precise. */
  age: number;
  race: Race;
  ethnicity: Ethnicity;
  language: Language;
  archetype: Archetype;
  clinician: string;
  /** Fabricated measure values used to validate trajectory math. Not a
   *  diagnosis, a treatment decision, or an outcome claim. */
  baseline: number;
  followUp: number;
  safety: SafetyState;
}

export const DATASET_VERSION = "demo-population-v1";

/**
 * One stable seed per profile (p14).
 *
 * The formula is ours and stated here, deliberately. p15 prints one example
 * profile carrying `"seed": 100217` for `ST-WE-017`, and no rule anywhere in
 * the handoff derives that number — it is an illustration of the SHAPE of a
 * profile, and the requirement beneath it is only that "ids are deterministic
 * within a dataset version" (p15) and that re-running a version reproduces
 * everything (p14). A formula that is written down satisfies both; one that is
 * reverse-engineered from a single printed value satisfies neither.
 */
export const REGION_SEED_OFFSET: Record<Region, number> = {
  NE: 100_000, MW: 200_000, SO: 300_000, WE: 400_000,
};

export function seedFor(row: ManifestRow): number {
  return REGION_SEED_OFFSET[row.region] + Number(row.id.slice(-3));
}

export const MANIFEST: ManifestRow[] = [
  // ── NE ──────────────────────────────────────────────────────────
  { id: "ST-NE-001", region: "NE", state: "MA", ageBand: "18-24", age: 18, race: "AIAN", ethnicity: "Hisp.", language: "English", archetype: "Early response", clinician: "NE-C1", baseline: 15, followUp: 8, safety: "No active gate" },
  { id: "ST-NE-002", region: "NE", state: "NY", ageBand: "18-24", age: 19, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Steady response", clinician: "NE-C2", baseline: 22, followUp: 18, safety: "No active gate" },
  { id: "ST-NE-003", region: "NE", state: "PA", ageBand: "18-24", age: 20, race: "Black", ethnicity: "Not Hisp.", language: "Spanish", archetype: "Late response", clinician: "NE-C3", baseline: 13, followUp: 8, safety: "No active gate" },
  { id: "ST-NE-004", region: "NE", state: "NJ", ageBand: "18-24", age: 21, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "No change", clinician: "NE-C1", baseline: 20, followUp: 20, safety: "No active gate" },
  { id: "ST-NE-005", region: "NE", state: "CT", ageBand: "18-24", age: 22, race: "White", ethnicity: "Hisp.", language: "Mandarin", archetype: "Sporadic use", clinician: "NE-C2", baseline: 11, followUp: 10, safety: "No active gate" },
  { id: "ST-NE-006", region: "NE", state: "ME", ageBand: "18-24", age: 23, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Module mismatch", clinician: "NE-C3", baseline: 18, followUp: 16, safety: "No active gate" },
  { id: "ST-NE-007", region: "NE", state: "MA", ageBand: "18-24", age: 24, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Access barrier", clinician: "NE-C1", baseline: 9, followUp: 8, safety: "No active gate" },
  { id: "ST-NE-008", region: "NE", state: "NY", ageBand: "18-24", age: 18, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Safety pause", clinician: "NE-C2", baseline: 16, followUp: 14, safety: "Fixed pause" },
  { id: "ST-NE-009", region: "NE", state: "PA", ageBand: "18-24", age: 19, race: "Black", ethnicity: "Hisp.", language: "Spanish", archetype: "Early response", clinician: "NE-C3", baseline: 23, followUp: 15, safety: "No active gate" },
  { id: "ST-NE-010", region: "NE", state: "NJ", ageBand: "18-24", age: 20, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "Steady response", clinician: "NE-C1", baseline: 14, followUp: 9, safety: "No active gate" },
  { id: "ST-NE-011", region: "NE", state: "NY", ageBand: "25-34", age: 25, race: "Asian", ethnicity: "Not Hisp.", language: "Spanish", archetype: "Late response", clinician: "NE-C2", baseline: 8, followUp: 5, safety: "No active gate" },
  { id: "ST-NE-012", region: "NE", state: "PA", ageBand: "25-34", age: 26, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "No change", clinician: "NE-C3", baseline: 15, followUp: 14, safety: "No active gate" },
  { id: "ST-NE-013", region: "NE", state: "NJ", ageBand: "25-34", age: 27, race: "NHPI", ethnicity: "Hisp.", language: "Mandarin", archetype: "Sporadic use", clinician: "NE-C1", baseline: 22, followUp: 20, safety: "No active gate" },
  { id: "ST-NE-014", region: "NE", state: "CT", ageBand: "25-34", age: 28, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "Module mismatch", clinician: "NE-C2", baseline: 13, followUp: 13, safety: "No active gate" },
  { id: "ST-NE-015", region: "NE", state: "ME", ageBand: "25-34", age: 29, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Access barrier", clinician: "NE-C3", baseline: 20, followUp: 18, safety: "No active gate" },
  { id: "ST-NE-016", region: "NE", state: "MA", ageBand: "25-34", age: 30, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Safety pause", clinician: "NE-C1", baseline: 11, followUp: 8, safety: "Fixed pause" },
  { id: "ST-NE-017", region: "NE", state: "NY", ageBand: "25-34", age: 31, race: "Asian", ethnicity: "Hisp.", language: "Spanish", archetype: "Early response", clinician: "NE-C2", baseline: 18, followUp: 12, safety: "Review event" },
  { id: "ST-NE-018", region: "NE", state: "PA", ageBand: "25-34", age: 32, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "Steady response", clinician: "NE-C3", baseline: 9, followUp: 3, safety: "No active gate" },
  { id: "ST-NE-019", region: "NE", state: "NJ", ageBand: "25-34", age: 33, race: "NHPI", ethnicity: "Not Hisp.", language: "Mandarin", archetype: "Late response", clinician: "NE-C1", baseline: 16, followUp: 12, safety: "No active gate" },
  { id: "ST-NE-020", region: "NE", state: "CT", ageBand: "25-34", age: 34, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "No change", clinician: "NE-C2", baseline: 23, followUp: 24, safety: "No active gate" },
  { id: "ST-NE-021", region: "NE", state: "PA", ageBand: "35-44", age: 35, race: "Black", ethnicity: "Hisp.", language: "Mandarin", archetype: "Sporadic use", clinician: "NE-C3", baseline: 17, followUp: 14, safety: "No active gate" },
  { id: "ST-NE-022", region: "NE", state: "NJ", ageBand: "35-44", age: 36, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "Module mismatch", clinician: "NE-C1", baseline: 8, followUp: 7, safety: "No active gate" },
  { id: "ST-NE-023", region: "NE", state: "CT", ageBand: "35-44", age: 37, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "Access barrier", clinician: "NE-C2", baseline: 15, followUp: 15, safety: "No active gate" },
  { id: "ST-NE-024", region: "NE", state: "ME", ageBand: "35-44", age: 38, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Safety pause", clinician: "NE-C3", baseline: 22, followUp: 18, safety: "Fixed pause" },
  { id: "ST-NE-025", region: "NE", state: "MA", ageBand: "35-44", age: 39, race: "AIAN", ethnicity: "Hisp.", language: "Spanish", archetype: "Early response", clinician: "NE-C1", baseline: 13, followUp: 6, safety: "No active gate" },
  { id: "ST-NE-026", region: "NE", state: "NY", ageBand: "35-44", age: 40, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Steady response", clinician: "NE-C2", baseline: 20, followUp: 16, safety: "No active gate" },
  { id: "ST-NE-027", region: "NE", state: "PA", ageBand: "35-44", age: 41, race: "Black", ethnicity: "Not Hisp.", language: "Mandarin", archetype: "Late response", clinician: "NE-C3", baseline: 11, followUp: 6, safety: "No active gate" },
  { id: "ST-NE-028", region: "NE", state: "NJ", ageBand: "35-44", age: 42, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "No change", clinician: "NE-C1", baseline: 18, followUp: 18, safety: "No active gate" },
  { id: "ST-NE-029", region: "NE", state: "CT", ageBand: "35-44", age: 43, race: "White", ethnicity: "Hisp.", language: "English", archetype: "Sporadic use", clinician: "NE-C2", baseline: 9, followUp: 8, safety: "No active gate" },
  { id: "ST-NE-030", region: "NE", state: "ME", ageBand: "35-44", age: 44, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Module mismatch", clinician: "NE-C3", baseline: 16, followUp: 14, safety: "No active gate" },
  { id: "ST-NE-031", region: "NE", state: "NJ", ageBand: "45-54", age: 45, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "Access barrier", clinician: "NE-C1", baseline: 10, followUp: 9, safety: "No active gate" },
  { id: "ST-NE-032", region: "NE", state: "CT", ageBand: "45-54", age: 46, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "Safety pause", clinician: "NE-C2", baseline: 17, followUp: 15, safety: "Fixed pause" },
  { id: "ST-NE-033", region: "NE", state: "ME", ageBand: "45-54", age: 47, race: "Multiracial", ethnicity: "Hisp.", language: "Spanish", archetype: "Early response", clinician: "NE-C3", baseline: 8, followUp: 0, safety: "No active gate" },
  { id: "ST-NE-034", region: "NE", state: "MA", ageBand: "45-54", age: 48, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Steady response", clinician: "NE-C1", baseline: 15, followUp: 10, safety: "Review event" },
  { id: "ST-NE-035", region: "NE", state: "NY", ageBand: "45-54", age: 49, race: "Asian", ethnicity: "Not Hisp.", language: "Mandarin", archetype: "Late response", clinician: "NE-C2", baseline: 22, followUp: 19, safety: "No active gate" },
  { id: "ST-NE-036", region: "NE", state: "PA", ageBand: "45-54", age: 50, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "No change", clinician: "NE-C3", baseline: 13, followUp: 12, safety: "No active gate" },
  { id: "ST-NE-037", region: "NE", state: "NJ", ageBand: "45-54", age: 51, race: "NHPI", ethnicity: "Hisp.", language: "English", archetype: "Sporadic use", clinician: "NE-C1", baseline: 20, followUp: 18, safety: "No active gate" },
  { id: "ST-NE-038", region: "NE", state: "CT", ageBand: "45-54", age: 52, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "Module mismatch", clinician: "NE-C2", baseline: 11, followUp: 11, safety: "No active gate" },
  { id: "ST-NE-039", region: "NE", state: "ME", ageBand: "45-54", age: 53, race: "Multiracial", ethnicity: "Not Hisp.", language: "Spanish", archetype: "Access barrier", clinician: "NE-C3", baseline: 18, followUp: 16, safety: "No active gate" },
  { id: "ST-NE-040", region: "NE", state: "MA", ageBand: "45-54", age: 54, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Safety pause", clinician: "NE-C1", baseline: 9, followUp: 6, safety: "Fixed pause" },
  { id: "ST-NE-041", region: "NE", state: "CT", ageBand: "55-64", age: 55, race: "White", ethnicity: "Hisp.", language: "Spanish", archetype: "Early response", clinician: "NE-C2", baseline: 19, followUp: 13, safety: "No active gate" },
  { id: "ST-NE-042", region: "NE", state: "ME", ageBand: "55-64", age: 56, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Steady response", clinician: "NE-C3", baseline: 10, followUp: 4, safety: "No active gate" },
  { id: "ST-NE-043", region: "NE", state: "MA", ageBand: "55-64", age: 57, race: "AIAN", ethnicity: "Not Hisp.", language: "Mandarin", archetype: "Late response", clinician: "NE-C1", baseline: 17, followUp: 13, safety: "No active gate" },
  { id: "ST-NE-044", region: "NE", state: "NY", ageBand: "55-64", age: 58, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "No change", clinician: "NE-C2", baseline: 8, followUp: 9, safety: "No active gate" },
  { id: "ST-NE-045", region: "NE", state: "PA", ageBand: "55-64", age: 59, race: "Black", ethnicity: "Hisp.", language: "English", archetype: "Sporadic use", clinician: "NE-C3", baseline: 15, followUp: 12, safety: "No active gate" },
  { id: "ST-NE-046", region: "NE", state: "NJ", ageBand: "55-64", age: 60, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "Module mismatch", clinician: "NE-C1", baseline: 22, followUp: 21, safety: "No active gate" },
  { id: "ST-NE-047", region: "NE", state: "CT", ageBand: "55-64", age: 61, race: "White", ethnicity: "Not Hisp.", language: "Spanish", archetype: "Access barrier", clinician: "NE-C2", baseline: 13, followUp: 13, safety: "No active gate" },
  { id: "ST-NE-048", region: "NE", state: "ME", ageBand: "55-64", age: 62, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Safety pause", clinician: "NE-C3", baseline: 20, followUp: 16, safety: "Fixed pause" },
  { id: "ST-NE-049", region: "NE", state: "MA", ageBand: "55-64", age: 63, race: "AIAN", ethnicity: "Hisp.", language: "Mandarin", archetype: "Early response", clinician: "NE-C1", baseline: 11, followUp: 4, safety: "No active gate" },
  { id: "ST-NE-050", region: "NE", state: "NY", ageBand: "55-64", age: 64, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Steady response", clinician: "NE-C2", baseline: 18, followUp: 14, safety: "No active gate" },
  { id: "ST-NE-051", region: "NE", state: "ME", ageBand: "65+", age: 65, race: "Multiracial", ethnicity: "Not Hisp.", language: "Mandarin", archetype: "Late response", clinician: "NE-C3", baseline: 12, followUp: 7, safety: "Review event" },
  { id: "ST-NE-052", region: "NE", state: "MA", ageBand: "65+", age: 66, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "No change", clinician: "NE-C1", baseline: 19, followUp: 19, safety: "No active gate" },
  { id: "ST-NE-053", region: "NE", state: "NY", ageBand: "65+", age: 67, race: "Asian", ethnicity: "Hisp.", language: "English", archetype: "Sporadic use", clinician: "NE-C2", baseline: 10, followUp: 9, safety: "No active gate" },
  { id: "ST-NE-054", region: "NE", state: "PA", ageBand: "65+", age: 68, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "Module mismatch", clinician: "NE-C3", baseline: 17, followUp: 15, safety: "No active gate" },
  { id: "ST-NE-055", region: "NE", state: "NJ", ageBand: "65+", age: 69, race: "NHPI", ethnicity: "Not Hisp.", language: "Spanish", archetype: "Access barrier", clinician: "NE-C1", baseline: 8, followUp: 7, safety: "No active gate" },
  { id: "ST-NE-056", region: "NE", state: "CT", ageBand: "65+", age: 70, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "Safety pause", clinician: "NE-C2", baseline: 15, followUp: 13, safety: "Fixed pause" },
  { id: "ST-NE-057", region: "NE", state: "ME", ageBand: "65+", age: 71, race: "Multiracial", ethnicity: "Hisp.", language: "Mandarin", archetype: "Early response", clinician: "NE-C3", baseline: 22, followUp: 14, safety: "No active gate" },
  { id: "ST-NE-058", region: "NE", state: "MA", ageBand: "65+", age: 65, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Steady response", clinician: "NE-C1", baseline: 13, followUp: 8, safety: "No active gate" },
  { id: "ST-NE-059", region: "NE", state: "NY", ageBand: "65+", age: 66, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Late response", clinician: "NE-C2", baseline: 20, followUp: 17, safety: "No active gate" },
  { id: "ST-NE-060", region: "NE", state: "PA", ageBand: "65+", age: 67, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "No change", clinician: "NE-C3", baseline: 11, followUp: 10, safety: "No active gate" },

  // ── MW ──────────────────────────────────────────────────────────
  { id: "ST-MW-001", region: "MW", state: "IL", ageBand: "18-24", age: 18, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Sporadic use", clinician: "MW-C1", baseline: 19, followUp: 17, safety: "No active gate" },
  { id: "ST-MW-002", region: "MW", state: "OH", ageBand: "18-24", age: 19, race: "Black", ethnicity: "Not Hisp.", language: "Spanish", archetype: "Module mismatch", clinician: "MW-C2", baseline: 10, followUp: 10, safety: "No active gate" },
  { id: "ST-MW-003", region: "MW", state: "MI", ageBand: "18-24", age: 20, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "Access barrier", clinician: "MW-C3", baseline: 17, followUp: 15, safety: "No active gate" },
  { id: "ST-MW-004", region: "MW", state: "MN", ageBand: "18-24", age: 21, race: "White", ethnicity: "Hisp.", language: "Mandarin", archetype: "Safety pause", clinician: "MW-C1", baseline: 8, followUp: 5, safety: "Fixed pause" },
  { id: "ST-MW-005", region: "MW", state: "MO", ageBand: "18-24", age: 22, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Early response", clinician: "MW-C2", baseline: 15, followUp: 9, safety: "No active gate" },
  { id: "ST-MW-006", region: "MW", state: "WI", ageBand: "18-24", age: 23, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Steady response", clinician: "MW-C3", baseline: 22, followUp: 16, safety: "No active gate" },
  { id: "ST-MW-007", region: "MW", state: "IL", ageBand: "18-24", age: 24, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Late response", clinician: "MW-C1", baseline: 13, followUp: 9, safety: "No active gate" },
  { id: "ST-MW-008", region: "MW", state: "OH", ageBand: "18-24", age: 18, race: "Black", ethnicity: "Hisp.", language: "Spanish", archetype: "No change", clinician: "MW-C2", baseline: 20, followUp: 21, safety: "Review event" },
  { id: "ST-MW-009", region: "MW", state: "MI", ageBand: "18-24", age: 19, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "Sporadic use", clinician: "MW-C3", baseline: 11, followUp: 8, safety: "No active gate" },
  { id: "ST-MW-010", region: "MW", state: "MN", ageBand: "18-24", age: 20, race: "White", ethnicity: "Not Hisp.", language: "Mandarin", archetype: "Module mismatch", clinician: "MW-C1", baseline: 18, followUp: 17, safety: "No active gate" },
  { id: "ST-MW-011", region: "MW", state: "OH", ageBand: "25-34", age: 25, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "Access barrier", clinician: "MW-C2", baseline: 12, followUp: 12, safety: "No active gate" },
  { id: "ST-MW-012", region: "MW", state: "MI", ageBand: "25-34", age: 26, race: "NHPI", ethnicity: "Hisp.", language: "Mandarin", archetype: "Safety pause", clinician: "MW-C3", baseline: 19, followUp: 15, safety: "Fixed pause" },
  { id: "ST-MW-013", region: "MW", state: "MN", ageBand: "25-34", age: 27, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "Early response", clinician: "MW-C1", baseline: 10, followUp: 3, safety: "No active gate" },
  { id: "ST-MW-014", region: "MW", state: "MO", ageBand: "25-34", age: 28, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Steady response", clinician: "MW-C2", baseline: 17, followUp: 13, safety: "No active gate" },
  { id: "ST-MW-015", region: "MW", state: "WI", ageBand: "25-34", age: 29, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Late response", clinician: "MW-C3", baseline: 8, followUp: 3, safety: "No active gate" },
  { id: "ST-MW-016", region: "MW", state: "IL", ageBand: "25-34", age: 30, race: "Asian", ethnicity: "Hisp.", language: "Spanish", archetype: "No change", clinician: "MW-C1", baseline: 15, followUp: 15, safety: "No active gate" },
  { id: "ST-MW-017", region: "MW", state: "OH", ageBand: "25-34", age: 31, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "Sporadic use", clinician: "MW-C2", baseline: 22, followUp: 21, safety: "No active gate" },
  { id: "ST-MW-018", region: "MW", state: "MI", ageBand: "25-34", age: 32, race: "NHPI", ethnicity: "Not Hisp.", language: "Mandarin", archetype: "Module mismatch", clinician: "MW-C3", baseline: 13, followUp: 11, safety: "No active gate" },
  { id: "ST-MW-019", region: "MW", state: "MN", ageBand: "25-34", age: 33, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "Access barrier", clinician: "MW-C1", baseline: 20, followUp: 19, safety: "No active gate" },
  { id: "ST-MW-020", region: "MW", state: "MO", ageBand: "25-34", age: 34, race: "Multiracial", ethnicity: "Hisp.", language: "English", archetype: "Safety pause", clinician: "MW-C2", baseline: 11, followUp: 9, safety: "Fixed pause" },
  { id: "ST-MW-021", region: "MW", state: "MI", ageBand: "35-44", age: 35, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "Early response", clinician: "MW-C3", baseline: 21, followUp: 13, safety: "No active gate" },
  { id: "ST-MW-022", region: "MW", state: "MN", ageBand: "35-44", age: 36, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "Steady response", clinician: "MW-C1", baseline: 12, followUp: 7, safety: "No active gate" },
  { id: "ST-MW-023", region: "MW", state: "MO", ageBand: "35-44", age: 37, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Late response", clinician: "MW-C2", baseline: 19, followUp: 16, safety: "No active gate" },
  { id: "ST-MW-024", region: "MW", state: "WI", ageBand: "35-44", age: 38, race: "AIAN", ethnicity: "Hisp.", language: "Spanish", archetype: "No change", clinician: "MW-C3", baseline: 10, followUp: 9, safety: "No active gate" },
  { id: "ST-MW-025", region: "MW", state: "IL", ageBand: "35-44", age: 39, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Sporadic use", clinician: "MW-C1", baseline: 17, followUp: 15, safety: "Review event" },
  { id: "ST-MW-026", region: "MW", state: "OH", ageBand: "35-44", age: 40, race: "Black", ethnicity: "Not Hisp.", language: "Mandarin", archetype: "Module mismatch", clinician: "MW-C2", baseline: 8, followUp: 8, safety: "No active gate" },
  { id: "ST-MW-027", region: "MW", state: "MI", ageBand: "35-44", age: 41, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "Access barrier", clinician: "MW-C3", baseline: 15, followUp: 13, safety: "No active gate" },
  { id: "ST-MW-028", region: "MW", state: "MN", ageBand: "35-44", age: 42, race: "White", ethnicity: "Hisp.", language: "English", archetype: "Safety pause", clinician: "MW-C1", baseline: 22, followUp: 19, safety: "Fixed pause" },
  { id: "ST-MW-029", region: "MW", state: "MO", ageBand: "35-44", age: 43, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Early response", clinician: "MW-C2", baseline: 13, followUp: 7, safety: "No active gate" },
  { id: "ST-MW-030", region: "MW", state: "WI", ageBand: "35-44", age: 44, race: "AIAN", ethnicity: "Not Hisp.", language: "Spanish", archetype: "Steady response", clinician: "MW-C3", baseline: 20, followUp: 14, safety: "No active gate" },
  { id: "ST-MW-031", region: "MW", state: "MN", ageBand: "45-54", age: 45, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "Late response", clinician: "MW-C1", baseline: 14, followUp: 10, safety: "No active gate" },
  { id: "ST-MW-032", region: "MW", state: "MO", ageBand: "45-54", age: 46, race: "Multiracial", ethnicity: "Hisp.", language: "Spanish", archetype: "No change", clinician: "MW-C2", baseline: 21, followUp: 22, safety: "No active gate" },
  { id: "ST-MW-033", region: "MW", state: "WI", ageBand: "45-54", age: 47, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Sporadic use", clinician: "MW-C3", baseline: 12, followUp: 9, safety: "No active gate" },
  { id: "ST-MW-034", region: "MW", state: "IL", ageBand: "45-54", age: 48, race: "Asian", ethnicity: "Not Hisp.", language: "Mandarin", archetype: "Module mismatch", clinician: "MW-C1", baseline: 19, followUp: 18, safety: "No active gate" },
  { id: "ST-MW-035", region: "MW", state: "OH", ageBand: "45-54", age: 49, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "Access barrier", clinician: "MW-C2", baseline: 10, followUp: 10, safety: "No active gate" },
  { id: "ST-MW-036", region: "MW", state: "MI", ageBand: "45-54", age: 50, race: "NHPI", ethnicity: "Hisp.", language: "English", archetype: "Safety pause", clinician: "MW-C3", baseline: 17, followUp: 13, safety: "Fixed pause" },
  { id: "ST-MW-037", region: "MW", state: "MN", ageBand: "45-54", age: 51, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "Early response", clinician: "MW-C1", baseline: 8, followUp: 1, safety: "No active gate" },
  { id: "ST-MW-038", region: "MW", state: "MO", ageBand: "45-54", age: 52, race: "Multiracial", ethnicity: "Not Hisp.", language: "Spanish", archetype: "Steady response", clinician: "MW-C2", baseline: 15, followUp: 11, safety: "No active gate" },
  { id: "ST-MW-039", region: "MW", state: "WI", ageBand: "45-54", age: 53, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Late response", clinician: "MW-C3", baseline: 22, followUp: 17, safety: "No active gate" },
  { id: "ST-MW-040", region: "MW", state: "IL", ageBand: "45-54", age: 54, race: "Asian", ethnicity: "Hisp.", language: "Mandarin", archetype: "No change", clinician: "MW-C1", baseline: 13, followUp: 13, safety: "No active gate" },
  { id: "ST-MW-041", region: "MW", state: "MO", ageBand: "55-64", age: 55, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Sporadic use", clinician: "MW-C2", baseline: 23, followUp: 22, safety: "No active gate" },
  { id: "ST-MW-042", region: "MW", state: "WI", ageBand: "55-64", age: 56, race: "AIAN", ethnicity: "Not Hisp.", language: "Mandarin", archetype: "Module mismatch", clinician: "MW-C3", baseline: 14, followUp: 12, safety: "Review event" },
  { id: "ST-MW-043", region: "MW", state: "IL", ageBand: "55-64", age: 57, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Access barrier", clinician: "MW-C1", baseline: 21, followUp: 20, safety: "No active gate" },
  { id: "ST-MW-044", region: "MW", state: "OH", ageBand: "55-64", age: 58, race: "Black", ethnicity: "Hisp.", language: "English", archetype: "Safety pause", clinician: "MW-C2", baseline: 12, followUp: 10, safety: "Fixed pause" },
  { id: "ST-MW-045", region: "MW", state: "MI", ageBand: "55-64", age: 59, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "Early response", clinician: "MW-C3", baseline: 19, followUp: 11, safety: "No active gate" },
  { id: "ST-MW-046", region: "MW", state: "MN", ageBand: "55-64", age: 60, race: "White", ethnicity: "Not Hisp.", language: "Spanish", archetype: "Steady response", clinician: "MW-C1", baseline: 10, followUp: 5, safety: "No active gate" },
  { id: "ST-MW-047", region: "MW", state: "MO", ageBand: "55-64", age: 61, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Late response", clinician: "MW-C2", baseline: 17, followUp: 14, safety: "No active gate" },
  { id: "ST-MW-048", region: "MW", state: "WI", ageBand: "55-64", age: 62, race: "AIAN", ethnicity: "Hisp.", language: "Mandarin", archetype: "No change", clinician: "MW-C3", baseline: 8, followUp: 7, safety: "No active gate" },
  { id: "ST-MW-049", region: "MW", state: "IL", ageBand: "55-64", age: 63, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Sporadic use", clinician: "MW-C1", baseline: 15, followUp: 13, safety: "No active gate" },
  { id: "ST-MW-050", region: "MW", state: "OH", ageBand: "55-64", age: 64, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "Module mismatch", clinician: "MW-C2", baseline: 22, followUp: 22, safety: "No active gate" },
  { id: "ST-MW-051", region: "MW", state: "WI", ageBand: "65+", age: 65, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Access barrier", clinician: "MW-C3", baseline: 16, followUp: 14, safety: "No active gate" },
  { id: "ST-MW-052", region: "MW", state: "IL", ageBand: "65+", age: 66, race: "Asian", ethnicity: "Hisp.", language: "English", archetype: "Safety pause", clinician: "MW-C1", baseline: 23, followUp: 20, safety: "Fixed pause" },
  { id: "ST-MW-053", region: "MW", state: "OH", ageBand: "65+", age: 67, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "Early response", clinician: "MW-C2", baseline: 14, followUp: 8, safety: "No active gate" },
  { id: "ST-MW-054", region: "MW", state: "MI", ageBand: "65+", age: 68, race: "NHPI", ethnicity: "Not Hisp.", language: "Spanish", archetype: "Steady response", clinician: "MW-C3", baseline: 21, followUp: 15, safety: "No active gate" },
  { id: "ST-MW-055", region: "MW", state: "MN", ageBand: "65+", age: 69, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "Late response", clinician: "MW-C1", baseline: 12, followUp: 8, safety: "No active gate" },
  { id: "ST-MW-056", region: "MW", state: "MO", ageBand: "65+", age: 70, race: "Multiracial", ethnicity: "Hisp.", language: "Mandarin", archetype: "No change", clinician: "MW-C2", baseline: 19, followUp: 20, safety: "No active gate" },
  { id: "ST-MW-057", region: "MW", state: "WI", ageBand: "65+", age: 71, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Sporadic use", clinician: "MW-C3", baseline: 10, followUp: 7, safety: "No active gate" },
  { id: "ST-MW-058", region: "MW", state: "IL", ageBand: "65+", age: 65, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Module mismatch", clinician: "MW-C1", baseline: 17, followUp: 16, safety: "No active gate" },
  { id: "ST-MW-059", region: "MW", state: "OH", ageBand: "65+", age: 66, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "Access barrier", clinician: "MW-C2", baseline: 8, followUp: 8, safety: "Review event" },
  { id: "ST-MW-060", region: "MW", state: "MI", ageBand: "65+", age: 67, race: "NHPI", ethnicity: "Hisp.", language: "Spanish", archetype: "Safety pause", clinician: "MW-C3", baseline: 15, followUp: 11, safety: "Fixed pause" },

  // ── SO ──────────────────────────────────────────────────────────
  { id: "ST-SO-001", region: "SO", state: "TX", ageBand: "18-24", age: 18, race: "Black", ethnicity: "Not Hisp.", language: "Spanish", archetype: "Early response", clinician: "SO-C1", baseline: 23, followUp: 16, safety: "No active gate" },
  { id: "ST-SO-002", region: "SO", state: "FL", ageBand: "18-24", age: 19, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "Steady response", clinician: "SO-C2", baseline: 14, followUp: 10, safety: "No active gate" },
  { id: "ST-SO-003", region: "SO", state: "GA", ageBand: "18-24", age: 20, race: "White", ethnicity: "Hisp.", language: "Mandarin", archetype: "Late response", clinician: "SO-C3", baseline: 21, followUp: 16, safety: "No active gate" },
  { id: "ST-SO-004", region: "SO", state: "NC", ageBand: "18-24", age: 21, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "No change", clinician: "SO-C1", baseline: 12, followUp: 12, safety: "No active gate" },
  { id: "ST-SO-005", region: "SO", state: "VA", ageBand: "18-24", age: 22, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Sporadic use", clinician: "SO-C2", baseline: 19, followUp: 18, safety: "No active gate" },
  { id: "ST-SO-006", region: "SO", state: "TN", ageBand: "18-24", age: 23, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Module mismatch", clinician: "SO-C3", baseline: 10, followUp: 8, safety: "No active gate" },
  { id: "ST-SO-007", region: "SO", state: "TX", ageBand: "18-24", age: 24, race: "Black", ethnicity: "Hisp.", language: "Spanish", archetype: "Access barrier", clinician: "SO-C1", baseline: 17, followUp: 16, safety: "No active gate" },
  { id: "ST-SO-008", region: "SO", state: "FL", ageBand: "18-24", age: 18, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "Safety pause", clinician: "SO-C2", baseline: 8, followUp: 6, safety: "Fixed pause" },
  { id: "ST-SO-009", region: "SO", state: "GA", ageBand: "18-24", age: 19, race: "White", ethnicity: "Not Hisp.", language: "Mandarin", archetype: "Early response", clinician: "SO-C3", baseline: 15, followUp: 7, safety: "No active gate" },
  { id: "ST-SO-010", region: "SO", state: "NC", ageBand: "18-24", age: 20, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Steady response", clinician: "SO-C1", baseline: 22, followUp: 17, safety: "No active gate" },
  { id: "ST-SO-011", region: "SO", state: "FL", ageBand: "25-34", age: 25, race: "NHPI", ethnicity: "Hisp.", language: "Mandarin", archetype: "Late response", clinician: "SO-C2", baseline: 16, followUp: 13, safety: "No active gate" },
  { id: "ST-SO-012", region: "SO", state: "GA", ageBand: "25-34", age: 26, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "No change", clinician: "SO-C3", baseline: 23, followUp: 22, safety: "No active gate" },
  { id: "ST-SO-013", region: "SO", state: "NC", ageBand: "25-34", age: 27, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Sporadic use", clinician: "SO-C1", baseline: 14, followUp: 12, safety: "No active gate" },
  { id: "ST-SO-014", region: "SO", state: "VA", ageBand: "25-34", age: 28, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Module mismatch", clinician: "SO-C2", baseline: 21, followUp: 21, safety: "No active gate" },
  { id: "ST-SO-015", region: "SO", state: "TN", ageBand: "25-34", age: 29, race: "Asian", ethnicity: "Hisp.", language: "Spanish", archetype: "Access barrier", clinician: "SO-C3", baseline: 12, followUp: 10, safety: "No active gate" },
  { id: "ST-SO-016", region: "SO", state: "TX", ageBand: "25-34", age: 30, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "Safety pause", clinician: "SO-C1", baseline: 19, followUp: 16, safety: "Fixed pause" },
  { id: "ST-SO-017", region: "SO", state: "FL", ageBand: "25-34", age: 31, race: "NHPI", ethnicity: "Not Hisp.", language: "Mandarin", archetype: "Early response", clinician: "SO-C2", baseline: 10, followUp: 4, safety: "No active gate" },
  { id: "ST-SO-018", region: "SO", state: "GA", ageBand: "25-34", age: 32, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "Steady response", clinician: "SO-C3", baseline: 17, followUp: 11, safety: "No active gate" },
  { id: "ST-SO-019", region: "SO", state: "NC", ageBand: "25-34", age: 33, race: "Multiracial", ethnicity: "Hisp.", language: "English", archetype: "Late response", clinician: "SO-C1", baseline: 8, followUp: 4, safety: "No active gate" },
  { id: "ST-SO-020", region: "SO", state: "VA", ageBand: "25-34", age: 34, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "No change", clinician: "SO-C2", baseline: 15, followUp: 16, safety: "No active gate" },
  { id: "ST-SO-021", region: "SO", state: "GA", ageBand: "35-44", age: 35, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "Sporadic use", clinician: "SO-C3", baseline: 9, followUp: 6, safety: "No active gate" },
  { id: "ST-SO-022", region: "SO", state: "NC", ageBand: "35-44", age: 36, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Module mismatch", clinician: "SO-C1", baseline: 16, followUp: 15, safety: "No active gate" },
  { id: "ST-SO-023", region: "SO", state: "VA", ageBand: "35-44", age: 37, race: "AIAN", ethnicity: "Hisp.", language: "Spanish", archetype: "Access barrier", clinician: "SO-C2", baseline: 23, followUp: 23, safety: "No active gate" },
  { id: "ST-SO-024", region: "SO", state: "TN", ageBand: "35-44", age: 38, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Safety pause", clinician: "SO-C3", baseline: 14, followUp: 10, safety: "Fixed pause" },
  { id: "ST-SO-025", region: "SO", state: "TX", ageBand: "35-44", age: 39, race: "Black", ethnicity: "Not Hisp.", language: "Mandarin", archetype: "Early response", clinician: "SO-C1", baseline: 21, followUp: 14, safety: "No active gate" },
  { id: "ST-SO-026", region: "SO", state: "FL", ageBand: "35-44", age: 40, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "Steady response", clinician: "SO-C2", baseline: 12, followUp: 8, safety: "No active gate" },
  { id: "ST-SO-027", region: "SO", state: "GA", ageBand: "35-44", age: 41, race: "White", ethnicity: "Hisp.", language: "English", archetype: "Late response", clinician: "SO-C3", baseline: 19, followUp: 14, safety: "No active gate" },
  { id: "ST-SO-028", region: "SO", state: "NC", ageBand: "35-44", age: 42, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "No change", clinician: "SO-C1", baseline: 10, followUp: 10, safety: "No active gate" },
  { id: "ST-SO-029", region: "SO", state: "VA", ageBand: "35-44", age: 43, race: "AIAN", ethnicity: "Not Hisp.", language: "Spanish", archetype: "Sporadic use", clinician: "SO-C2", baseline: 17, followUp: 16, safety: "No active gate" },
  { id: "ST-SO-030", region: "SO", state: "TN", ageBand: "35-44", age: 44, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Module mismatch", clinician: "SO-C3", baseline: 8, followUp: 6, safety: "No active gate" },
  { id: "ST-SO-031", region: "SO", state: "NC", ageBand: "45-54", age: 45, race: "Multiracial", ethnicity: "Hisp.", language: "Spanish", archetype: "Access barrier", clinician: "SO-C1", baseline: 18, followUp: 17, safety: "No active gate" },
  { id: "ST-SO-032", region: "SO", state: "VA", ageBand: "45-54", age: 46, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Safety pause", clinician: "SO-C2", baseline: 9, followUp: 7, safety: "Fixed pause" },
  { id: "ST-SO-033", region: "SO", state: "TN", ageBand: "45-54", age: 47, race: "Asian", ethnicity: "Not Hisp.", language: "Mandarin", archetype: "Early response", clinician: "SO-C3", baseline: 16, followUp: 8, safety: "Review event" },
  { id: "ST-SO-034", region: "SO", state: "TX", ageBand: "45-54", age: 48, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "Steady response", clinician: "SO-C1", baseline: 23, followUp: 18, safety: "No active gate" },
  { id: "ST-SO-035", region: "SO", state: "FL", ageBand: "45-54", age: 49, race: "NHPI", ethnicity: "Hisp.", language: "English", archetype: "Late response", clinician: "SO-C2", baseline: 14, followUp: 11, safety: "No active gate" },
  { id: "ST-SO-036", region: "SO", state: "GA", ageBand: "45-54", age: 50, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "No change", clinician: "SO-C3", baseline: 21, followUp: 20, safety: "No active gate" },
  { id: "ST-SO-037", region: "SO", state: "NC", ageBand: "45-54", age: 51, race: "Multiracial", ethnicity: "Not Hisp.", language: "Spanish", archetype: "Sporadic use", clinician: "SO-C1", baseline: 12, followUp: 10, safety: "No active gate" },
  { id: "ST-SO-038", region: "SO", state: "VA", ageBand: "45-54", age: 52, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Module mismatch", clinician: "SO-C2", baseline: 19, followUp: 19, safety: "No active gate" },
  { id: "ST-SO-039", region: "SO", state: "TN", ageBand: "45-54", age: 53, race: "Asian", ethnicity: "Hisp.", language: "Mandarin", archetype: "Access barrier", clinician: "SO-C3", baseline: 10, followUp: 8, safety: "No active gate" },
  { id: "ST-SO-040", region: "SO", state: "TX", ageBand: "45-54", age: 54, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "Safety pause", clinician: "SO-C1", baseline: 17, followUp: 14, safety: "Fixed pause" },
  { id: "ST-SO-041", region: "SO", state: "VA", ageBand: "55-64", age: 55, race: "AIAN", ethnicity: "Not Hisp.", language: "Mandarin", archetype: "Early response", clinician: "SO-C2", baseline: 11, followUp: 5, safety: "No active gate" },
  { id: "ST-SO-042", region: "SO", state: "TN", ageBand: "55-64", age: 56, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Steady response", clinician: "SO-C3", baseline: 18, followUp: 12, safety: "No active gate" },
  { id: "ST-SO-043", region: "SO", state: "TX", ageBand: "55-64", age: 57, race: "Black", ethnicity: "Hisp.", language: "English", archetype: "Late response", clinician: "SO-C1", baseline: 9, followUp: 5, safety: "No active gate" },
  { id: "ST-SO-044", region: "SO", state: "FL", ageBand: "55-64", age: 58, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "No change", clinician: "SO-C2", baseline: 16, followUp: 17, safety: "No active gate" },
  { id: "ST-SO-045", region: "SO", state: "GA", ageBand: "55-64", age: 59, race: "White", ethnicity: "Not Hisp.", language: "Spanish", archetype: "Sporadic use", clinician: "SO-C3", baseline: 23, followUp: 20, safety: "No active gate" },
  { id: "ST-SO-046", region: "SO", state: "NC", ageBand: "55-64", age: 60, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Module mismatch", clinician: "SO-C1", baseline: 14, followUp: 13, safety: "No active gate" },
  { id: "ST-SO-047", region: "SO", state: "VA", ageBand: "55-64", age: 61, race: "AIAN", ethnicity: "Hisp.", language: "Mandarin", archetype: "Access barrier", clinician: "SO-C2", baseline: 21, followUp: 21, safety: "No active gate" },
  { id: "ST-SO-048", region: "SO", state: "TN", ageBand: "55-64", age: 62, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Safety pause", clinician: "SO-C3", baseline: 12, followUp: 8, safety: "Fixed pause" },
  { id: "ST-SO-049", region: "SO", state: "TX", ageBand: "55-64", age: 63, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "Early response", clinician: "SO-C1", baseline: 19, followUp: 12, safety: "No active gate" },
  { id: "ST-SO-050", region: "SO", state: "FL", ageBand: "55-64", age: 64, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "Steady response", clinician: "SO-C2", baseline: 10, followUp: 6, safety: "Review event" },
  { id: "ST-SO-051", region: "SO", state: "TN", ageBand: "65+", age: 65, race: "Asian", ethnicity: "Hisp.", language: "English", archetype: "Late response", clinician: "SO-C3", baseline: 20, followUp: 15, safety: "No active gate" },
  { id: "ST-SO-052", region: "SO", state: "TX", ageBand: "65+", age: 66, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "No change", clinician: "SO-C1", baseline: 11, followUp: 11, safety: "No active gate" },
  { id: "ST-SO-053", region: "SO", state: "FL", ageBand: "65+", age: 67, race: "NHPI", ethnicity: "Not Hisp.", language: "Spanish", archetype: "Sporadic use", clinician: "SO-C2", baseline: 18, followUp: 17, safety: "No active gate" },
  { id: "ST-SO-054", region: "SO", state: "GA", ageBand: "65+", age: 68, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "Module mismatch", clinician: "SO-C3", baseline: 9, followUp: 7, safety: "No active gate" },
  { id: "ST-SO-055", region: "SO", state: "NC", ageBand: "65+", age: 69, race: "Multiracial", ethnicity: "Hisp.", language: "Mandarin", archetype: "Access barrier", clinician: "SO-C1", baseline: 16, followUp: 15, safety: "No active gate" },
  { id: "ST-SO-056", region: "SO", state: "VA", ageBand: "65+", age: 70, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Safety pause", clinician: "SO-C2", baseline: 23, followUp: 21, safety: "Fixed pause" },
  { id: "ST-SO-057", region: "SO", state: "TN", ageBand: "65+", age: 71, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Early response", clinician: "SO-C3", baseline: 14, followUp: 6, safety: "No active gate" },
  { id: "ST-SO-058", region: "SO", state: "TX", ageBand: "65+", age: 65, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "Steady response", clinician: "SO-C1", baseline: 21, followUp: 16, safety: "No active gate" },
  { id: "ST-SO-059", region: "SO", state: "FL", ageBand: "65+", age: 66, race: "NHPI", ethnicity: "Hisp.", language: "Spanish", archetype: "Late response", clinician: "SO-C2", baseline: 12, followUp: 9, safety: "No active gate" },
  { id: "ST-SO-060", region: "SO", state: "GA", ageBand: "65+", age: 67, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "No change", clinician: "SO-C3", baseline: 19, followUp: 18, safety: "No active gate" },

  // ── WE ──────────────────────────────────────────────────────────
  { id: "ST-WE-001", region: "WE", state: "AZ", ageBand: "18-24", age: 18, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "Sporadic use", clinician: "WE-C1", baseline: 11, followUp: 9, safety: "No active gate" },
  { id: "ST-WE-002", region: "WE", state: "CA", ageBand: "18-24", age: 19, race: "White", ethnicity: "Hisp.", language: "Mandarin", archetype: "Module mismatch", clinician: "WE-C2", baseline: 18, followUp: 18, safety: "No active gate" },
  { id: "ST-WE-003", region: "WE", state: "CO", ageBand: "18-24", age: 20, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Access barrier", clinician: "WE-C3", baseline: 9, followUp: 7, safety: "No active gate" },
  { id: "ST-WE-004", region: "WE", state: "WA", ageBand: "18-24", age: 21, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Safety pause", clinician: "WE-C1", baseline: 16, followUp: 13, safety: "Fixed pause" },
  { id: "ST-WE-005", region: "WE", state: "OR", ageBand: "18-24", age: 22, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Early response", clinician: "WE-C2", baseline: 23, followUp: 17, safety: "No active gate" },
  { id: "ST-WE-006", region: "WE", state: "NV", ageBand: "18-24", age: 23, race: "Black", ethnicity: "Hisp.", language: "Spanish", archetype: "Steady response", clinician: "WE-C3", baseline: 14, followUp: 8, safety: "No active gate" },
  { id: "ST-WE-007", region: "WE", state: "AZ", ageBand: "18-24", age: 24, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "Late response", clinician: "WE-C1", baseline: 21, followUp: 17, safety: "Review event" },
  { id: "ST-WE-008", region: "WE", state: "CA", ageBand: "18-24", age: 18, race: "White", ethnicity: "Not Hisp.", language: "Mandarin", archetype: "No change", clinician: "WE-C2", baseline: 12, followUp: 13, safety: "No active gate" },
  { id: "ST-WE-009", region: "WE", state: "CO", ageBand: "18-24", age: 19, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Sporadic use", clinician: "WE-C3", baseline: 19, followUp: 16, safety: "No active gate" },
  { id: "ST-WE-010", region: "WE", state: "WA", ageBand: "18-24", age: 20, race: "AIAN", ethnicity: "Hisp.", language: "English", archetype: "Module mismatch", clinician: "WE-C1", baseline: 10, followUp: 9, safety: "No active gate" },
  { id: "ST-WE-011", region: "WE", state: "CA", ageBand: "25-34", age: 25, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "Access barrier", clinician: "WE-C2", baseline: 20, followUp: 20, safety: "No active gate" },
  { id: "ST-WE-012", region: "WE", state: "CO", ageBand: "25-34", age: 26, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Safety pause", clinician: "WE-C3", baseline: 11, followUp: 7, safety: "Fixed pause" },
  { id: "ST-WE-013", region: "WE", state: "WA", ageBand: "25-34", age: 27, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Early response", clinician: "WE-C1", baseline: 18, followUp: 11, safety: "No active gate" },
  { id: "ST-WE-014", region: "WE", state: "OR", ageBand: "25-34", age: 28, race: "Asian", ethnicity: "Hisp.", language: "Spanish", archetype: "Steady response", clinician: "WE-C2", baseline: 9, followUp: 5, safety: "No active gate" },
  { id: "ST-WE-015", region: "WE", state: "NV", ageBand: "25-34", age: 29, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "Late response", clinician: "WE-C3", baseline: 16, followUp: 11, safety: "No active gate" },
  { id: "ST-WE-016", region: "WE", state: "AZ", ageBand: "25-34", age: 30, race: "NHPI", ethnicity: "Not Hisp.", language: "Mandarin", archetype: "No change", clinician: "WE-C1", baseline: 23, followUp: 23, safety: "No active gate" },
  { id: "ST-WE-017", region: "WE", state: "CA", ageBand: "25-34", age: 31, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "Sporadic use", clinician: "WE-C2", baseline: 14, followUp: 13, safety: "No active gate" },
  { id: "ST-WE-018", region: "WE", state: "CO", ageBand: "25-34", age: 32, race: "Multiracial", ethnicity: "Hisp.", language: "English", archetype: "Module mismatch", clinician: "WE-C3", baseline: 21, followUp: 19, safety: "No active gate" },
  { id: "ST-WE-019", region: "WE", state: "WA", ageBand: "25-34", age: 33, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Access barrier", clinician: "WE-C1", baseline: 12, followUp: 11, safety: "No active gate" },
  { id: "ST-WE-020", region: "WE", state: "OR", ageBand: "25-34", age: 34, race: "Asian", ethnicity: "Not Hisp.", language: "Spanish", archetype: "Safety pause", clinician: "WE-C2", baseline: 19, followUp: 17, safety: "Fixed pause" },
  { id: "ST-WE-021", region: "WE", state: "CO", ageBand: "35-44", age: 35, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Early response", clinician: "WE-C3", baseline: 13, followUp: 5, safety: "No active gate" },
  { id: "ST-WE-022", region: "WE", state: "WA", ageBand: "35-44", age: 36, race: "AIAN", ethnicity: "Hisp.", language: "Spanish", archetype: "Steady response", clinician: "WE-C1", baseline: 20, followUp: 15, safety: "No active gate" },
  { id: "ST-WE-023", region: "WE", state: "OR", ageBand: "35-44", age: 37, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Late response", clinician: "WE-C2", baseline: 11, followUp: 8, safety: "No active gate" },
  { id: "ST-WE-024", region: "WE", state: "NV", ageBand: "35-44", age: 38, race: "Black", ethnicity: "Not Hisp.", language: "Mandarin", archetype: "No change", clinician: "WE-C3", baseline: 18, followUp: 17, safety: "Review event" },
  { id: "ST-WE-025", region: "WE", state: "AZ", ageBand: "35-44", age: 39, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "Sporadic use", clinician: "WE-C1", baseline: 9, followUp: 7, safety: "No active gate" },
  { id: "ST-WE-026", region: "WE", state: "CA", ageBand: "35-44", age: 40, race: "White", ethnicity: "Hisp.", language: "English", archetype: "Module mismatch", clinician: "WE-C2", baseline: 16, followUp: 16, safety: "No active gate" },
  { id: "ST-WE-027", region: "WE", state: "CO", ageBand: "35-44", age: 41, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Access barrier", clinician: "WE-C3", baseline: 23, followUp: 21, safety: "No active gate" },
  { id: "ST-WE-028", region: "WE", state: "WA", ageBand: "35-44", age: 42, race: "AIAN", ethnicity: "Not Hisp.", language: "Spanish", archetype: "Safety pause", clinician: "WE-C1", baseline: 14, followUp: 11, safety: "Fixed pause" },
  { id: "ST-WE-029", region: "WE", state: "OR", ageBand: "35-44", age: 43, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Early response", clinician: "WE-C2", baseline: 21, followUp: 15, safety: "No active gate" },
  { id: "ST-WE-030", region: "WE", state: "NV", ageBand: "35-44", age: 44, race: "Black", ethnicity: "Hisp.", language: "Mandarin", archetype: "Steady response", clinician: "WE-C3", baseline: 12, followUp: 6, safety: "No active gate" },
  { id: "ST-WE-031", region: "WE", state: "WA", ageBand: "45-54", age: 45, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Late response", clinician: "WE-C1", baseline: 22, followUp: 18, safety: "No active gate" },
  { id: "ST-WE-032", region: "WE", state: "OR", ageBand: "45-54", age: 46, race: "Asian", ethnicity: "Not Hisp.", language: "Mandarin", archetype: "No change", clinician: "WE-C2", baseline: 13, followUp: 14, safety: "No active gate" },
  { id: "ST-WE-033", region: "WE", state: "NV", ageBand: "45-54", age: 47, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "Sporadic use", clinician: "WE-C3", baseline: 20, followUp: 17, safety: "No active gate" },
  { id: "ST-WE-034", region: "WE", state: "AZ", ageBand: "45-54", age: 48, race: "NHPI", ethnicity: "Hisp.", language: "English", archetype: "Module mismatch", clinician: "WE-C1", baseline: 11, followUp: 10, safety: "No active gate" },
  { id: "ST-WE-035", region: "WE", state: "CA", ageBand: "45-54", age: 49, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "Access barrier", clinician: "WE-C2", baseline: 18, followUp: 18, safety: "No active gate" },
  { id: "ST-WE-036", region: "WE", state: "CO", ageBand: "45-54", age: 50, race: "Multiracial", ethnicity: "Not Hisp.", language: "Spanish", archetype: "Safety pause", clinician: "WE-C3", baseline: 9, followUp: 5, safety: "Fixed pause" },
  { id: "ST-WE-037", region: "WE", state: "WA", ageBand: "45-54", age: 51, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Early response", clinician: "WE-C1", baseline: 16, followUp: 9, safety: "No active gate" },
  { id: "ST-WE-038", region: "WE", state: "OR", ageBand: "45-54", age: 52, race: "Asian", ethnicity: "Hisp.", language: "Mandarin", archetype: "Steady response", clinician: "WE-C2", baseline: 23, followUp: 19, safety: "No active gate" },
  { id: "ST-WE-039", region: "WE", state: "NV", ageBand: "45-54", age: 53, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "Late response", clinician: "WE-C3", baseline: 14, followUp: 9, safety: "No active gate" },
  { id: "ST-WE-040", region: "WE", state: "AZ", ageBand: "45-54", age: 54, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "No change", clinician: "WE-C1", baseline: 21, followUp: 21, safety: "No active gate" },
  { id: "ST-WE-041", region: "WE", state: "OR", ageBand: "55-64", age: 55, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Sporadic use", clinician: "WE-C2", baseline: 15, followUp: 14, safety: "Review event" },
  { id: "ST-WE-042", region: "WE", state: "NV", ageBand: "55-64", age: 56, race: "Black", ethnicity: "Hisp.", language: "English", archetype: "Module mismatch", clinician: "WE-C3", baseline: 22, followUp: 20, safety: "No active gate" },
  { id: "ST-WE-043", region: "WE", state: "AZ", ageBand: "55-64", age: 57, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "Access barrier", clinician: "WE-C1", baseline: 13, followUp: 12, safety: "No active gate" },
  { id: "ST-WE-044", region: "WE", state: "CA", ageBand: "55-64", age: 58, race: "White", ethnicity: "Not Hisp.", language: "Spanish", archetype: "Safety pause", clinician: "WE-C2", baseline: 20, followUp: 18, safety: "Fixed pause" },
  { id: "ST-WE-045", region: "WE", state: "CO", ageBand: "55-64", age: 59, race: "Multiracial", ethnicity: "Not Hisp.", language: "English", archetype: "Early response", clinician: "WE-C3", baseline: 11, followUp: 3, safety: "No active gate" },
  { id: "ST-WE-046", region: "WE", state: "WA", ageBand: "55-64", age: 60, race: "AIAN", ethnicity: "Hisp.", language: "Mandarin", archetype: "Steady response", clinician: "WE-C1", baseline: 18, followUp: 13, safety: "No active gate" },
  { id: "ST-WE-047", region: "WE", state: "OR", ageBand: "55-64", age: 61, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "Late response", clinician: "WE-C2", baseline: 9, followUp: 6, safety: "No active gate" },
  { id: "ST-WE-048", region: "WE", state: "NV", ageBand: "55-64", age: 62, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "No change", clinician: "WE-C3", baseline: 16, followUp: 15, safety: "No active gate" },
  { id: "ST-WE-049", region: "WE", state: "AZ", ageBand: "55-64", age: 63, race: "NHPI", ethnicity: "Not Hisp.", language: "English", archetype: "Sporadic use", clinician: "WE-C1", baseline: 23, followUp: 21, safety: "No active gate" },
  { id: "ST-WE-050", region: "WE", state: "CA", ageBand: "55-64", age: 64, race: "White", ethnicity: "Hisp.", language: "Spanish", archetype: "Module mismatch", clinician: "WE-C2", baseline: 14, followUp: 14, safety: "No active gate" },
  { id: "ST-WE-051", region: "WE", state: "NV", ageBand: "65+", age: 65, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "Access barrier", clinician: "WE-C3", baseline: 8, followUp: 6, safety: "No active gate" },
  { id: "ST-WE-052", region: "WE", state: "AZ", ageBand: "65+", age: 66, race: "NHPI", ethnicity: "Not Hisp.", language: "Spanish", archetype: "Safety pause", clinician: "WE-C1", baseline: 15, followUp: 12, safety: "Fixed pause" },
  { id: "ST-WE-053", region: "WE", state: "CA", ageBand: "65+", age: 67, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "Early response", clinician: "WE-C2", baseline: 22, followUp: 16, safety: "No active gate" },
  { id: "ST-WE-054", region: "WE", state: "CO", ageBand: "65+", age: 68, race: "Multiracial", ethnicity: "Hisp.", language: "Mandarin", archetype: "Steady response", clinician: "WE-C3", baseline: 13, followUp: 7, safety: "No active gate" },
  { id: "ST-WE-055", region: "WE", state: "WA", ageBand: "65+", age: 69, race: "AIAN", ethnicity: "Not Hisp.", language: "English", archetype: "Late response", clinician: "WE-C1", baseline: 20, followUp: 16, safety: "No active gate" },
  { id: "ST-WE-056", region: "WE", state: "OR", ageBand: "65+", age: 70, race: "Asian", ethnicity: "Not Hisp.", language: "English", archetype: "No change", clinician: "WE-C2", baseline: 11, followUp: 12, safety: "No active gate" },
  { id: "ST-WE-057", region: "WE", state: "NV", ageBand: "65+", age: 71, race: "Black", ethnicity: "Not Hisp.", language: "English", archetype: "Sporadic use", clinician: "WE-C3", baseline: 18, followUp: 15, safety: "No active gate" },
  { id: "ST-WE-058", region: "WE", state: "AZ", ageBand: "65+", age: 65, race: "NHPI", ethnicity: "Hisp.", language: "Spanish", archetype: "Module mismatch", clinician: "WE-C1", baseline: 9, followUp: 8, safety: "Review event" },
  { id: "ST-WE-059", region: "WE", state: "CA", ageBand: "65+", age: 66, race: "White", ethnicity: "Not Hisp.", language: "English", archetype: "Access barrier", clinician: "WE-C2", baseline: 16, followUp: 16, safety: "No active gate" },
  { id: "ST-WE-060", region: "WE", state: "CO", ageBand: "65+", age: 67, race: "Multiracial", ethnicity: "Not Hisp.", language: "Mandarin", archetype: "Safety pause", clinician: "WE-C3", baseline: 23, followUp: 19, safety: "Fixed pause" },
];

// ---------------------------------------------------------------------------
// p29's data-quality manifest, the balance half
// ---------------------------------------------------------------------------

export interface CheckResult {
  check: string;
  expected: string;
  actual: string;
  pass: boolean;
}

/**
 * The balance checks from p29, computed from the rows rather than asserted
 * about them.
 *
 * Scoped to THIS dataset. p29 says "profile count: 240 exactly", and the
 * deployment holds 17,304 persons across the organization and payer
 * populations — so a check that counted `persons` would fail forever and be
 * switched off within a week. It counts the demo population, which is what the
 * line means.
 */
export function checkManifest(rows: ManifestRow[] = MANIFEST): CheckResult[] {
  const count = <T>(f: (r: ManifestRow) => T) => {
    const m = new Map<T, number>();
    for (const r of rows) m.set(f(r), (m.get(f(r)) ?? 0) + 1);
    return m;
  };
  const every = (m: Map<unknown, number>, n: number) =>
    [...m.values()].every((v) => v === n);

  const byRegion = count((r) => r.region);
  const byBand = count((r) => r.ageBand);
  const byArchetype = count((r) => r.archetype);
  const byRegionBand = count((r) => `${r.region}|${r.ageBand}`);
  const ids = new Set(rows.map((r) => r.id));

  const out: CheckResult[] = [
    {
      check: "Profile count",
      expected: "240 exactly",
      actual: String(rows.length),
      pass: rows.length === 240,
    },
    {
      check: "Regional count",
      expected: "60 in each of four regions",
      actual: [...byRegion].map(([k, v]) => `${k}:${v}`).join(" "),
      pass: byRegion.size === 4 && every(byRegion, 60),
    },
    {
      check: "Age count",
      expected: "40 in each of six bands; 10 per band per region",
      actual: `${byBand.size} bands, ${byRegionBand.size} region-band pairs`,
      pass: byBand.size === 6 && every(byBand, 40) &&
            byRegionBand.size === 24 && every(byRegionBand, 10),
    },
    {
      check: "Archetype count",
      expected: "30 in each of eight patterns",
      actual: `${byArchetype.size} patterns`,
      pass: byArchetype.size === 8 && every(byArchetype, 30),
    },
    {
      check: "Stable ids",
      expected: "240 distinct, deterministic within the dataset version",
      actual: `${ids.size} distinct`,
      pass: ids.size === rows.length,
    },
    {
      // Not in p29's list, and it belongs there. The archetype and the safety
      // column are two statements about the same person, and a manifest where
      // they disagree tells a story the projections cannot reproduce.
      check: "Safety consistency",
      expected: "every Safety pause archetype has a fixed pause, and no other archetype does",
      actual: describeSafetyMismatch(rows),
      pass: describeSafetyMismatch(rows) === "consistent",
    },
  ];
  return out;
}

function describeSafetyMismatch(rows: ManifestRow[]): string {
  const wrong = rows.filter(
    (r) => (r.archetype === "Safety pause") !== (r.safety === "Fixed pause"),
  );
  return wrong.length === 0 ? "consistent" : `${wrong.length} row(s): ${wrong.slice(0, 3).map((r) => r.id).join(", ")}`;
}
