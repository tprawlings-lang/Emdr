// Data scenarios (handoff 07 Wave 8, p9's "Inject data scenario" control).
//
// THE WORD MEANS TWO THINGS ON THE ADMIN SCREEN, and conflating them is how
// this control stayed unbuilt while looking built. Handoff 09 Package 4 shipped
// a scenario registry at `/demo/scenarios`: those are PRESENTATION scenarios —
// an order of screens and a set of claims, changing what a presenter shows.
// This is a DATA scenario: an event bundle that changes what the fabricated
// population has been through. Building the first did not build the second.
//
// WHAT A BUNDLE IS ALLOWED TO BE. p9: "Apply an approved, versioned event
// bundle such as a safety pause; reversible by reset." Four words carry the
// design:
//
//   APPROVED — the bundles are declared here, in code, reviewed like code.
//   There is no upload, no free-text event, and no way to compose one from a
//   form. An admin console that can write arbitrary events into a clinical
//   spine is a console that can fabricate a safety history.
//
//   VERSIONED — each carries its own version, and applying the same version
//   twice is refused rather than silently doubled. A demonstration where the
//   safety pause happened twice is not the demonstration anybody rehearsed.
//
//   EVENT BUNDLE — it appends to the spine and nothing else. It does not write
//   projections, does not touch a live table, and does not delete. The
//   projections are rebuilt from the events, which is the point of having a
//   spine at all, and it means a scenario cannot invent a state the replay
//   would not produce.
//
//   REVERSIBLE BY RESET — and reversible BY RESET ONLY. There is no undo here
//   on purpose. An undo that removed events would mutate history, which is the
//   one thing this spine refuses to do for anybody; reset already deletes and
//   rebuilds, so it is the reversal that exists. The applications table is in
//   DEMO_DATA_TABLES so that this is true rather than asserted, and a guard
//   holds it there.
//
// THE COHORT IS DECLARED, NEVER SEARCHED. A selector names manifest rows by a
// property the manifest already has. It cannot express "the ten people whose
// scores fell most", because a selector that reads outcomes could be tuned
// until the demonstration says what somebody wanted it to say — which is the
// failure this whole handoff's reproducibility gate exists to prevent.
//
// AND IT CANNOT REACH A REAL PERSON. Every target resolves through
// `popPersonId` over the manifest, so the set is fabricated by construction —
// and then checked anyway, because "by construction" is an argument and the
// stop condition deserves a check.

import { getDb, newId } from "../db";
import { audit } from "../audit";
import { appendEvent, isEventType, type ActorType, type EventType } from "../events";
import {
  MANIFEST, type Archetype, type ManifestRow, type Region, type SafetyState,
} from "../demo-population-manifest";
import { popPersonId } from "../demo-population-seed";

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/**
 * Which fabricated people a bundle applies to.
 *
 * Every field names a manifest column. Combining them narrows (AND), and
 * `limit` takes the first N in manifest order — manifest order, not a sort of
 * anything computed, so the same selector picks the same people on every
 * machine and after every reset.
 */
export interface CohortSelector {
  region?: Region;
  archetype?: Archetype;
  safety?: SafetyState;
  language?: ManifestRow["language"];
  /** Named rows, when a story needs specific people rather than a slice. */
  ids?: string[];
  /** First N in manifest order. Deterministic because the order is declared. */
  limit?: number;
}

export interface ScenarioEvent {
  type: EventType;
  /** How long before the moment of application this happened, in days. Zero is
   *  "now". Negative is refused: a bundle that writes the future puts an event
   *  in front of the clock and every window query reads it as not yet real. */
  daysAgo: number;
  actorType: ActorType;
  payload?: Record<string, unknown>;
}

export interface DataScenario {
  id: string;
  title: string;
  /** `<id>.<major>.<minor>.<patch>`. Applying the same version twice is refused. */
  version: string;
  /** Why a presenter would reach for this one. */
  purpose: string;
  /** What the dataset LOOKS LIKE afterwards, in the words a presenter would
   *  use to describe it out loud. Rendered on the console: an operator about to
   *  change what a population has been through should read the consequence
   *  before the control, not after. */
  whatChanges: string;
  cohort: CohortSelector;
  events: ScenarioEvent[];
}

