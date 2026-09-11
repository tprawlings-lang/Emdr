// What the pilot's participants actually entered.
//
// THE PILOT HAD NOWHERE TO READ ITSELF. Enrollment shipped with a gate, a cap,
// a count and no way to see a single answer — the whole point of asking real
// people to use this is what they then say, and "3 of 25 places used" is not
// that. This is the read model behind the screen that answers it.
//
// ONE POPULATION, AND THAT IS NOT A DETAIL. Everything here is scoped to the
// pilot tenant, which holds only people whose provenance is 'real'. The same
// rule `assertSingleProvenance` enforces on metrics applies to a screen: a
// table mixing fabricated profiles with pilot participants would be a table
// nobody can read a conclusion from, and the reader would have no way to tell.
//
// COUNTS, NEVER PERCENTAGES. With a cap of twenty-five, "67% completed
// onboarding" means two people out of three, and rounding it into a percentage
// is how a pilot starts sounding like a finding. Every number below is a whole
// number of people, and the denominator is always beside it.
//
// IT IS NOT A CLINICAL SURFACE. Nothing here routes anybody, changes a gate, or
// tells a clinician to act. It is the operator reading what the pilot produced,
// and the screen says so — because a table of real people's safety answers
// laid out like a caseload will be read as a caseload otherwise.

import { data } from "../data";
import { FITNESS_ITEMS, FITNESS_SCREENER_ID } from "../fitness-screener";
import { INSTRUMENTS } from "../instruments";
import { PILOT_TENANT_ID } from "./gate";

/** How far through onboarding somebody has actually got. Derived from what
 *  they have written rather than from a stored step number, which would drift
 *  the moment somebody went back. */
export type Stage = "signed_up" | "consented" | "screened" | "measured" | "active";

export const STAGE_LABEL: Record<Stage, string> = {
  signed_up: "Signed up",
  consented: "Consented",
  screened: "Fit questions done",
  measured: "Baseline measures done",
  active: "Checking in",
};

export interface FitAnswer {
  /** The question as the person read it — not an id. A console showing
   *  `selfharm_30d` makes the reader reconstruct what was asked. */
  question: string;
  yes: boolean;
  /** What answering yes does: a hard stop, a soft flag, or nothing. */
  onYes: string;
}

export interface Participant {
  personId: string;
  name: string;
  joinedAt: string;
  stage: Stage;
  /** null when they have not taken the fit questions yet. */
  fit: null | {
    outcome: "hard_stop" | "soft_flag" | "pass";
    takenAt: string;
    /** Only the ones they answered yes to. The full eight are on the screen
     *  once, not repeated per person. */
    positives: FitAnswer[];
  };
  measures: { instrument: string; title: string; score: number; cutoff: number; takenAt: string }[];
  checkins: number;
  lastCheckin: null | { date: string; action: string; harmUrge: boolean; feelsSafe: boolean };
  /** Check-ins where the routing decision was crisis or the harm-urge item was
   *  positive. The number that matters most on this screen. */
  safetyPositives: number;
}

export interface PilotSummary {
  participants: number;
  reachedActive: number;
  totalCheckins: number;
  /** People — not events — with at least one safety positive. */
  peopleWithSafetyPositive: number;
  hardStopped: number;
}

interface UserRow { id: string; name: string; created_at: string }

/**
 * Every pilot participant, with what they have entered.
 *
 * Reads the pilot tenant directly rather than going through the clinical
 * projections: those are tenant-scoped to a care network and shaped for a
 * clinician's decision, and this is neither. Going through them would have
 * meant either widening a clinical read model to a population it was not
 * written for, or inventing a second definition of "who is enrolled".
 */
