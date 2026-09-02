import crypto from "crypto";
import type Database from "better-sqlite3";
import { hashPassword } from "./db";
import {
  MANIFEST, DATASET_VERSION, seedFor, type ManifestRow, type Archetype,
} from "./demo-population-manifest";
import { tenantForRow, clinicianPersonId } from "./demo-population-seed";
import { accessProfileFor, type AccessProfile } from "./demo-population-disparity";
import {
  CALENDAR_DAYS, MIN_MEASURES, PERSON_DAYS, demoEpoch, enrolmentDayFor, exposureDaysFor,
  generatedDaysFor, scaledRange,
} from "./demo-population-calendar";
import {
  MEMBER_NOTES, OPERATIONAL_NOTES, CLINICIAN_COMMENTS, pick,
} from "./demo-population-dictionaries";

// The deterministic event generator (handoff 07 §2.4 p14, §2.7 p28).
//
// p14's rule is the one everything here serves:
//
//   ALL TIMESTAMPS DERIVE FROM demo_epoch PLUS SEEDED OFFSETS. RANDOMNESS USES
//   A DOCUMENTED PSEUDORANDOM GENERATOR AND ONE STABLE SEED PER PROFILE.
//   RE-RUNNING THE SAME VERSION MUST PRODUCE THE SAME EVENT IDS, TIMESTAMPS,
//   VALUES AND PROJECTION HASHES.
//
// HOW THE EVENTS GET WRITTEN. This module writes CURRENT-STATE ROWS —
// check-ins, measures, module completions, sessions — and lets the existing
// genesis backfill derive the ledger from them. That is not a shortcut around
// p28's pseudocode; it is the only way to satisfy the replay guard, which
// requires every event carrying a projector to name the row it rebuilds. The
// organization seed learned this the expensive way: it wrote clinical event
// types for people who had no clinical records, and the guard reported 8,008
// events that claimed rows they could not reconstruct.
//
// Events with no current-state row — safety gates, clinician actions,
// corrections, missingness — are written here directly, because they carry
// history the current-state tables never held.

// ---------------------------------------------------------------------------
// The pseudorandom generator
// ---------------------------------------------------------------------------

/**
 * mulberry32 — a small, fast, well-distributed 32-bit generator.
 *
 * DOCUMENTED, as p14 requires, and the documentation is the point rather than
 * the algorithm. `Math.random()` is unseedable, so a dataset built on it can
 * never be reproduced; a generator whose implementation is not written down
 * cannot be reimplemented if this file is ported. mulberry32 is nine lines and
 * its behaviour is fully determined by its 32-bit state.
 *
 * The seed is `sha256(dataset_version:profile_seed)` folded to 32 bits, so
 * bumping the dataset version reshuffles every profile — which is what makes a
 * version bump a NEW population rather than the old one with edits.
 */
export class StableRandom {
  private state: number;

  constructor(seed: number, version = DATASET_VERSION) {
    const h = crypto.createHash("sha256").update(`${version}:${seed}`).digest();
    this.state = h.readUInt32BE(0);
  }

