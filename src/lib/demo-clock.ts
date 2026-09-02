import { data } from "./data";
import { CALENDAR_DAYS, demoEpoch } from "./demo-population-calendar";

// The demo clock (handoff 07 §1.5, p9).
//
//   Advance clock — move demo date to a scripted milestone.
//   Guard: demo only; clock shown in shell.
//
// WHAT IT DOES. The fabricated population spans a fixed year of operation
// ending at the real today. The clock picks a VIEWING POINT inside that span,
// so a presenter can open the same console at two moments in the programme's
// life and watch the windows, the retention milestones and the planning
// signals move. It is time travel over a fixed dataset, not a simulation that
// runs forward.
//
// WHAT IT MUST NEVER DO, and this is the whole safety argument:
//
//   IT MOVES THE READING FRAME, NEVER THE RECORD.
//
// Audit entries, session issue and expiry, rate limits and the seeded
// timestamps themselves stay on the real clock. A demo clock that could
// backdate an audit row would turn a tamper-evident chain into a chain of
// whatever somebody set the date to. One that could move a session's expiry
// would be a privilege escalation with a friendly name — set the clock back an
// hour, keep a session alive forever; set it forward, end somebody else's.
// `tests/demo-clock.test.ts` fails the build if `demoNow` reaches either.
//
// So this module is imported by the READ path — metric windows, planning
// windows, the observation loader's cut-off — and by nothing that writes a
// governance record.

/** A named point in the fabricated programme's life. p9 asks for a scripted
 *  milestone rather than an arbitrary date, and the name is what a presenter
 *  says out loud while they click it. */
export interface Milestone {
  id: string;
  label: string;
  /** Days from the start of the fabricated calendar. */
  day: number;
  /** What a reader should expect to look different here. */
  shows: string;
}

/**
 * The milestones, derived from the calendar rather than typed as dates.
 *
 * Derived because the calendar is one constant and a hard-coded date would
 * drift from it the first time the span changed — leaving a milestone called
 * "half year" pointing somewhere else entirely, with nothing to say so.
 */
export const MILESTONES: Milestone[] = [
  {
    id: "opening",
    label: "Opening month",
    day: 30,
    shows:
      "The founding cohort has just enrolled. Retention is unobservable at every milestone, " +
      "most measures are not yet due, and the planning rules have nothing to compare.",
  },
  {
    id: "first-quarter",
    label: "First quarter",
    day: 90,
    shows:
      "One window of history. The two-window rules still produce nothing, and the reason " +
      "they give is the honest one rather than a threshold.",
  },
  {
    id: "half-year",
    label: "Half year",
    day: Math.round(CALENDAR_DAYS / 2),
    shows:
      "Two full windows, the founding cohort at its six-month follow-up, and the first " +
      "intake since. Most rules become evaluable here.",
  },
  {
    id: "three-quarters",
    label: "Three quarters",
    day: Math.round(CALENDAR_DAYS * 0.75),
    shows: "The access barrier has been running long enough to show in a follow-up gap.",
  },
  {
    id: "today",
    label: "Today",
    day: CALENDAR_DAYS,
    shows: "The full year. What the console shows when the clock is live.",
  },
];

export function milestone(id: string): Milestone | null {
  return MILESTONES.find((m) => m.id === id) ?? null;
}

export interface ClockState {
  /** The instant the environment is being read as. */
  now: Date;
  /** True when the clock is the real one. */
  live: boolean;
  milestone: Milestone | null;
  reason: string | null;
  setBy: string | null;
  /** Real time, always. */
  setAt: string | null;
}

/** The date a milestone resolves to, against the fabricated calendar. */
export function milestoneDate(m: Milestone, realNow = Date.now()): Date {
  return new Date(demoEpoch(realNow).getTime() + m.day * 86400000);
}

/**
 * Read the clock.
 *
 * FAILS OPEN TO LIVE. Every error path here returns the real clock rather than
 * throwing: a demo control that can take the whole product down when its table
 * is missing is worse than no demo control, and "the clock is the real one" is
 * both the safe answer and the true one for any environment that has never set
 * it.
 */