/** The most people one bundle may touch.
 *
 *  A quarter of the population is a demonstration; the whole of it is a second
 *  dataset wearing the first one's name. The bound is here rather than in each
 *  bundle so that adding a bundle cannot quietly raise it. */
export const MAX_COHORT = 60;

// ---------------------------------------------------------------------------
// The bundles
// ---------------------------------------------------------------------------

/**
 * p9's own example: a safety pause.
 *
 * Chosen as the first bundle because it is the one a presenter is most likely
 * to want and the one most likely to be faked by hand if this control does not
 * exist. "Let me show you what happens when the safety engine holds somebody"
 * is a reasonable thing to want mid-demonstration, and the alternative to a
 * governed bundle is a presenter editing rows — which p29 forbids in exactly
 * those words.
 *
 * THE EVENTS ARE THE FULL SEQUENCE, not just the gate. A gate recorded with no
 * rule firing before it and no state change after it is a row, not a story:
 * the clinician queue would show an item whose history explains nothing.
 */
const SAFETY_PAUSE: DataScenario = {
  id: "safety-pause",
  title: "A safety pause on a small cohort",
  version: "safety-pause.1.0.0",
  purpose:
    "Show the safety engine holding somebody, and the clinician response path that answers " +
    "it, on a population that otherwise has no active gate.",
  whatChanges:
    "Six people in the Northeast who had no active gate now have one: a rule fired three " +
    "days ago, their safety state changed, and the gate is recorded and awaiting a response. " +
    "They appear on the clinician queue as work that has not been answered yet.",
  cohort: { region: "NE", safety: "No active gate", limit: 6 },
  events: [
    {
      type: "safety_rule.triggered",
      daysAgo: 3,
      actorType: "system",
      payload: { rule: "elevated_distress", ruleVersion: "demo-bundle", basis: "fabricated" },
    },
    {
      type: "safety_state.changed",
      daysAgo: 3,
      actorType: "system",
      payload: { from: "none", to: "paused", reason: "elevated_distress" },
    },
    {
      type: "coverage.gate_recorded",
      daysAgo: 3,
      actorType: "system",
      payload: { gate: "session_hold", awaiting: "clinician_response" },
    },
  ],
};

/**
 * A measurement gap, which is the other thing a presenter reaches for.
 *
 * §30.8's rule — show present values and list missing sources, never compute a
 * clean total from incomplete inputs — is a property of the screens that is
 * invisible while every fabricated person has a full series. This bundle makes
 * the absence real so the handling of it can be shown rather than described.
 */
const MEASURE_GAP: DataScenario = {
  id: "measure-gap",
  title: "A measurement gap across one archetype",
  version: "measure-gap.1.0.0",
  purpose:
    "Show what the screens do with missing measurements, rather than describing it over a " +
    "population where nothing is missing.",
  whatChanges:
    "Up to thirty people who were not responding to treatment now have a recorded reason " +
    "for a missing measure two weeks ago. Denominators on the outcome screens keep them and " +
    "say what is absent, which is the behaviour §30.8 requires and the one worth watching.",
  cohort: { archetype: "No change", limit: 30 },
  events: [
    {
      type: "measure.not_completed",
      daysAgo: 14,
      actorType: "system",
      payload: { instrument: "pcl-5", reason: "not_offered", basis: "fabricated" },
    },
  ],
};

export const DATA_SCENARIOS: DataScenario[] = [SAFETY_PAUSE, MEASURE_GAP];