  /** [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [lo, hi]. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }
}

// ---------------------------------------------------------------------------
// The calendar
// ---------------------------------------------------------------------------

// The calendar lives in `demo-population-calendar.ts` and is re-exported here
// because callers have imported `DEMO_DAYS` and `demoEpoch` from this module
// since Wave 3. `DEMO_DAYS` now means what it always said it meant — how long
// one person is observed for — and no longer doubles as the length of the
// generated calendar, which is what made a rolling intake impossible.
export { demoEpoch, CALENDAR_DAYS, PERSON_DAYS, enrolmentDayFor, exposureDaysFor, scaledRange };
export const DEMO_DAYS = PERSON_DAYS;

function dayStamp(epoch: Date, day: number, hour: number): string {
  const t = new Date(epoch.getTime() + day * 86400000);
  t.setUTCHours(hour, 0, 0, 0);
  return t.toISOString().slice(0, 19).replace("T", " ");
}

function dayDate(epoch: Date, day: number): string {
  return new Date(epoch.getTime() + day * 86400000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Archetype activity paths
// ---------------------------------------------------------------------------

/**
 * How each of p12's eight patterns behaves, as numbers rather than prose.
 *
 * p28's constraint is the reason this table exists: "do not sample outcomes
 * independently from event history — follow-up values must match the authored
 * archetype and activity path." A generator that drew engagement from one
 * distribution and improvement from another would produce people who improved
 * without attending, which every chart in the product would then faithfully
 * report.
 *
 * So one archetype fixes both: how often the person shows up, AND the shape of
 * the curve between the manifest's baseline and follow-up values.
 */
interface Path {
  /** How many of the 180 days carry a check-in, as an explicit range.
   *
   *  A RANGE rather than a rate, and inside p14's 18–90 bound by construction.
   *  The first version used a per-day probability, which produced 1 check-in
   *  for one person and 134 for another — both outside the specification, and
   *  neither visible without counting. A target that emerges from a rate is a
   *  target nobody is holding. */
  checkIns: [number, number];
  /** Module completions across the window. p14: 8–55. */
  modules: [number, number];
  /** Simulated support sessions. p14: 0–8, never trauma-processing proof. */
  sessions: [number, number];
  /** Where in the window the measure change happens, as a fraction. A value
   *  of 0.25 means most of the movement is done by day 45. */
  changeMidpoint: number;
  /** How abrupt the change is. Higher is steeper. */
  changeSteepness: number;
  /** Probability a due measure is not completed. */
  missRate: number;
  /** Days with no activity at all, as [startDay, length] — an authored gap
   *  rather than an absence that happens to occur. */
  gap?: [number, number];
}

/** Exported so the agent behaviour layer reads the SAME archetype definitions.
 *  Two behaviour models for one population would show up as a discontinuity
 *  two weeks wide on every trend on the console. */
export const PATHS: Record<Archetype, Path> = {
  "Early response":  { checkIns: [62, 88], modules: [30, 55], sessions: [3, 8], changeMidpoint: 0.22, changeSteepness: 9,  missRate: 0.08 },
  "Steady response": { checkIns: [48, 72], modules: [22, 40], sessions: [2, 6], changeMidpoint: 0.50, changeSteepness: 4,  missRate: 0.10 },
  "Late response":   { checkIns: [38, 60], modules: [18, 34], sessions: [1, 5], changeMidpoint: 0.72, changeSteepness: 8,  missRate: 0.14 },
  "No change":       { checkIns: [30, 52], modules: [14, 28], sessions: [0, 3], changeMidpoint: 0.50, changeSteepness: 3,  missRate: 0.16 },
  // Irregular by definition, and the incomplete follow-up is the point: p12
  // calls it "irregular check-ins and incomplete follow-up", so the miss rate
  // is what distinguishes it rather than the total.
  "Sporadic use":    { checkIns: [18, 34], modules: [10, 22], sessions: [0, 2], changeMidpoint: 0.55, changeSteepness: 3,  missRate: 0.42 },
  // High use, low response. The one archetype where engagement and outcome
  // deliberately disagree — and the reason a chart must never read one from
  // the other.
  "Module mismatch": { checkIns: [52, 78], modules: [38, 55], sessions: [1, 4], changeMidpoint: 0.50, changeSteepness: 3,  missRate: 0.12 },
  // Missed activity linked to authored access events, not to disengagement.
  "Access barrier":  { checkIns: [18, 30], modules: [8, 18],  sessions: [0, 2], changeMidpoint: 0.60, changeSteepness: 4,  missRate: 0.34, gap: [40, 45] },
  // A fixed safety event, a pause, a review, and bounded re-entry.
  "Safety pause":    { checkIns: [34, 58], modules: [12, 30], sessions: [0, 4], changeMidpoint: 0.62, changeSteepness: 5,  missRate: 0.18, gap: [95, 21] },
};

/** The measure value on a given day, interpolated between the manifest's
 *  baseline and follow-up along the archetype's curve. A logistic rather than
 *  a straight line, because "early response" and "late response" differ in
 *  WHEN the change happens, and a linear path cannot express that. */
export function measureOn(row: ManifestRow, dayFraction: number): number {
  const path = PATHS[row.archetype];
  const t = (dayFraction - path.changeMidpoint) * path.changeSteepness;
  const progress = 1 / (1 + Math.exp(-t));
  // Normalised so the curve starts at the baseline and ends at the follow-up
  // exactly, rather than approaching them asymptotically — the manifest's two
  // numbers are the authored truth and the curve has to hit both.
  const p0 = 1 / (1 + Math.exp(path.changeMidpoint * path.changeSteepness));
  const p1 = 1 / (1 + Math.exp(-(1 - path.changeMidpoint) * path.changeSteepness));
  const norm = (progress - p0) / (p1 - p0);
  return Math.round(row.baseline + (row.followUp - row.baseline) * Math.max(0, Math.min(1, norm)));
}

/** Whether a day falls inside this archetype's authored inactive stretch.
 *
 *  `day` is PERSON-RELATIVE — days since this profile enrolled, not days since
 *  the fabricated service opened. The gap offsets in `PATHS` were always
 *  person-relative ("a 45-day stretch starting on day 40 of their journey");
 *  they were compared against an absolute day and matched only because every
 *  profile enrolled within a fortnight of the epoch. Under a rolling intake
 *  that comparison would put a person's authored gap before they existed. */
function inGap(row: ManifestRow, dayFromEnrolment: number, exposure = PERSON_DAYS): boolean {
  const g = gapFor(row, exposure);
  return g !== null && dayFromEnrolment >= g[0] && dayFromEnrolment < g[0] + g[1];
}

/**
 * The authored gap, placed proportionally inside the person's own window.
 *
 * The offsets in `PATHS` are written against a full six months — "a 45-day
 * stretch starting on day 40". Somebody observed for six weeks has not had a
 * day 40, and a gap placed there falls outside their window entirely. The
 * first version of the rolling intake did exactly that and put safety events
 * up to eleven weeks in the FUTURE, which the seeded-timestamp guard caught.
 *
 * So the gap keeps its POSITION and its SHARE of the journey rather than its
 * day count: a pause that happens 53% of the way through and lasts a quarter
 * of the window is the same story at any exposure, and it is always inside it.
 */
function gapFor(row: ManifestRow, exposure: number): [number, number] | null {
  const g = PATHS[row.archetype].gap;
  if (g === undefined) return null;
  const share = Math.min(1, exposure / PERSON_DAYS);
  const start = Math.max(1, Math.round(g[0] * share));
  const length = Math.max(1, Math.round(g[1] * share));
  // Never runs past the person's last day: a gap that swallows the end of the
  // window would leave them with no final measure to pin the follow-up to.
  return [Math.min(start, Math.max(1, exposure - 2)), Math.min(length, Math.max(1, exposure - start - 1))];
}

// ---------------------------------------------------------------------------
// Missingness
// ---------------------------------------------------------------------------

/** p28's six reasons, verbatim. A missing value with no reason is
 *  indistinguishable from one that was never due, and §29.1 requires missing,
 *  incomplete, late, rejected and suppressed data to stay visible. */
export const MISSING_REASONS = [
  "not_due", "skipped", "declined", "interrupted", "failed", "unavailable",
] as const;
export type MissingReason = (typeof MISSING_REASONS)[number];

function missingReason(row: ManifestRow, day: number, rng: StableRandom): MissingReason {
  // The reason follows the archetype rather than being drawn at random: an
  // access-barrier person's measure is unavailable, a safety-paused one's is
  // interrupted. A uniformly random reason would make the missingness
  // breakdown on every chart meaningless.
  if (row.archetype === "Access barrier") return inGap(row, day) ? "unavailable" : "failed";
  if (row.archetype === "Safety pause" && inGap(row, day)) return "interrupted";
  if (row.archetype === "Sporadic use") return rng.chance(0.6) ? "skipped" : "declined";
  return rng.chance(0.5) ? "skipped" : "not_due";
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function popId(kind: string, key: string): string {
  return crypto.createHash("sha256")
    .update(`${DATASET_VERSION}:${kind}:${key}`)
    .digest("hex").slice(0, 32).toUpperCase();
}

export interface GeneratedCounts {
  accounts: number;
  consents: number;
  checkins: number;
  measures: number;
  measuresMissing: number;
  modules: number;
  sessions: number;
  safetyEvents: number;
  clinicianActions: number;
  corrections: number;
}

/** p14's per-person targets, checked after generation rather than assumed. */
export const TARGETS = {
  checkins: [18, 90] as const,
  measures: [4, 8] as const,
  modules: [8, 55] as const,
  sessions: [0, 8] as const,
  safetyEvents: [0, 3] as const,
  clinicianActions: [1, 12] as const,
  corrections: [0, 2] as const,
};

export function generatePopulationHistory(db: Database.Database): GeneratedCounts {
  return db.transaction(() => generateInner(db))();
}

function generateInner(db: Database.Database): GeneratedCounts {
  const counts: GeneratedCounts = {
    accounts: 0, consents: 0, checkins: 0, measures: 0, measuresMissing: 0,
    modules: 0, sessions: 0, safetyEvents: 0, clinicianActions: 0, corrections: 0,
  };

  // Idempotent: a second call on a generated database is a no-op.
  const firstId = popId("person", MANIFEST[0].id);
  const already = db.prepare("SELECT COUNT(*) AS n FROM checkins WHERE user_id = ?").get(firstId) as { n: number };
  if (already.n > 0) return counts;

  const epoch = demoEpoch();
  // One password hash for all 240, computed once. They are accounts in the
  // schema's sense — p14's "1 account" per profile — and a presenter may sign
  // in as any of them to show a specific archetype. 240 separate hashes would
  // cost 240 scrypt runs for no additional property.
  const sharedHash = hashPassword(process.env.EMDR_DEMO_PASSWORD_MEMBER ?? "patient1234");

  const insUser = db.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, tenant_id, created_at)
     VALUES (?, ?, ?, 'member', ?, ?, ?) ON CONFLICT(id) DO NOTHING`);
  const insConsent = db.prepare(
    `INSERT INTO consents (id, user_id, tenant_id, policy_version, scope, granted_at)
     VALUES (?, ?, ?, ?, ?, ?)`);
  const insCheckin = db.prepare(
    `INSERT INTO checkins (id, user_id, tenant_id, checkin_date, activation, shutdown,
       harm_urge, feels_safe, dissociation, sleep_quality, substance_flag,
       recommended_action, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insScreening = db.prepare(
    `INSERT INTO screenings (id, user_id, tenant_id, instrument, instrument_version,
       total_score, answers_json, risk_flags_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?)`);
  const insPractice = db.prepare(
    `INSERT INTO practice_completions (id, user_id, tenant_id, practice_id, practice_type,
       duration_sec, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insSession = db.prepare(
    `INSERT INTO therapy_sessions (id, user_id, tenant_id, module_id, status,
       pre_suds, post_suds, started_at, ended_at)
     VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?)`);
  const insEvent = db.prepare(
    `INSERT INTO longitudinal_events
       (id, tenant_id, person_id, event_type, payload_version, payload, actor_id,
        actor_type, occurred_at, recorded_at, source_system, provenance,
        correlation_id, supersedes_event_id)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'demo-generator', ?, ?, ?)`);

  const PROV = JSON.stringify({ fabricated: true, dataset_version: DATASET_VERSION });

  const MODULES = [
    ["grounding", "grounding"], ["breathing", "breathing"], ["learning", "learning"],
    ["preparation", "preparation"], ["support", "support"],
  ] as const;

  for (const row of MANIFEST) {
    const seed = seedFor(row);
    const rng = new StableRandom(seed);
    const personId = popId("person", row.id);
    const tenant = tenantForRow(row);
    const path = PATHS[row.archetype];
    // The authored access model (see demo-population-disparity.ts). It never
    // changes the archetype's SHAPE — the curve between the manifest's
    // baseline and follow-up is p28's authored truth and stays exactly as
    // written. What it changes is how reliably the service reached this
    // person: how quickly a first appointment was arranged, how many measures
    // were delivered, how often they showed up.
    const access = accessProfileFor(row);
    // WHEN THIS PERSON JOINED, and how long they have been here. Both come
    // from the calendar module so the seed and the generator cannot disagree
    // about an enrolment date — they did once, and the result was a person
    // whose first check-in preceded their own account.
    const startDay = enrolmentDayFor(row);
    const exposure = exposureDaysFor(row);
    // Every offset below is measured from `startDay`. A curve, an authored
    // gap, a measure schedule and a safety event are all facts about a
    // person's own journey, and before the calendar split they were offsets
    // from the day the fabricated service opened — which was only ever right
    // because everybody opened with it.
    // The generator stops short of the calendar's end. The reserved tail
    // belongs to the agent behaviour layer, which lives those days through the
    // product rather than writing them into the tables — so the window every
    // metric and every planning rule reads is one the gate engine actually saw.
    const exposureGenerated = generatedDaysFor(row);
    const lastDay = startDay + exposureGenerated;
    // Over the person's FULL exposure, not the generated part: the archetype's
    // curve describes their whole journey, and normalising it to the shortened
    // window would compress the trajectory and land the follow-up value two
    // weeks early.
    const since = (day: number) => (day - startDay) / Math.max(1, exposure);

    // ── Enrolment: one account, one consent set (p14) ────────────────────
    insUser.run(
      personId, `${row.id.toLowerCase()}@steady.local`,
      // Reuses the display name already seeded onto the person, so the account
      // and the person cannot disagree about who this is.
      (db.prepare("SELECT display_name AS n FROM persons WHERE id = ?").get(personId) as { n: string }).n,
      sharedHash, tenant, dayStamp(epoch, startDay, 8),
    );
    counts.accounts++;
    for (const [version, scope] of [
      ["demo-consent-v1", "care_program_full"],
      ["demo-consent-v1", "measurement"],
    ] as const) {
      insConsent.run(popId("consent", `${row.id}:${scope}`), personId, tenant, version, scope, dayStamp(epoch, startDay, 8));
      counts.consents++;
    }

    // ── The access pathway (handoff 06 §26's funnel) ─────────────────────
    //
    // Referral, contact, visit, care start. Not in handoff 07's p14 recipe,
    // and required by the same claim it makes: the organization console's
    // existing screens count these events, so without them a demo care network
    // whose every member is engaged reports "0 of 44 started care". The e2e
    // suite caught exactly that — a header reading 0% over a population that
    // is fully active.
    //
    // In the order they happened, because a funnel whose stages are
    // simultaneous is four numbers rather than a pathway. Referral and contact
    // sit before enrolment; the visit and the care start move with the access
    // model's drag, so for somebody it took three extra weeks to schedule they
    // land after it — which is what a delayed start actually looks like. The
    // Access-barrier archetype stalls between contact and visit, which is what
    // "missed activity linked to authored access events" means (p12).
    const stalls = row.archetype === "Access barrier" && rng.chance(0.45);
    // The drag lands between CONTACT and VISIT, which is where an access delay
    // actually sits: the referral arrives on time and the appointment is the
    // thing that cannot be arranged. Putting it on the referral instead would
    // have made it look like a demand problem.
    // Drawn around the mean, with a spread wide enough that every band holds
    // both a person who started the next day and a person who took a month.
    // Two draws rather than one, so the shape is triangular rather than flat —
    // most people near the mean, a thinner tail either side, which is what a
    // wait for an appointment actually looks like.
    const drag = Math.max(0, access.startDragMean + rng.int(-4, 4) + rng.int(-3, 3));
    const pathway: Array<[string, number]> = [
      ["referral.received", -12],
      ["contact.attempted", -9],
      ["contact.made", -6],
      ...(stalls ? [] : [["visit.scheduled", -3 + drag] as [string, number], ["care.started", drag] as [string, number]]),
    ];
    for (const [type, offset] of pathway) {
      const day = Math.max(0, startDay + offset);
      insEvent.run(
        popId("pathway", `${row.id}:${type}`), tenant, personId, type,
        JSON.stringify({ fabricated: true }), null, "integration",
        dayStamp(epoch, day, 9), dayStamp(epoch, day, 9), PROV, null, null,
      );
    }

    // ── Check-ins: an explicit count, placed across the window ──────────
    //
    // The count is drawn first and then placed, rather than emerging from a
    // per-day coin flip. p14 specifies 18–90 per person and a rate cannot
    // promise that: the first version produced 1 for one person and 134 for
    // another.
    // Scaled by the access model, then clamped to p14's GLOBAL per-person
    // bound rather than to the archetype's own band. The distinction matters:
    // p14 states 18–90 check-ins for a person and the quality manifest
    // enforces that number, while the per-archetype band is this generator's
    // own subdivision of it. Clamping to the narrower one would let the floor
    // absorb the whole effect for anyone already near it — the multiplier
    // would apply to the people it least needed to and not to the people it
    // did.
    // SCALED TO EXPOSURE. p14's 18–90 describes a person observed for six
    // months; somebody who joined three weeks ago cannot have eighteen
    // check-ins, and requiring it is what forced the whole population into a
    // single fortnight of intake. The rate is held constant instead, and the
    // quality manifest checks against the scaled bound so a shortchanged
    // recent arrival still fails.
    const checkInBound = scaledRange(TARGETS.checkins, exposure);
    const wantCheckIns = Math.max(
      checkInBound[0],
      Math.min(checkInBound[1], Math.round(
        rng.int(path.checkIns[0], path.checkIns[1]) * access.engagementFactor
        * (exposureGenerated / PERSON_DAYS),
      )),
    );
    // The first check-in cannot precede the first appointment, so the access
    // model's start drag moves this window too. Without it the drag would move
    // only the pathway events and activation — "acted within seven days of
    // enrolling" — would be identical for everybody, which is the half of the
    // age reversal that makes the other half interesting.
    const openDays: number[] = [];
    for (let day = startDay + 1 + drag; day < lastDay; day++) {
      if (!inGap(row, day - startDay, exposure)) openDays.push(day);
    }
    // Fisher-Yates on the seeded generator, then take the first N and re-sort.
    // Sampling with rejection would draw a different number of times depending
    // on collisions, which makes the generator's state — and therefore every
    // value after it — depend on how lucky the draws were.
    for (let i = openDays.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [openDays[i], openDays[j]] = [openDays[j], openDays[i]];
    }
    const checkInDays = openDays.slice(0, Math.min(wantCheckIns, openDays.length)).sort((a, b) => a - b);

    let checkins = 0;
    for (const day of checkInDays) {
      const frac = since(day);
      const measure = measureOn(row, frac);
      // Daily state tracks the measure trajectory rather than being drawn
      // separately — p28: outcomes are not sampled independently of the
      // history that produced them.
      const severity = Math.max(0, Math.min(10, Math.round(measure / 3)));
      const rel = day - startDay;
      const gap = gapFor(row, exposure);
      const paused = row.safety === "Fixed pause" && gap !== null && rel > gap[0] - 3 && rel < gap[0] + 1;

      insCheckin.run(
        popId("checkin", `${row.id}:${day}`), personId, tenant, dayDate(epoch, day),
        severity, Math.max(0, severity - rng.int(0, 2)),
        paused ? 1 : 0,
        paused ? 0 : 1,
        row.archetype === "Safety pause" && paused ? 7 : rng.int(0, 3),
        Math.max(0, Math.min(10, 8 - Math.round(severity / 2) + rng.int(-1, 1))),
        0,
        paused ? "crisis" : severity >= 7 ? "grounding_only" : "steady",
        dayStamp(epoch, day, 7 + (seed % 4)),
      );
      checkins++;
    }
    counts.checkins += checkins;

    // ── Measures: 4–8 completed, 0–3 partial, with reasons (p14, p28) ────
    // ── Measures: 4–8 completed, plus recorded missingness (p14, p28) ───
    //
    // The COMPLETED count is drawn inside p14's range and the misses are added
    // on top, rather than subtracted from a due count — otherwise a person
    // with a high miss rate falls below the specified minimum, which is
    // exactly what happened first time.
    const measureBound = scaledRange(TARGETS.measures, exposure, MIN_MEASURES);
    const wantMeasures = Math.max(
      // FULL exposure, not the generated portion. The measure schedule is a
      // property of a person's whole journey and the generator owns all of it:
      // the agent layer deliberately writes no measures, because a
      // three-weekly cadence split across two writers double-counts at the
      // seam and pushes people past p14's ceiling of eight. Measures also
      // touch no gate, so they are not what the agent layer is for.
      measureBound[0], Math.min(measureBound[1], Math.round(rng.int(4, 8) * (exposure / PERSON_DAYS))),
    );
    // TWO KINDS OF MISS, kept apart all the way down to the reason on the
    // event, because they are two different problems with two different fixes.
    //
    //   A SKIP is the person's side: the measure arrived and was not
    //   completed. It follows the archetype, scaled by the access model's
    //   adherence factor.
    //
    //   A DELIVERY FAILURE is the service's side: the measure never went out.
    //   It follows the access model alone — an interpreter who could not be
    //   booked, an instrument that has not been translated, a person the
    //   product does not accommodate.
    //
    // Both raise the denominator of follow-up completion and only one of them
    // is about the person. A console that reports the rate without the reasons
    // cannot tell them apart, which is precisely why p32 puts the five states
    // in that metric's required display.
    const missCount = Math.min(3, Math.round(wantMeasures * path.missRate * 1.4 * access.adherenceFactor));
    const deliveryMisses = Math.min(5, Math.round(wantMeasures * access.deliveryFailure * 4));
    const dueCount = wantMeasures + missCount + deliveryMisses;
    // Which of the due slots are missed. Never the first or last: those two
    // carry the manifest's authored baseline and follow-up.
    //
    // Chosen by shuffling the eligible slots and taking the first N, so
    // exactly `missCount` land. Drawing N times into a Set collapses
    // collisions, which silently produced FEWER misses and therefore more
    // completed measures than p14's ceiling — a person with ten.
    const eligible: number[] = [];
    for (let i = 1; i <= dueCount - 2; i++) eligible.push(i);
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }
    const missedSlots = new Set(eligible.slice(0, Math.min(missCount, eligible.length)));
    // Drawn from what the skips did not take, so the two never land on the
    // same slot and the counts stay exactly what was computed above.
    const undeliveredSlots = new Set(
      eligible.slice(missedSlots.size, missedSlots.size + Math.max(0, deliveryMisses)),
    );

    let completed = 0;
    for (let i = 0; i < dueCount; i++) {
      const day = Math.round(startDay + ((exposure - 1) * i) / Math.max(1, dueCount - 1));
      if (undeliveredSlots.has(i)) {
        // The service's side. p28's "unavailable", and the mechanisms that
        // produced it are named ON THE EVENT — so a reviewer who opens a
        // single missing measure sees why it is missing, rather than having to
        // infer it from a rate three screens away.
        insEvent.run(
          popId("undelivered", `${row.id}:${i}`), tenant, personId, "measure.not_completed",
          JSON.stringify({
            instrument: "phq-9", dueOn: dayDate(epoch, day),
            reason: "unavailable",
            cause: "service",
            mechanisms: access.mechanisms,
            fabricated: true,
          }),
          null, "system", dayStamp(epoch, day, 12), dayStamp(epoch, day, 12), PROV, null, null,
        );
        counts.measuresMissing++;
        continue;
      }
      if (missedSlots.has(i)) {
        // Missingness is RECORDED, with the reason. An absent row and a
        // declined one look identical in a table, and only one of them is a
        // fact about the person.
        insEvent.run(
          popId("missing", `${row.id}:${i}`), tenant, personId, "measure.not_completed",
          JSON.stringify({
            instrument: "phq-9", dueOn: dayDate(epoch, day),
            reason: missingReason(row, day, rng), cause: "person", fabricated: true,
          }),
          null, "system", dayStamp(epoch, day, 12), dayStamp(epoch, day, 12), PROV, null, null,
        );
        counts.measuresMissing++;
        continue;
      }
      insScreening.run(
        popId("screening", `${row.id}:${i}`), personId, tenant, "phq-9", "standard",
        // The first and last are pinned to the manifest exactly: those two
        // numbers are the authored truth, and a curve that only approaches
        // them would make the follow-up on every chart disagree with the row
        // it came from.
        i === 0 ? row.baseline : i === dueCount - 1 ? row.followUp : measureOn(row, since(day)),
        "[]", dayStamp(epoch, day, 12),
      );
      completed++;
    }
    counts.measures += completed;

    // ── Modules (p14: 8–55) ──────────────────────────────────────────────
    const moduleBound = scaledRange(TARGETS.modules, exposure);
    const moduleCount = Math.max(
      moduleBound[0],
      Math.min(moduleBound[1], Math.round(rng.int(path.modules[0], path.modules[1]) * (exposureGenerated / PERSON_DAYS))),
    );
    for (let i = 0; i < moduleCount; i++) {
      let day = startDay + 1 + Math.floor(rng.next() * Math.max(1, exposureGenerated - 2));
      if (inGap(row, day - startDay, exposure)) {
        day = Math.min(lastDay - 1, day + (gapFor(row, exposure)?.[1] ?? 0));
      }
      const [id, type] = MODULES[rng.int(0, MODULES.length - 1)];
      insPractice.run(
        popId("practice", `${row.id}:${i}`), personId, tenant, id, type,
        rng.int(90, 600), dayStamp(epoch, day, 10),
      );
    }
    counts.modules += moduleCount;

    // ── Support sessions (p14: 0–8, never trauma-processing proof) ───────
    const sessionCount = rng.int(path.sessions[0], path.sessions[1]);
    for (let i = 0; i < sessionCount; i++) {
      const day = startDay + 5 + Math.floor(rng.next() * Math.max(1, exposureGenerated - 6));
      if (inGap(row, day - startDay, exposure)) continue;
      // A SUPPORT session. p14 is explicit that these are "never treated as
      // trauma-processing proof", so the module is resourcing and the SUDS
      // pair records a settling rather than a desensitisation.
      const pre = Math.max(1, Math.min(10, Math.round(measureOn(row, since(day)) / 3)));
      insSession.run(
        popId("session", `${row.id}:${i}`), personId, tenant, "resourcing",
        pre, Math.max(0, pre - rng.int(0, 2)),
        dayStamp(epoch, day, 15), dayStamp(epoch, day, 16),
      );
      counts.sessions++;
    }

    // ── Safety: 0–3 fixed gate events (p14) ──────────────────────────────
    // Deterministic inputs produce the expected gate output. The manifest's
    // safety column is the authored expectation; these events are what a
    // reviewer replays against it.
    if (row.safety !== "No active gate") {
      const gap = gapFor(row, exposure);
      // Every one of these three days is clamped inside the person's own
      // window. A gate, its response and its re-entry are a sequence, and the
      // last of them has to land before the window closes or the seeded
      // timestamp is in the future — which is how this was found.
      const gateDay = Math.min(lastDay - 2, startDay + (gap?.[0] ?? Math.floor(exposure * 0.6)));
      const kind = row.safety === "Fixed pause" ? "safety_state.changed" : "clinician.reviewed";
      insEvent.run(
        popId("gate", `${row.id}:open`), tenant, personId, kind,
        JSON.stringify({
          state: row.safety === "Fixed pause" ? "paused" : "under_review",
          reason: row.safety === "Fixed pause" ? "fixed_scenario_pause" : "scheduled_review",
          expected: row.safety, fabricated: true,
        }),
        null, row.safety === "Fixed pause" ? "system" : "clinician",
        dayStamp(epoch, gateDay, 9), dayStamp(epoch, gateDay, 9), PROV, popId("corr", row.id), null,
      );
      counts.safetyEvents++;

      // The DOCUMENTED RESPONSE to the gate, within a day or two.
      //
      // p32's time-to-review metric measures "elapsed time from a fixed review
      // event to a documented response", and without this event there was
      // nothing to measure to: the query paired a pause with the next
      // clinician action of any kind, which is scattered across six months, so
      // the median read 593 hours. That is not a latency, it is the average
      // distance between two unrelated things.
      const responseHours = 6 + (seed % 42);
      const responseDay = Math.min(lastDay - 1, gateDay + Math.floor(responseHours / 24));
      const resolveDay = Math.min(lastDay - 1, gateDay + (gap?.[1] ?? 21));
      insEvent.run(
        popId("gate", `${row.id}:response`), tenant, personId, "clinician.reviewed",
        JSON.stringify({
          kind: "safety_response",
          respondsTo: popId("gate", `${row.id}:open`),
          note: pick(CLINICIAN_COMMENTS, seed, 0),
          fabricated: true,
        }),
        clinicianPersonId(row.clinician), "clinician",
        dayStamp(epoch, responseDay, 9 + (responseHours % 12)),
        dayStamp(epoch, responseDay, 9 + (responseHours % 12)),
        PROV, popId("corr", row.id), null,
      );
      counts.clinicianActions++;

      if (row.safety === "Fixed pause") {
        // Bounded re-entry, not an indefinite hold. A pause with no recorded
        // end is a lockout wearing a different word.
        insEvent.run(
          popId("gate", `${row.id}:reentry`), tenant, personId, "safety_state.changed",
          JSON.stringify({ state: "re_entered", reason: "reviewed_and_agreed", fabricated: true }),
          null, "clinician",
          // Clamped to the person's last day. The resolution of a pause that
          // began near the end of a short window would otherwise be dated
          // after the window closed — which is to say, in the future.
          dayStamp(epoch, resolveDay, 9),
          dayStamp(epoch, resolveDay, 9), PROV, popId("corr", row.id), null,
        );
        counts.safetyEvents++;
      }
    }

    // ── Clinician actions: 1–12 (p14) ────────────────────────────────────
    const actionCount = rng.int(1, 8);
    for (let i = 0; i < actionCount; i++) {
      const day = startDay + 3 + Math.floor(rng.next() * Math.max(1, exposureGenerated - 4));
      insEvent.run(
        popId("action", `${row.id}:${i}`), tenant, personId, "clinician.reviewed",
        JSON.stringify({
          kind: ["review", "message", "note", "assign"][rng.int(0, 3)],
          // Free text from a FIXED dictionary. p28: never ask a language model
          // to invent uncontrolled clinical narratives at runtime.
          note: pick(CLINICIAN_COMMENTS, seed, i),
          operational: pick(OPERATIONAL_NOTES, seed, i + 1),
          fabricated: true,
        }),
        // NE-C1 resolves to the demo clinician account, so a presenter signing
        // in sees these reviews as their own rather than a stranger's.
        clinicianPersonId(row.clinician), "clinician",
        dayStamp(epoch, day, 14), dayStamp(epoch, day, 14), PROV, null, null,
      );
      counts.clinicianActions++;
    }

    // ── Corrections: 0–2, appended and superseding (p14) ─────────────────
    const correctionCount = rng.int(0, 2);
    for (let i = 0; i < correctionCount; i++) {
      const originalId = popId("action", `${row.id}:${i}`);
      if (i >= actionCount) break;
      const day = lastDay - 5 - i;
      insEvent.run(
        popId("correction", `${row.id}:${i}`), tenant, personId, "memory.patient_corrected",
        JSON.stringify({
          corrects: originalId,
          note: pick(MEMBER_NOTES, seed, i + 2),
          fabricated: true,
        }),
        personId, "patient",
        dayStamp(epoch, day, 11), dayStamp(epoch, day, 11), PROV, null,
        // A correction APPENDS and supersedes the prior display value; it never
        // edits the original row. That is what makes the ledger replayable and
        // the correction itself auditable.
        originalId,
      );
      counts.corrections++;
    }
  }

  writeEdgeCases(db, epoch);
  return counts;
}

// ---------------------------------------------------------------------------
// Edge-case fixtures (p28)
// ---------------------------------------------------------------------------

/**
 * "Include edge cases: duplicate event, late arrival, correction, stale
 * projection, partial measure, revoked consent and cross-tenant request."
 *
 * Authored onto NAMED profiles rather than sprinkled by probability, so a
 * reviewer can be shown one. An edge case that occurs somewhere in 240 people
 * is an edge case nobody can demonstrate.
 *
 * Three of p28's seven are not data and are deliberately absent here: a stale
 * projection is a rebuild that has not run, and a cross-tenant request is a
 * denied read — both are exercised by tests rather than seeded, because
 * seeding them would mean writing the very rows the system exists to prevent.
 * The duplicate, the late arrival, the correction, the partial measure and the
 * revoked consent are all facts about a person, so they live here.
 */
export const EDGE_CASE_PROFILES = {
  duplicate: "ST-NE-002",
  lateArrival: "ST-MW-013",
  partialMeasure: "ST-SO-021",
  revokedConsent: "ST-WE-044",
} as const;

function writeEdgeCases(db: Database.Database, epoch: Date): void {
  const insEvent = db.prepare(
    `INSERT INTO longitudinal_events
       (id, tenant_id, person_id, event_type, payload_version, payload, actor_id,
        actor_type, occurred_at, recorded_at, source_system, provenance,
        correlation_id, supersedes_event_id)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'demo-generator', ?, ?, ?)`);
  const PROV = JSON.stringify({ fabricated: true, dataset_version: DATASET_VERSION, edge_case: true });
  const find = (id: string) => MANIFEST.find((r) => r.id === id)!;

  // DUPLICATE. The same clinical fact arriving twice with different ids, which
  // is what an at-least-once integration produces. The correlation id is what
  // makes them recognisable as one event rather than two.
  {
    const row = find(EDGE_CASE_PROFILES.duplicate);
    const person = popId("person", row.id);
    const tenant = tenantForRow(row);
    const corr = popId("corr", `${row.id}:dup`);
    for (const n of [1, 2]) {
      insEvent.run(
        popId("edge", `${row.id}:dup:${n}`), tenant, person, "coverage.reviewed",
        JSON.stringify({ note: "delivered twice by the feed", duplicateOf: corr, fabricated: true }),
        null, "integration",
        dayStamp(epoch, 120, 9), dayStamp(epoch, 120, 9 + n), PROV, corr, null,
      );
    }
  }

  // LATE ARRIVAL. Occurred long before it was recorded — the shape that makes
  // a recent month look empty and then fill in, and the reason the payer
  // console withholds incomplete months rather than plotting them low.
  {
    const row = find(EDGE_CASE_PROFILES.lateArrival);
    const person = popId("person", row.id);
    insEvent.run(
      popId("edge", `${row.id}:late`), tenantForRow(row), person, "coverage.measure_recorded",
      JSON.stringify({ instrument: "phq-9", lagDays: 74, fabricated: true }),
      null, "integration",
      dayStamp(epoch, 96, 9), dayStamp(epoch, 170, 9), PROV, null, null,
    );
  }

  // PARTIAL MEASURE. Started and not finished. Distinct from a missed one:
  // some items were answered, so a total cannot be scored but the attempt is
  // real. §29.1 requires partial data to stay visible rather than be rounded
  // into complete or absent.
  {
    const row = find(EDGE_CASE_PROFILES.partialMeasure);
    insEvent.run(
      popId("edge", `${row.id}:partial`), tenantForRow(row), popId("person", row.id),
      "measure.not_completed",
      JSON.stringify({
        instrument: "phq-9", dueOn: dayDate(epoch, 150), reason: "interrupted",
        partial: true, itemsAnswered: 4, itemsTotal: 9, fabricated: true,
      }),
      null, "patient", dayStamp(epoch, 150, 12), dayStamp(epoch, 150, 12), PROV, null, null,
    );
  }

  // REVOKED CONSENT. Recorded as an event AND on the consent row, because the
  // two answer different questions: the row says what is true now, the event
  // says when it changed and therefore which past readings were authorised.
  {
    const row = find(EDGE_CASE_PROFILES.revokedConsent);
    const person = popId("person", row.id);
    db.prepare("UPDATE consents SET revoked_at = ? WHERE user_id = ? AND scope = 'measurement'")
      .run(dayStamp(epoch, 160, 10), person);
    insEvent.run(
      popId("edge", `${row.id}:revoke`), tenantForRow(row), person, "consent.withdrawn",
      // `projectionId` names the consent row this event updates. Without it
      // the replay guard reports a gap — an event that claims a current-state
      // row it cannot identify — which is exactly what it did when this
      // fixture was first written, and exactly what it is for.
      JSON.stringify({
        projectionId: popId("consent", `${row.id}:measurement`),
        scope: "measurement", policyVersion: "demo-consent-v1", fabricated: true,
      }),
      person, "patient", dayStamp(epoch, 160, 10), dayStamp(epoch, 160, 10), PROV, null, null,
    );
  }
}
