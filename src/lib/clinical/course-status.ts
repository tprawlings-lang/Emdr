// What the Course landing says about THIS person (17 September handoff, P4).
//
//   "Course — show actual status beside measures, goals, responses, and
//   trajectory. The landing page informs and links."
//
// The landing already linked. What it said beside each link was a description
// of the SCREEN — "the scored instruments over time", "what they have been
// exposed to" — which is identical for every person on the caseload and so
// tells a clinician standing in front of one of them nothing at all. Four
// links and four generic sentences is a menu, and a menu makes you open all
// four to find out which one is worth opening.
//
// SO EACH LINE NOW CARRIES A FACT ABOUT THE RECORD UNDERNEATH IT: how many
// instruments have been scored and when the last one was, how many goals are
// set and whether any is waiting on a decision, how many exposures are on file
// and how many windows nobody filled in, how many domains could be read and how
// many are held for want of readings.
//
// WHAT THESE SENTENCES ARE NOT is a summary of the findings. Not a direction,
// not a state, not "improving" — the four screens exist because their answers
// can disagree, and a landing page that reported the answers would be the
// composite the trajectory policy refuses, assembled one line at a time. Every
// sentence here is about the RECORD: what has been collected, and when. That is
// the question a landing page can answer honestly, and it is the one that
// decides which link to click.
//
// AND ABSENCE IS ITS OWN SENTENCE, never a zero. "0 goals" and "no goal has
// been set with this person" read differently to somebody deciding where to
// spend the next four minutes, and the second one is the truth.
//
// The sentence builders are pure and take plain counts, so the wording is
// testable without a database and the loader below is the only part that needs
// one.

import { data } from "@/lib/data";
import type { TenantContext } from "@/lib/repository";
import { listGoals, observationsFor } from "@/lib/clinical/return-to-life";
import { listInstances, syncInterventionInstances } from "@/lib/clinical/interventions";
import { observationsForPerson, syncResponseObservations } from "@/lib/clinical/response-observations";
import { missingWindowsFor } from "@/lib/clinical/response-vocabulary";
import { computeTrajectory } from "@/lib/clinical/recovery-trajectory";

export interface CourseStatus {
  /** The sentence shown under the link. */
  said: string;
  /** False when the record holds nothing for this reading yet. */
  recorded: boolean;
}

export interface CourseReading extends CourseStatus {
  /** Path under the person's record, e.g. "/measures". */
  slug: string;
  label: string;
  /** What the screen answers. Constant across people, unlike `said`. */
  note: string;
}

const DAY = 86400000;

function daysSince(from: string, asOf: string): number | null {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${asOf.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / DAY));
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// The four sentences
// ---------------------------------------------------------------------------

export function measuresStatus(
  f: { instruments: number; latest: string | null },
  asOf: string
): CourseStatus {
  if (f.instruments === 0 || !f.latest) {
    return { said: "No instrument has been scored, so there is nothing to read here yet.", recorded: false };
  }
  const gap = daysSince(f.latest, asOf);
  const when =
    gap === null ? `last scored ${f.latest.slice(0, 10)}`
    : gap === 0 ? "last scored today"
    : `nothing scored in the ${plural(gap, "day", "days")} since ${f.latest.slice(0, 10)}`;
  return { said: `${plural(f.instruments, "instrument", "instruments")} on file, ${when}.`, recorded: true };
}

export function goalsStatus(f: { total: number; awaitingDecision: number }): CourseStatus {
  if (f.total === 0) {
    // NOT "no progress". A goal nobody has set and a goal nobody has met are
    // different facts, and only one of them is about the person.
    return { said: "No goal has been set with this person yet.", recorded: false };
  }
  const waiting =
    f.awaitingDecision === 0
      ? "nothing waiting on a decision"
      : `${plural(f.awaitingDecision, "observation", "observations")} waiting on a decision`;
  return { said: `${plural(f.total, "goal", "goals")} set, ${waiting}.`, recorded: true };
}

export function responsesStatus(f: { exposures: number; windowsMissing: number }): CourseStatus {
  if (f.exposures === 0) {
    return { said: "Nothing has been recorded as given to this person yet.", recorded: false };
  }
  // The missing windows are named here rather than left to the screen, because
  // they are the reason to open it: an exposure with no observation after it is
  // work outstanding, and it looks exactly like a settled one from a distance.
  const missing =
    f.windowsMissing === 0
      ? "every expected window observed"
      : `${plural(f.windowsMissing, "window", "windows")} with nothing observed`;
  return { said: `${plural(f.exposures, "exposure", "exposures")} recorded, ${missing}.`, recorded: true };
}