export function dataScenario(id: string): DataScenario | null {
  return DATA_SCENARIOS.find((s) => s.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Validation, at module load
// ---------------------------------------------------------------------------

/**
 * Everything a bundle must be true of before it can exist.
 *
 * Run at import, so a bundle that would write an unregistered event type or
 * reach too many people fails the build rather than the demonstration. The
 * same function is exported for the guard, which is the point of it being a
 * function rather than a block.
 */
export function assertApplicable(s: DataScenario): void {
  const bad = (why: string): never => {
    throw new Error(`Data scenario ${s.id} is not applicable: ${why}`);
  };
  if (!s.version.startsWith(`${s.id}.`)) bad("the version does not name the scenario");
  if (s.events.length === 0) bad("it applies no events");
  for (const e of s.events) {
    if (!isEventType(e.type)) bad(`"${e.type}" is not a registered event type`);
    // A future-dated event sits in front of the clock: every window query reads
    // it as not yet real, and the demonstration shows nothing at all.
    if (e.daysAgo < 0) bad(`"${e.type}" is dated in the future`);
  }
  const rows = resolveCohort(s.cohort);
  if (rows.length === 0) bad("its cohort selects nobody");
  if (rows.length > MAX_COHORT) {
    bad(`its cohort selects ${rows.length} people, over the bound of ${MAX_COHORT}`);
  }
}

for (const s of DATA_SCENARIOS) assertApplicable(s);

// ---------------------------------------------------------------------------
// Cohort
// ---------------------------------------------------------------------------

/** The manifest rows a selector names, in manifest order. */
export function resolveCohort(sel: CohortSelector): ManifestRow[] {
  let rows = MANIFEST.filter((r) =>
    (sel.region === undefined || r.region === sel.region) &&
    (sel.archetype === undefined || r.archetype === sel.archetype) &&
    (sel.safety === undefined || r.safety === sel.safety) &&
    (sel.language === undefined || r.language === sel.language) &&
    (sel.ids === undefined || sel.ids.includes(r.id))
  );
  if (sel.limit !== undefined) rows = rows.slice(0, sel.limit);
  return rows;
}

/** Every id in the fabricated population, for the check below. */
function fabricatedPersonIds(): Set<string> {
  return new Set(MANIFEST.map((r) => popPersonId(r)));
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export interface ScenarioApplication {
  scenarioId: string;
  scenarioVersion: string;
  appliedBy: string;
  appliedByName: string | null;
  reason: string;
  appliedAt: string;
  people: number;
  events: number;
}

/** What has been applied to the environment as it stands.
 *
 *  Cleared by reset along with everything else, which is what makes "reversible
 *  by reset" a fact about the table rather than a sentence on a screen. */
export function appliedScenarios(): ScenarioApplication[] {
  const rows = getDb()
    .prepare(
      `SELECT scenario_id, scenario_version, applied_by, applied_by_name,
              reason, applied_at, person_count, event_count
         FROM demo_data_scenario_applications
        ORDER BY applied_at DESC, rowid DESC`
    )
    .all() as Array<{
      scenario_id: string; scenario_version: string; applied_by: string;
      applied_by_name: string | null; reason: string; applied_at: string;
      person_count: number; event_count: number;
    }>;
  return rows.map((r) => ({
    scenarioId: r.scenario_id,
    scenarioVersion: r.scenario_version,
    appliedBy: r.applied_by,
    appliedByName: r.applied_by_name,
    reason: r.reason,
    appliedAt: r.applied_at,
    people: Number(r.person_count),
    events: Number(r.event_count),
  }));
}

export type ApplyOutcome =
  | { ok: true; application: ScenarioApplication }
  | { ok: false; reason: string };

/**
 * Apply a bundle.
 *
 * REFUSES RATHER THAN DEGRADES, in the same register as the governed export:
 * every branch below is a case where doing part of the job would leave the
 * environment in a state nobody could describe.
 */
export async function applyDataScenario(args: {
  scenarioId: string;
  actorId: string;
  actorName?: string | null;
  reason: string;
  now?: Date;
}): Promise<ApplyOutcome> {
  // The same guard the reset carries, for the same reason. This writes into a
  // clinical event spine, and the only spine it may write into is a fabricated
  // one.
  if (process.env.EMDR_DEMO !== "1") {
    return {
      ok: false,
      reason:
        "Refused: this environment is not a demonstration environment. A data scenario " +
        "writes events into the clinical spine and may only do so against fabricated people.",
    };
  }

  const s = dataScenario(args.scenarioId);
  if (!s) return { ok: false, reason: `Refused: no data scenario named "${args.scenarioId}".` };

  // A reason is what makes this reviewable afterwards, and the bar is the one
  // the governed export already sets: a sentence, not a word.
  const reason = args.reason.trim();
  if (reason.length < 12) {
    return {
      ok: false,
      reason:
        "Refused: say what this bundle is for, in a sentence. It is recorded with the " +
        "application and is what explains an altered dataset to whoever finds it next.",
    };
  }

  const already = appliedScenarios().find((a) => a.scenarioVersion === s.version);
  if (already) {
    return {
      ok: false,
      reason:
        `Refused: ${s.version} was already applied ${already.appliedAt} by ` +
        `${already.appliedByName ?? already.appliedBy}. Applying it twice would double every ` +
        "event in it. Reset the environment to clear it.",
    };
  }

  const rows = resolveCohort(s.cohort);
  if (rows.length === 0) return { ok: false, reason: "Refused: this bundle's cohort selects nobody." };
  if (rows.length > MAX_COHORT) {
    return { ok: false, reason: `Refused: cohort of ${rows.length} exceeds the bound of ${MAX_COHORT}.` };
  }

  // THE STOP CONDITION, CHECKED RATHER THAN ARGUED. Every id here came from
  // `popPersonId` over the manifest, so it is fabricated by construction — and
  // a construction argument is exactly what stops being true when somebody
  // adds a selector.
  const fabricated = fabricatedPersonIds();
  const targets = rows.map((r) => popPersonId(r));
  const foreign = targets.filter((id) => !fabricated.has(id));
  if (foreign.length > 0) {
    return {
      ok: false,
      reason:
        `Refused: ${foreign.length} target(s) are not in the fabricated population. A data ` +
        "scenario may never write events against a person it did not invent.",
    };
  }

  // THE PERSON'S OWN TENANT, LOOKED UP, NEVER DEFAULTED.
  //
  // `appendEvent` falls back to the platform tenant when none is given, and
  // this is exactly the wrong place to accept that fallback: an event filed
  // under a different tenant from its person is read by a query scoped to the
  // wrong tenant and missed by one scoped to the right one. The first version
  // of this bundle did default, wrote eighteen events into the platform
  // tenant, and the dataset manifest's cross-tenant check failed the moment it
  // was applied — the same defect that check caught in the genesis backfill,
  // reproduced by somebody who had read the comment describing it.
  const tenantOf = new Map<string, string>();
  for (const row of getDb()
    .prepare(
      `SELECT id, tenant_id FROM persons WHERE id IN (${targets.map(() => "?").join(",")})`
    )
    .all(...targets) as Array<{ id: string; tenant_id: string }>) {
    tenantOf.set(row.id, row.tenant_id);
  }
  const missing = targets.filter((id) => !tenantOf.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        `Refused: ${missing.length} target(s) have no person row, so their events would have ` +
        "no tenant to belong to. Reset the environment and try again.",
    };
  }

  const now = args.now ?? new Date();
  const stamp = (daysAgo: number): string =>
    new Date(now.getTime() - daysAgo * 86_400_000).toISOString().replace("T", " ").slice(0, 19);

  let written = 0;
  for (const personId of targets) {
    for (const e of s.events) {
      await appendEvent({
        personId,
        tenantId: tenantOf.get(personId),
        type: e.type,
        actorType: e.actorType,
        actorId: e.actorType === "patient" ? personId : args.actorId,
        occurredAt: stamp(e.daysAgo),
        // FABRICATED, SAID IN THE ROW ITSELF. `source_system` is what a query
        // three layers away sees; a bundle that wrote "steady" would be
        // indistinguishable from the generated history the moment somebody
        // reads the table instead of the screen.
        sourceSystem: "demo-data-scenario",
        payload: { ...(e.payload ?? {}), fabricated: true },
        provenance: { ruleVersion: s.version, scenarioId: s.id, fabricated: true },
      });
      written += 1;
    }
  }

  const appliedAt = stamp(0);
  getDb()
    .prepare(
      `INSERT INTO demo_data_scenario_applications
         (id, scenario_id, scenario_version, applied_by, applied_by_name,
          reason, applied_at, person_count, event_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(newId(), s.id, s.version, args.actorId, args.actorName ?? null,
         reason, appliedAt, targets.length, written);

  // The console can be read; the audit log is what survives the reset that
  // clears the console.
  await audit({
    actorId: args.actorId,
    actorRole: "demo_admin",
    family: "security",
    type: "demo_data_scenario_applied",
    target: s.version,
    detail: { people: targets.length, events: written, reason },
  });

  return {
    ok: true,
    application: {
      scenarioId: s.id,
      scenarioVersion: s.version,
      appliedBy: args.actorId,
      appliedByName: args.actorName ?? null,
      reason,
      appliedAt,
      people: targets.length,
      events: written,
    },
  };
}
