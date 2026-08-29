import { data } from "@/lib/data";
import type { SlopeRow } from "@/components/charts/clinical";

// Session response (§29's clinician inventory; page example p61, chart p77).
//
// "Did sessions settle this person or stir them?" is the question, and it is
// answerable from two numbers a session already records: the activation
// reading at open and the one at close.
//
// THE HARD PART IS THE SESSIONS WITH NO CLOSE. A session that was paused,
// abandoned or is still running has an open reading and nothing else. Dropping
// those rows makes every remaining row a session that finished — and "sessions
// that finished settled this person" is a different and much weaker statement
// than "sessions settled this person", stated in the same words. §29.1
// requires missing data to remain visible, and the chart contract on p77 says
// it outright: "Missing close remains visible; no treatment claim."
//
// So an incomplete session keeps its row, shows its open reading alone, and
// says why there is no close.

/** How a session that recorded no close reading is described. Each is a fact
 *  about the session's own status, never an inference about the person. */
const NO_CLOSE: Record<string, string> = {
  in_progress: "still open — no close reading yet",
  abandoned: "left early — no close reading",
  hard_stop: "stopped by a safety rule",
};

export interface SessionResponse {
  rows: SlopeRow[];
  /** Sessions considered, including the ones with no close. */
  total: number;
  /** Sessions that recorded no OPENING reading and so cannot be placed on the
   *  scale at all. A different absence from a missing close, and one the chart
   *  cannot show by keeping a row — so it is counted and stated instead of
   *  disappearing into the gap between `total` and `rows.length`. */
  noOpening: number;
  /** How many of those recorded both readings. The denominator a reader needs
   *  before drawing any conclusion from the shape. */
  withClose: number;
  scaleMax: number;
}

export async function buildSessionResponse(
  personId: string,
  opts: { limit?: number } = {},
): Promise<SessionResponse | null> {
  const c = await data();
  const rows = (await c.all(
    `SELECT id, status, pre_suds, post_suds, substr(started_at, 1, 10) AS day
       FROM therapy_sessions
      WHERE user_id = ?
      ORDER BY started_at DESC
      LIMIT ?`,
    [personId, opts.limit ?? 6],
  )) as { id: string; status: string; pre_suds: number | null; post_suds: number | null; day: string }[];

  // A session with no OPEN reading has nothing to place on the scale at all,
  // so it cannot appear here. That is a different absence from a missing
  // close, and the count below is what makes it visible rather than silent.
  const usable = rows.filter((r) => r.pre_suds !== null).reverse();
  if (usable.length === 0) return null;

  return {
    rows: usable.map((r) => ({
      label: r.day.slice(5),
      open: r.pre_suds as number,
      // A hard stop's post reading is recorded, and it is the most important
      // one on the chart — it is the session that went the wrong way. It is
      // NOT treated as missing.
      close: r.post_suds,
      incomplete: r.post_suds === null ? (NO_CLOSE[r.status] ?? "no close reading") : undefined,
    })),
    total: rows.length,
    noOpening: rows.length - usable.length,
    withClose: usable.filter((r) => r.post_suds !== null).length,
    scaleMax: 10,
  };
}
