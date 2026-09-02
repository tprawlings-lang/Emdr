import type { ManifestRow } from "./demo-population-manifest";
import { seedFor } from "./demo-population-manifest";

// The demo calendar (handoff 07 §2.4 p14, §2.8 p29).
//
// TWO DIFFERENT THINGS WERE ONE NUMBER. `DEMO_DAYS = 180` meant both "how long
// the generated history runs" and "how long each person has been enrolled",
// and because every profile started inside a fortnight the two were
// indistinguishable. They are not the same thing, and collapsing them cost
// something concrete: the planning engine's two-window rules could never fire,
// because the second window contained one entrant. A service with no intake
// has no stage conversion to compare.
//
// So they separate here:
//
//   CALENDAR_DAYS   how long this fabricated service has been operating
//   PERSON_DAYS     the longest any one profile is observed for
//   enrolmentDayFor when a given profile joined, spread across the calendar
//
// Everything downstream is PERSON-RELATIVE. A profile's archetype curve, its
// authored gap, its measure schedule and its safety event are all offsets from
// the day that person enrolled, not from the day the fabricated service opened.
// Before this split they were offsets from the service's opening day and it
// worked only because everyone opened with it.

/** How long the fabricated service has been running. */
export const CALENDAR_DAYS = 360;

/**
 * The tail of the calendar the GENERATOR does not write.
 *
 * Those days are lived instead, by the agent behaviour layer, through the
 * product's own machinery — the check-in routing rule, the safety gate engine,
 * the spine recorders — rather than written straight into the tables.
 *
 * WHY RESERVE A TAIL AT ALL. The generator is fast and deterministic and it
 * bypasses the product entirely: it has never called the gate engine, so the
 * strongest claim the demonstration could make about safety was that ten fixed
 * scenarios replay correctly. Reserving the most recent weeks means the window
 * every metric and every planning rule actually reads is the window that went
 * through the machinery.
 *
 * FOURTEEN DAYS, not the whole calendar. Living a year through the product
 * would take minutes where a reset takes seconds, and p29 puts a 120-second
 * ceiling on a reset. Fourteen days is enough for the gate engine to refuse
 * things, for a safety event to be raised and answered, and for the most
 * recent window to be genuinely lived — and cheap enough to stay inside the
 * budget.
 */
export const AGENT_HORIZON = 14;

/** The last day the generator writes. Everything after it belongs to the
 *  agents. */
export const GENERATED_DAYS = CALENDAR_DAYS - AGENT_HORIZON;

/** The longest window any single profile is observed across — p14's six
 *  months. A profile that enrolled two months ago is observed for two months,
 *  not for six. */
export const PERSON_DAYS = 180;

/**
 * When a profile enrolled, as a day offset from the start of the calendar.
 *
 * WEIGHTED, not uniform. Roughly two thirds land in the first half of the
 * calendar and the rest arrive across the second, which is the shape of a
 * service that opened with a cohort and has taken referrals since. A uniform
 * spread would give every window the same number of entrants and make the
 * "for two windows" rules trivially satisfiable — the opposite failure from
 * the one this fixes, and just as unrealistic.
 *
 * Deterministic in the profile seed, like everything else here, so a reset
 * reproduces the same intake.
 */
export function enrolmentDayFor(row: ManifestRow): number {
  // HASHED, not the raw seed. `seedFor` is a region offset plus a row number —
  // 100 001 in the Northeast, 200 001 in the Midwest — so `seed % 170` starts
  // each region at a different phase and intake date becomes correlated with
  // region. Measured on the first version: 3 Midwest entrants in one window
  // and 17 in the next, against 16 and 6 in the Northeast. That is a spurious
  // regional access artefact, manufactured by an arithmetic accident, in a
  // console whose job is to find real ones. The confounds in this population
  // are authored on purpose; this one was not.
  const seed = mix(seedFor(row));
  // Two independent draws off the same hash, so the split is stable per
  // profile rather than depending on iteration order.
  const established = seed % 3 !== 0;
  return established
    // The founding cohort: the first 180 days, so every one of them has a full
    // six-month window.
    ? seed % (CALENDAR_DAYS - PERSON_DAYS)
    // Continuing intake across the recent half. `% 170` rather than `% 180`
    // leaves the last ten days clear: a profile that enrolled yesterday has no
    // activity to generate and would appear on every screen as a person who
    // did nothing.
    : (CALENDAR_DAYS - PERSON_DAYS) + (seed % (PERSON_DAYS - 10));
}

