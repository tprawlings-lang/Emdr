import { data } from "@/lib/data";

// Engagement (§29's clinician inventory; §30.2's "state: daily state, symptom,
// function, engagement, context").
//
// This is the chart with no drawn example in the handoff, and the one most
// likely to be built wrong, because the obvious version is an adherence score
// and adherence scores are how a person's worst month becomes evidence against
// them.
//
// THREE THINGS THIS DELIBERATELY IS NOT.
//
//   Not a streak. The member-side work removed check-in counts from every
//   member surface for a specific reason: a running total is a performance
//   demand, and it turns a missed day — often a bad day, the day this product
//   exists for — into a number shown on return. A clinician needs to see
//   engagement; nothing about that requires the shape that does the harm.
//
//   Not a percentage. "Engaged 68%" invites a threshold, and a threshold
//   invites a rule. What a clinician can act on is WHICH days and HOW LONG the
//   gap was, so that is what this returns.
//
//   Not a prediction. §29.1 forbids a predictive risk score, and "disengaging"
//   is one wearing a clinical word. A gap that has happened is a fact; a gap
//   that is about to happen is a guess.
//
// WHAT A GAP MEANS is the interpretive load this carries, and the projection
// cannot resolve it — only surface it. The person least likely to check in is
// often the person having the hardest time, so a gap is a reason to ask rather
// than a compliance failure. The screen says so; this module makes sure the
// gap is visible enough to ask about.

export interface EngagementDay {
  /** ISO date. */
  date: string;
  checkedIn: boolean;
  session: boolean;
  /** False for days before this person's record began. A day nobody could
   *  have checked in on is not a day they missed, and drawing the two the same
   *  way reported a six-day "longest gap" that was simply the week before
   *  enrolment. */
  enrolled: boolean;
}

export interface Engagement {
  days: EngagementDay[];
  windowDays: number;
  /** Days with a check-in, against the days available. Both halves, never a
   *  rate. */
  checkedInDays: number;
  /** Days inside the window on which this person was actually enrolled. The
   *  real denominator; `windowDays` is only the span asked for. */
  availableDays: number;
  sessionDays: number;
  /** Days since the most recent check-in. Null when there has never been one. */
  daysSinceCheckIn: number | null;
  /** The longest run with no check-in inside the window, and when it ran. The
   *  single most actionable number here: a clinician asks about a nine-day
   *  silence, not about a rate. */
  longestGap: { days: number; from: string; to: string } | null;
  /** True when the record starts inside the window — the person has not been
   *  enrolled long enough for the window to mean what it says. */
  partialWindow: boolean;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function buildEngagement(
  personId: string,
  tenantId: string,
  windowDays = 28,
): Promise<Engagement | null> {
  const c = await data();

  // Tenant scoped, like every other person-level read. The measures page
  // shipped without this once and read across tenants under the clinician's
  // own name.
  const person = (await c.get(
    "SELECT created_at FROM users WHERE id = ? AND tenant_id = ?",
    [personId, tenantId],
  )) as { created_at: string } | undefined;
  if (!person) return null;

  const since = new Date(Date.now() - (windowDays - 1) * 86400000);
  const sinceDay = isoDay(since);

  const checkins = (await c.all(
    "SELECT DISTINCT checkin_date FROM checkins WHERE user_id = ? AND checkin_date >= ?",
    [personId, sinceDay],
  )) as { checkin_date: string }[];
  const sessions = (await c.all(
    `SELECT DISTINCT substr(started_at, 1, 10) AS d FROM therapy_sessions
      WHERE user_id = ? AND substr(started_at, 1, 10) >= ?`,
    [personId, sinceDay],
  )) as { d: string }[];

  const checkedSet = new Set(checkins.map((r) => r.checkin_date));
  const sessionSet = new Set(sessions.map((r) => r.d));

  const startedOn = person.created_at.slice(0, 10);
  const days: EngagementDay[] = [];
  for (let i = 0; i < windowDays; i++) {
    const d = isoDay(new Date(since.getTime() + i * 86400000));
    days.push({
      date: d,
      checkedIn: checkedSet.has(d),
      session: sessionSet.has(d),
      enrolled: d >= startedOn,
    });
  }

  // The longest run of days with no check-in, inside the window. A trailing
  // run counts: the gap that is still open is the one worth asking about.
  let longest: Engagement["longestGap"] = null;
  let runStart: string | null = null;
  let run = 0;
  const closeRun = (endIdx: number) => {
    if (runStart && run > (longest?.days ?? 0)) {
      longest = { days: run, from: runStart, to: days[endIdx].date };
    }
    runStart = null;
    run = 0;
  };
  days.forEach((d, i) => {
    // A day before enrolment breaks the run rather than extending it: nobody
    // could have checked in, so it is neither a gap nor a presence.
    if (!d.enrolled) { closeRun(Math.max(0, i - 1)); return; }
    if (d.checkedIn) { closeRun(Math.max(0, i - 1)); return; }
    if (!runStart) runStart = d.date;
    run++;
  });
  closeRun(days.length - 1);

  // The most recent check-in may predate the window, so this is not read off
  // the grid.
  const last = (await c.get(
    "SELECT MAX(checkin_date) AS d FROM checkins WHERE user_id = ?",
    [personId],
  )) as { d: string | null } | undefined;
  const daysSinceCheckIn = last?.d
    ? Math.max(0, Math.round((Date.now() - new Date(`${last.d}T00:00:00Z`).getTime()) / 86400000))
    : null;

  return {
    days,
    windowDays,
    checkedInDays: days.filter((d) => d.checkedIn).length,
    availableDays: days.filter((d) => d.enrolled).length,
    sessionDays: days.filter((d) => d.session).length,
    daysSinceCheckIn,
    longestGap: longest,
    // An account created inside the window has fewer days available than the
    // window claims, and a reader comparing "12 of 28" against another person
    // needs to know that.
    partialWindow: person.created_at.slice(0, 10) > sinceDay,
  };
}