export async function pilotParticipants(): Promise<Participant[]> {
  const c = await data();
  const users = (await c.all(
    `SELECT u.id, u.name, u.created_at
       FROM users u JOIN persons p ON p.id = u.id
      WHERE u.tenant_id = ? AND u.role = 'member' AND p.provenance = 'real'
      ORDER BY u.created_at DESC`,
    [PILOT_TENANT_ID],
  )) as UserRow[];
  if (users.length === 0) return [];

  const ids = users.map((u) => u.id);
  const marks = ids.map(() => "?").join(", ");

  const screenings = (await c.all(
    `SELECT user_id, instrument, total_score, risk_flags_json, created_at
       FROM screenings WHERE user_id IN (${marks}) ORDER BY created_at ASC`,
    ids,
  )) as { user_id: string; instrument: string; total_score: number; risk_flags_json: string; created_at: string }[];

  const checkins = (await c.all(
    `SELECT user_id, checkin_date, recommended_action, harm_urge, feels_safe
       FROM checkins WHERE user_id IN (${marks}) ORDER BY checkin_date ASC`,
    ids,
  )) as { user_id: string; checkin_date: string; recommended_action: string; harm_urge: number; feels_safe: number }[];

  const consented = new Set(
    ((await c.all(
      `SELECT DISTINCT user_id FROM consents
        WHERE user_id IN (${marks}) AND scope = 'care_program_full' AND revoked_at IS NULL`,
      ids,
    )) as { user_id: string }[]).map((r) => r.user_id),
  );

  return users.map((u) => {
    const mine = screenings.filter((s) => s.user_id === u.id);
    const fitRow = mine.filter((s) => s.instrument === FITNESS_SCREENER_ID).at(-1) ?? null;

    let fit: Participant["fit"] = null;
    if (fitRow) {
      let flags: string[] = [];
      try { flags = JSON.parse(fitRow.risk_flags_json) as string[]; } catch { flags = []; }
      const positives: FitAnswer[] = [];
      for (const f of flags) {
        const [onYes, id] = f.split(":");
        const item = FITNESS_ITEMS.find((i) => i.id === id);
        if (item) positives.push({ question: item.text, yes: true, onYes });
      }
      fit = {
        outcome: flags.some((f) => f.startsWith("hard_stop:")) ? "hard_stop"
          : flags.length > 0 ? "soft_flag" : "pass",
        takenAt: fitRow.created_at,
        positives,
      };
    }

    const measures = mine
      .filter((s) => s.instrument !== FITNESS_SCREENER_ID)
      .map((s) => {
        const inst = INSTRUMENTS.find((i) => i.id === s.instrument);
        return {
          instrument: s.instrument,
          title: inst?.title ?? s.instrument,
          score: s.total_score,
          cutoff: inst?.cutoff ?? 0,
          takenAt: s.created_at,
        };
      });

    const mineCheckins = checkins.filter((k) => k.user_id === u.id);
    const last = mineCheckins.at(-1) ?? null;
    const safetyPositives = mineCheckins.filter(
      (k) => k.recommended_action === "crisis" || k.harm_urge === 1 || k.feels_safe === 0,
    ).length;

    // Derived from evidence, in order. Somebody who checked in is active even
    // if they later revoked something — the stage says how far they got, not
    // what they are permitted now, and conflating the two would put a gate's
    // answer on a screen that does not gate.
    const stage: Stage =
      mineCheckins.length > 0 ? "active"
      : measures.length > 0 ? "measured"
      : fitRow ? "screened"
      : consented.has(u.id) ? "consented"
      : "signed_up";

    return {
      personId: u.id,
      name: u.name,
      joinedAt: u.created_at,
      stage,
      fit,
      measures,
      checkins: mineCheckins.length,
      lastCheckin: last && {
        date: last.checkin_date,
        action: last.recommended_action,
        harmUrge: last.harm_urge === 1,
        feelsSafe: last.feels_safe === 1,
      },
      safetyPositives,
    };
  });
}

/** The shape of the pilot in whole people. */
export function pilotSummary(rows: Participant[]): PilotSummary {
  return {
    participants: rows.length,
    reachedActive: rows.filter((r) => r.stage === "active").length,
    totalCheckins: rows.reduce((n, r) => n + r.checkins, 0),
    peopleWithSafetyPositive: rows.filter((r) => r.safetyPositives > 0).length,
    hardStopped: rows.filter((r) => r.fit?.outcome === "hard_stop").length,
  };
}