export async function readClock(): Promise<ClockState> {
  const live: ClockState = {
    now: new Date(), live: true, milestone: null, reason: null, setBy: null, setAt: null,
  };
  // Outside a demo environment the clock does not exist, and the check is here
  // rather than only at the setter so that a row surviving an environment
  // change cannot take effect.
  if (process.env.EMDR_DEMO !== "1") return live;

  try {
    const c = await data();
    const row = (await c.get("SELECT * FROM demo_clock WHERE id = 1", [])) as
      | Record<string, unknown> | undefined;
    if (!row || !row.viewing_at) return live;
    const at = new Date(String(row.viewing_at).replace(" ", "T") + "Z");
    if (Number.isNaN(at.getTime())) return live;
    return {
      now: at,
      live: false,
      milestone: row.milestone ? milestone(String(row.milestone)) : null,
      reason: row.reason ? String(row.reason) : null,
      setBy: row.set_by ? String(row.set_by) : null,
      setAt: row.set_at ? String(row.set_at) : null,
    };
  } catch {
    return live;
  }
}

/** What "now" means for anything that READS the fabricated data. */
export async function demoNow(): Promise<Date> {
  return (await readClock()).now;
}

/** The same, as a calendar date, which is what every window boundary wants. */
export async function demoToday(): Promise<string> {
  return (await demoNow()).toISOString().slice(0, 10);
}

export type ClockRefusal = { ok: false; reason: string };
export type ClockOutcome = { ok: true; state: ClockState } | ClockRefusal;

/**
 * Move the clock to a milestone, or back to live.
 *
 * Refuses outside a demo environment, refuses an unknown milestone, and
 * refuses without a reason — p9 guards the reset control with a typed
 * confirmation and a reason, and a clock moved for no recorded purpose is a
 * clock nobody can explain when a screen looks wrong an hour later.
 *
 * The caller is responsible for checking the ROLE. This function does not read
 * a session: it is called from a server action and from a route, and an
 * authorization check that lives in two places is an authorization check that
 * will differ in one of them.
 */
export async function setClock(args: {
  milestoneId: string | null;
  reason: string;
  actorId: string;
}): Promise<ClockOutcome> {
  if (process.env.EMDR_DEMO !== "1") {
    return { ok: false, reason: "The demo clock exists only in a demonstration environment." };
  }
  if (args.reason.trim().length < 4) {
    return { ok: false, reason: "A reason is required, so the clock can be explained later." };
  }

  const c = await data();
  if (args.milestoneId === null) {
    await c.run(
      `INSERT INTO demo_clock (id, viewing_at, milestone, reason, set_by, set_at)
       VALUES (1, NULL, NULL, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         viewing_at = NULL, milestone = NULL, reason = excluded.reason,
         set_by = excluded.set_by, set_at = excluded.set_at`,
      [args.reason.trim(), args.actorId, new Date().toISOString().slice(0, 19).replace("T", " ")],
    );
    return { ok: true, state: await readClock() };
  }

  const m = milestone(args.milestoneId);
  if (!m) return { ok: false, reason: `"${args.milestoneId}" is not a scripted milestone.` };

  // Never into the future. A clock set past the real today would report a
  // window in which nothing could have happened, and every screen would read
  // as an environment that had stopped.
  const target = new Date(Math.min(milestoneDate(m).getTime(), Date.now()));
  await c.run(
    `INSERT INTO demo_clock (id, viewing_at, milestone, reason, set_by, set_at)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       viewing_at = excluded.viewing_at, milestone = excluded.milestone,
       reason = excluded.reason, set_by = excluded.set_by, set_at = excluded.set_at`,
    [
      target.toISOString().slice(0, 19).replace("T", " "),
      m.id, args.reason.trim(), args.actorId,
      new Date().toISOString().slice(0, 19).replace("T", " "),
    ],
  );
  return { ok: true, state: await readClock() };
}
