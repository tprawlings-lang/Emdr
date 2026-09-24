// When a questionnaire may be given again — and the one writer that enforces
// it (Expansion Handoff Phase 0, "screener retake bypass"; §4, "Scheduled
// measurement").
//
//   "Cadence can never be shorter than each instrument's published recall
//    window (for example, two weeks for PHQ-9 and GAD-7, one month for PCL-5
//    and ITQ). This is also the fix pattern for the retake bypass."
//
// THE BYPASS. The seven-day wait on the weekly measures lived in one place: the
// "Begin" link on /app/measures, which was hidden until a measure was due. The
// questionnaire page behind the link did not check, the web action that saved
// it did not check, and the mobile route saved any instrument at any time. A
// member could take the same questionnaire five times in an afternoon, and
// every copy landed in the trend a clinician reads.
//
// AND THE WAIT WAS SHORTER THAN THE QUESTION. The weekly trauma measures asked
// "in the past month" every seven days, so each answer re-reported three weeks
// the previous one had already covered. The decision (2026-09-24) is to keep
// the weekly rhythm and ask about the past week instead. The PTSD checklist is
// published in a past-week form by its authors' home, the US National Center
// for PTSD ("PCL-5, Past Week", listed beside the standard past-month form at
// ptsd.va.gov/professional/assessment/adult-sr/ptsd-checklist.asp). That is a
// change to the words of a validated instrument, so it waits for the
// psychologists' signature (WEEKLY_WORDING_APPROVAL). Until it lands, the
// standard past-month wording runs on its own window, thirty days: measurement
// continues on wording that is approved, instead of stopping.
//
// The ITQ has no published past-week version that this build knows of, so it
// stays on its past-month wording and its thirty-day window. Whether to adapt
// it is the psychologists' question, recorded in the decision register.

import { data } from "../data";
import { newId } from "../db";
import { encryptField } from "../crypto";
import { getInstrument, type Instrument } from "../instruments";

const DAY_MS = 86_400_000;

export interface WordingApproval {
  approvedBy: string | null;
  approvedAt: string | null;
  covers: string[];
}

/** Null until the clinical advisors sign the past-week wording. Flipping it is
 *  a reviewed change on its own, never part of another one. */
export const WEEKLY_WORDING_APPROVAL: WordingApproval = {
  approvedBy: null,
  approvedAt: null,
  covers: [
    "the PCL-5 instruction changed from \"In the past month\" to \"In the past week\"",
    "scores from the past-week wording sitting in the same trend as past-month scores",
    "the ten-point rise that raises a review, applied to week-to-week readings",
  ],
};

export function weeklyWordingApproved(a: WordingApproval = WEEKLY_WORDING_APPROVAL): boolean {
  return a.approvedBy !== null && a.approvedAt !== null;
}

function pastWeek(base: Instrument): Instrument {
  const from = "In the past month";
  const to = "In the past week";
  if (!base.intro.includes(from)) {
    // Fail at load, not quietly: a past-week form whose instructions still say
    // "month" would ask one thing and be scheduled as another.
    throw new Error(`${base.id}: cannot derive a past-week form — "${from}" is not in its instructions.`);
  }
  return {
    ...base,
    version: "past week",
    intro: base.intro.replace(from, to),
    recallDays: 7,
    recallPhrase: to,
  };
}

/** The repeated measures a member takes between visits. */
export const TRACKED_MEASURES: ReadonlyArray<{ id: "pcl-5" | "itq"; pastWeek: Instrument | null }> = [
  { id: "pcl-5", pastWeek: pastWeek(getInstrument("pcl-5")!) },
  { id: "itq", pastWeek: null },
];

export function isTracked(id: string): boolean {
  return TRACKED_MEASURES.some((t) => t.id === id);
}

/** The form a member is given for a repeated measure right now: the past-week
 *  wording once it is signed, the standard wording until then. */
export function trackedForm(id: string, approval: WordingApproval = WEEKLY_WORDING_APPROVAL): Instrument | undefined {
  const t = TRACKED_MEASURES.find((m) => m.id === id);
  if (!t) return undefined;
  if (t.pastWeek && weeklyWordingApproved(approval)) return t.pastWeek;
  return getInstrument(id);
}

export interface MeasureWindow {
  form: Instrument;
  lastAt: number | null;
  /** When it may next be given. Null when it has never been taken. */
  opensAt: number | null;
  open: boolean;
  /** Whole days until it opens, rounded up; 0 when open. */
  daysUntilOpen: number;
}

function stampMs(s: string): number {
  return new Date(s.replace(" ", "T") + "Z").getTime();
}

/** Whether `form` may be given now. Measured from the last answer to the same
 *  instrument in ANY wording and from ANY path — baseline, weekly, web or
 *  mobile — because the member's memory of the last month does not know which
 *  screen asked. */
export async function measureWindow(userId: string, form: Instrument, nowMs: number): Promise<MeasureWindow> {
  const c = await data();
  const last = (await c.get(
    `SELECT created_at FROM screenings WHERE user_id = ? AND instrument = ?
      ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [userId, form.id]
  )) as { created_at: string } | undefined;
  if (!last) return { form, lastAt: null, opensAt: null, open: true, daysUntilOpen: 0 };
  const lastAt = stampMs(last.created_at);
  const opensAt = lastAt + form.recallDays * DAY_MS;
  const open = nowMs >= opensAt;
  return { form, lastAt, opensAt, open, daysUntilOpen: open ? 0 : Math.ceil((opensAt - nowMs) / DAY_MS) };
}

export class MeasureNotOpen extends Error {
  constructor(public readonly window: MeasureWindow) {
    super(`${window.form.id} was last answered inside its ${window.form.recallDays}-day window.`);
  }
}

/**
 * The one writer for questionnaire answers. Every submit path calls this, and
 * tests/measure-cadence.test.ts fails if a new path writes `screenings` for an
 * instrument without it. It refuses inside the window rather than saving a
 * copy the trend would then have to explain.
 *
 * Returns the previous total on the SAME wording, for the rise check: a
 * past-week score is not compared against a past-month one as if they measured
 * the same stretch of time.
 */
export async function saveMeasureResponse(args: {
  userId: string;
  form: Instrument;
  answers: number[];
  total: number;
  riskFlags: string[];
  nowMs: number;
}): Promise<{ previousTotal: number | null }> {
  const window = await measureWindow(args.userId, args.form, args.nowMs);
  if (!window.open) throw new MeasureNotOpen(window);
  const c = await data();
  const previous = (await c.get(
    `SELECT total_score FROM screenings WHERE user_id = ? AND instrument = ? AND instrument_version = ?
      ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [args.userId, args.form.id, args.form.version]
  )) as { total_score: number } | undefined;
  await c.run(
    `INSERT INTO screenings (id, user_id, instrument, instrument_version, total_score, answers_json, risk_flags_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newId(), args.userId, args.form.id, args.form.version, args.total,
     encryptField(JSON.stringify(args.answers)), JSON.stringify(args.riskFlags)]
  );
  return { previousTotal: previous?.total_score ?? null };
}