/**
 * A cheap avalanche hash, so adjacent seeds land far apart.
 *
 * The profile seeds are consecutive within a region and offset by a round
 * hundred thousand between regions, which is exactly the input pattern that
 * makes `%` produce structure. This is the standard 32-bit finalizer; it needs
 * no cryptographic property, only that neighbouring inputs stop being
 * neighbouring outputs.
 */
function mix(n: number): number {
  let x = n >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** How many days this profile has actually been observed. Capped at
 *  PERSON_DAYS for the founding cohort, and shorter for anybody who arrived
 *  since. */
export function exposureDaysFor(row: ManifestRow): number {
  return Math.min(PERSON_DAYS, CALENDAR_DAYS - enrolmentDayFor(row));
}

/** How much of a person's exposure the GENERATOR is responsible for. The rest
 *  is the agents', and the two together are the person's whole history. */
export function generatedDaysFor(row: ManifestRow): number {
  return Math.max(0, Math.min(exposureDaysFor(row), GENERATED_DAYS - enrolmentDayFor(row)));
}

/** The window the agents live, for one person, as day offsets from their own
 *  enrolment. Empty for somebody who enrolled inside the agent horizon and has
 *  no generated history at all — they are lived from their first day. */
export function agentWindowFor(row: ManifestRow): { from: number; to: number } {
  const start = enrolmentDayFor(row);
  return {
    from: Math.max(0, GENERATED_DAYS - start),
    to: Math.min(PERSON_DAYS, CALENDAR_DAYS - start),
  };
}

/**
 * p14's per-person ranges, scaled to what the person was actually there for.
 *
 * p14 states 18–90 check-ins, 4–8 measures, 8–55 modules. Read literally
 * against a rolling intake those bounds are impossible: somebody who enrolled
 * three weeks ago cannot have eighteen check-ins, and requiring it means the
 * population can only ever be one cohort that all started on the same day —
 * which is exactly the constraint that made the planning engine unfirable.
 *
 * So the bound is read as what it plainly describes: a person observed for the
 * full six months. Anybody observed for less is held to the same RATE. The
 * quality manifest checks against this rather than against the flat numbers,
 * so a generator that shortchanged a recent arrival still fails.
 */
export function scaledRange(
  range: readonly [number, number], exposureDays: number, floor = 1,
): [number, number] {
  const share = Math.min(1, exposureDays / PERSON_DAYS);
  const low = Math.max(range[0] > 0 ? floor : 0, Math.floor(range[0] * share));
  return [low, Math.max(low, Math.ceil(range[1] * share))];
}

/**
 * The floor a measure schedule cannot go below, whatever the exposure.
 *
 * TWO, not one, and it is structural rather than a tuning choice: the
 * generator pins the first due measure to the manifest's baseline and the last
 * to its follow-up, so a profile with any measure schedule at all has both. It
 * is also the smallest number that means anything — "observed change" is
 * defined over a PAIR, and a person with one measure contributes to no paired
 * metric in the dictionary.
 */
export const MIN_MEASURES = 2;

/** The day the fabricated service opened, as a real date. Every timestamp in
 *  the generator is `epoch + offset`, never a wall clock read mid-generation —
 *  two rows written a millisecond apart would otherwise land on different days
 *  near midnight. */
export function demoEpoch(now = Date.now()): Date {
  const d = new Date(now - CALENDAR_DAYS * 86400000);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