export function trajectoryStatus(f: { read: number; held: number }): CourseStatus {
  if (f.read === 0 && f.held === 0) {
    return { said: "No domain has any comparable readings yet.", recorded: false };
  }
  if (f.read === 0) {
    return {
      said: `${plural(f.held, "domain", "domains")} on file, none with enough comparable readings to be read.`,
      recorded: false,
    };
  }
  const held = f.held === 0 ? "none held" : `${f.held} held for want of readings`;
  return { said: `${plural(f.read, "domain", "domains")} read, ${held}.`, recorded: true };
}

// ---------------------------------------------------------------------------
// The loader
// ---------------------------------------------------------------------------

const SECTIONS = {
  measures: {
    slug: "/measures",
    label: "Measures",
    note: "The scored instruments over time, each on its own validated scale.",
  },
  goals: {
    slug: "/goals",
    label: "Life goals",
    note: "What this person is trying to get back to, and whether it is moving.",
  },
  responses: {
    slug: "/responses",
    label: "Observed responses",
    note: "What they have been exposed to and what was observed after it, window by window.",
  },
  trajectory: {
    slug: "/trajectory",
    label: "Recovery trajectory",
    note: "Whether the course has changed, domain by domain, against their own earlier windows.",
  },
} as const;

/**
 * The four readings, in reading order, each with a line about this record.
 *
 * `asOf` is the caller's reading frame, so the demo clock moves the "days
 * since" the way it moves every other age on a clinician screen.
 */
export async function courseReadings(
  ctx: TenantContext, personId: string, args: { asOf: string }
): Promise<CourseReading[]> {
  const c = await data();

  // Measures: distinct instruments with at least one score, and the newest.
  const scored = (await c.all(
    "SELECT instrument, MAX(created_at) AS latest FROM screenings WHERE user_id = ? GROUP BY instrument",
    [personId]
  )) as { instrument: string; latest: string }[];
  const latest = scored.map((r) => r.latest).sort().at(-1) ?? null;

  // Goals: every status the detail screen lists, so the count matches it.
  const goals = await listGoals(ctx, personId, ["draft", "active", "paused", "completed"]);
  const proposed = await Promise.all(
    goals.map(async (g) => (await observationsFor(ctx, g.id)).filter((o) => o.status === "proposed").length)
  );

  // Responses: exposures on file, and the windows nobody filled in.
  //
  // RECONSTRUCTED FIRST, because the instance table is a derived cache of
  // sessions and practices that the Responses screen rebuilds on every read.
  // Counting it without that step reported "nothing has been recorded as given
  // to this person" beside a link to a screen that said "24 exposures across 6
  // interventions" — the landing was reporting the state of the cache and
  // calling it the state of the record. Both syncs are idempotent on their
  // source ids, so this converges instead of accumulating, and it is the same
  // pair the destination runs in the same order: the two counts now agree by
  // construction rather than by whoever opened which screen first.
  await syncInterventionInstances(ctx, personId);
  await syncResponseObservations(ctx, personId);

  const instances = await listInstances(ctx, personId);
  const observations = await observationsForPerson(ctx, personId);
  const windowsMissing = instances.reduce(
    (n, i) => n + missingWindowsFor(i, observations).length, 0
  );

  // Trajectory: the same computation the detail screen runs, counted.
  const set = await computeTrajectory(ctx, personId, { asOf: args.asOf });
  const read = set.snapshots.filter((s) => s.state !== "insufficient_data").length;

  return [
    { ...SECTIONS.measures, ...measuresStatus({ instruments: scored.length, latest }, args.asOf) },
    {
      ...SECTIONS.goals,
      ...goalsStatus({ total: goals.length, awaitingDecision: proposed.reduce((a, b) => a + b, 0) }),
    },
    { ...SECTIONS.responses, ...responsesStatus({ exposures: instances.length, windowsMissing }) },
    { ...SECTIONS.trajectory, ...trajectoryStatus({ read, held: set.snapshots.length - read }) },
  ];
}
