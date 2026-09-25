// Programs — short, self-paced sequences of units (Handoff 10 §3.2).
//
// The rules, all enforced here rather than in a screen, so the phone and the
// web get the same answers:
//
//   - A program is visible only when its sign-off rows are live (§0.2).
//   - Self-paced. Unit N+1 opens when unit N is done. No calendar, no "behind",
//     no overdue badge.
//   - Each unit re-asks today's gate when opened. Below its floor it is "not
//     today", and the grounding practices stay one tap away.
//   - Joining and leaving are one tap each and reversible; leaving keeps what
//     was done, and joining again picks up where they left off, with no
//     reference to how long it has been.
//   - The companion never calls anything here: it may suggest, it may not
//     enrol, complete or write (§3.5; tests/companion-program-readonly).
//   - A program with an entry screen (Steadier Sleep's sleep-entry-v1, row
//     CV10_C04) asks it on joining, and nothing opens until it is answered.
//     Any yes withholds the units marked for it and only those; the rest of
//     the program runs as if they were not there. Leaving clears the answers,
//     so joining again asks again (the product owner's choice, 25 September,
//     with its risk recorded: a member could answer differently the second
//     time — decision clinical.sleep-entry-screen-retake).

import { data } from "./data";
import { newId } from "./db";
import { audit } from "./audit";
import {
  nowStamp, recordProgramEnrolled, recordProgramEntryScreened, recordProgramLeft, recordProgramUnitCompleted,
} from "./spine";
import { contentVisibility, type ContentVisibility } from "./content-signoff";
import { practiceGateFor, type PracticeGate } from "./practices";
import { AccessTier } from "./safety/types";
import { H10_PROGRAMS, type EntryScreen, type Program, type ProgramUnit, type MenuCategory } from "./content/h10-programs";

export type { EntryScreen, Program, ProgramId, ProgramUnit } from "./content/h10-programs";

export const PROGRAMS: readonly Program[] = H10_PROGRAMS;

export function getProgram(id: string): Program | undefined {
  return PROGRAMS.find((p) => p.id === id);
}

async function signoffs() {
  try {
    const { getRuleSignoffs } = await import("./safety/signoff");
    return await getRuleSignoffs();
  } catch {
    return new Map();
  }
}

/** Pure. Whether today's gate opens a unit. Unknown activation reads as 10
 *  and an unreadable engine opens nothing — the same rule as skills. */
export function unitAllowed(unit: ProgramUnit, gate: PracticeGate | null): boolean {
  if (gate === null) return false;
  if (gate.tier < unit.minTier) return false;
  if ((gate.activation ?? 10) > unit.maxActivation) return false;
  return true;
}

/** Pure. The menu categories today's gate allows (CV10_B02: at the
 *  stabilization tier, Gentle only). */
export function menuFor(categories: readonly MenuCategory[], gate: PracticeGate | null): MenuCategory[] {
  const all = gate !== null && gate.tier >= AccessTier.CAUTIOUS;
  return categories.filter((c) => c.gentle || all);
}

export type UnitState =
  | "done"
  /** Open to do now. */
  | "open"
  /** The one before has not been done yet. */
  | "after_previous"
  /** Signed and in order, but today's gate does not open it. */
  | "not_today";

export interface UnitView { unit: ProgramUnit; state: UnitState; visibility: Exclude<ContentVisibility, "absent"> }

/** Where the member stands on a program's entry screen. `answered: false`
 *  until they answer it on joining (and again after leaving). */
export type EntryStanding =
  | { screen: EntryScreen; answered: false }
  | { screen: EntryScreen; answered: true; withheld: boolean; lines: string[] };

export interface ProgramView {
  program: Program;
  visibility: Exclude<ContentVisibility, "absent">;
  /** Null when the member has never joined. */
  enrollment: "active" | "left" | null;
  /** Null when the program has no entry screen. */
  entry: EntryStanding | null;
  finished: boolean;
  /** Withheld units are not in this list at all. */
  units: UnitView[];
  /** The unit to pick up, or null. Never a date or a gap. */
  next: ProgramUnit | null;
}

/** Pure. The outcome of an entry screen: whether to withhold, and which of
 *  the per-question lines apply, in question order (`entryLines` turns that
 *  into words). Null when the answers do not fit the screen (refused, never
 *  guessed). */
export function scoreEntryScreen(
  screen: EntryScreen, answers: readonly unknown[]
): { withheld: boolean; noteKeys: number[] } | null {
  if (answers.length !== screen.questions.length || !answers.every((a) => typeof a === "boolean")) return null;
  if (!answers.some(Boolean)) return { withheld: false, noteKeys: [] };
  const noteKeys = Object.keys(screen.ifYes).map(Number).filter((k) => answers[k] === true).sort((a, b) => a - b);
  return { withheld: true, noteKeys };
}

/** Pure. The words for an answered screen. */
export function entryLines(screen: EntryScreen, withheld: boolean, noteKeys: readonly number[]): string[] {
  if (!withheld) return [];
  return [screen.anyYes, ...noteKeys.flatMap((k) => (screen.ifYes[k] ? [screen.ifYes[k]] : []))];
}

async function entryStanding(userId: string, program: Program): Promise<EntryStanding | null> {
  const screen = program.entryScreen;
  if (!screen) return null;
  const c = await data();
  const row = (await c.get(
    `SELECT withheld, note_keys FROM program_entry_screens
      WHERE user_id = ? AND program_id = ? AND screen_id = ? AND cleared_at IS NULL
      ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [userId, program.id, screen.id]
  )) as { withheld: number; note_keys: string } | undefined;
  if (!row) return { screen, answered: false };
  const keys = row.note_keys ? row.note_keys.split(",").map(Number) : [];
  return { screen, answered: true, withheld: row.withheld === 1, lines: entryLines(screen, row.withheld === 1, keys) };
}

/** Pure. Whether a unit is withheld for this member by the entry screen. */
export function unitWithheld(unit: ProgramUnit, entry: EntryStanding | null): boolean {
  return Boolean(unit.withheldByEntryScreen && entry?.answered && entry.withheld);
}

async function enrollmentOf(userId: string, programId: string) {
  const c = await data();
  return (await c.get(
    "SELECT id, status FROM program_enrollments WHERE user_id = ? AND program_id = ?",
    [userId, programId]
  )) as { id: string; status: "active" | "left" | "finished" } | undefined;
}

async function completedUnits(userId: string, programId: string): Promise<Set<string>> {
  const c = await data();
  const rows = (await c.all(
    "SELECT unit_id FROM program_unit_completions WHERE user_id = ? AND program_id = ?",
    [userId, programId]
  )) as { unit_id: string }[];
  return new Set(rows.map((r) => r.unit_id));
}

/** Pure: each unit's state from what is done, the sign-off, and the gate. A
 *  withheld unit is left out and skipped in the order: the one after it opens
 *  when the one before it is done. */
export function unitStates(
  program: Program, done: ReadonlySet<string>, gate: PracticeGate | null,
  visible: (u: ProgramUnit) => Exclude<ContentVisibility, "absent"> | null,
  withheld: (u: ProgramUnit) => boolean = () => false
): UnitView[] {
  const out: UnitView[] = [];
  let previousDone = true;
  for (const unit of program.units) {
    const visibility = visible(unit);
    if (visibility === null) break; // an unsigned unit ends the visible program
    if (withheld(unit)) continue;
    const state: UnitState = done.has(unit.id) ? "done"
      : !previousDone ? "after_previous"
      : unitAllowed(unit, gate) ? "open" : "not_today";
    out.push({ unit, state, visibility });
    previousDone = done.has(unit.id);
  }
  return out;
}

export async function programView(userId: string, programId: string): Promise<ProgramView | null> {
  const program = getProgram(programId);
  if (!program) return null;
  const s = await signoffs();
  const pv = contentVisibility(program, s);
  if (pv === "absent") return null;
  const [enrollment, done, gate, entry] = await Promise.all([
    enrollmentOf(userId, program.id), completedUnits(userId, program.id), practiceGateFor(userId),
    entryStanding(userId, program),
  ]);
  // The screen's own row: an unsigned screen means the program cannot be
  // joined safely, so the program is not shown (the same rule as a unit).
  if (program.entryScreen && contentVisibility(program.entryScreen, s) === "absent") return null;
  const units = unitStates(program, done, gate, (u) => {
    const v = contentVisibility(u, s);
    return v === "absent" ? null : v;
  }, (u) => unitWithheld(u, entry));
  const expected = program.units.filter((u) => !unitWithheld(u, entry)).length;
  const finished = units.length === expected && units.every((u) => u.state === "done");
  const next = units.find((u) => u.state !== "done")?.unit ?? null;
  return {
    program, visibility: pv,
    enrollment: enrollment ? (enrollment.status === "left" ? "left" : "active") : null,
    entry, finished, units, next,
  };
}

/** Every program a member may see, with their standing in each. */
export async function memberPrograms(userId: string): Promise<ProgramView[]> {
  const views = await Promise.all(PROGRAMS.map((p) => programView(userId, p.id)));
  return views.filter((v): v is ProgramView => v !== null);
}

export class ProgramRefused extends Error {}

/** Join, or join again. One row per member and program; a re-join keeps the
 *  original row and everything done under it. A program with an entry screen
 *  needs its answers here, one yes-or-no per question, or it is refused
 *  ("entry_screen") and nothing is written. */
export async function enrollInProgram(userId: string, programId: string, entryAnswers?: readonly unknown[]): Promise<void> {
  const view = await programView(userId, programId);
  if (!view) throw new ProgramRefused("No such program.");
  const c = await data();
  const existing = await enrollmentOf(userId, programId);
  const at = nowStamp();
  const id = existing?.id ?? newId();
  if (existing?.status === "active" && !(view.entry && !view.entry.answered)) return;
  const screen = view.program.entryScreen;
  if (screen) {
    const scored = scoreEntryScreen(screen, entryAnswers ?? []);
    if (!scored) throw new ProgramRefused("entry_screen");
    await recordEntryScreen(userId, view.program, screen, scored.withheld, scored.noteKeys, at);
  }
  if (existing?.status === "active") return;
  if (existing) {
    await c.run("UPDATE program_enrollments SET status = 'active', updated_at = ? WHERE id = ? AND user_id = ?", [at, id, userId]);
  } else {
    await c.run(
      "INSERT INTO program_enrollments (id, user_id, program_id, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
      [id, userId, programId, at, at]
    );
  }
  await recordProgramEnrolled({ userId, enrollmentId: id, programId, occurredAt: at });
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "program_enrolled", target: programId });
}

/** The screen's answer, kept as a code: withheld or not, and which of the
 *  screen's extra lines to say (so a line keyed to one question does imply
 *  that answer, in the member's own row). The yes/no answers are not stored
 *  as such, and the spine and the audit log carry only "withheld" or not
 *  (§1C: coded event only). Any earlier live answer is cleared first. */
async function recordEntryScreen(
  userId: string, program: Program, screen: EntryScreen, withheld: boolean, noteKeys: readonly number[], at: string
): Promise<void> {
  const c = await data();
  await c.run(
    "UPDATE program_entry_screens SET cleared_at = ? WHERE user_id = ? AND program_id = ? AND cleared_at IS NULL",
    [at, userId, program.id]
  );
  const id = newId();
  await c.run(
    `INSERT INTO program_entry_screens (id, user_id, program_id, screen_id, withheld, note_keys, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, program.id, screen.id, withheld ? 1 : 0, noteKeys.join(","), at]
  );
  await recordProgramEntryScreened({ userId, programId: program.id, screenId: screen.id, withheld, occurredAt: at });
  await audit({
    actorId: userId, actorRole: "member", family: "clinical", type: "program_entry_screened",
    target: program.id, detail: { screenId: screen.id, withheld },
  });
}

/** One tap out. What was done stays; an entry screen's answer is cleared, so
 *  joining again asks it again. */
export async function leaveProgram(userId: string, programId: string): Promise<void> {
  const existing = await enrollmentOf(userId, programId);
  if (!existing || existing.status === "left") return;
  const c = await data();
  const at = nowStamp();
  await c.run("UPDATE program_enrollments SET status = 'left', updated_at = ? WHERE id = ? AND user_id = ?", [at, existing.id, userId]);
  await c.run(
    "UPDATE program_entry_screens SET cleared_at = ? WHERE user_id = ? AND program_id = ? AND cleared_at IS NULL",
    [at, userId, programId]
  );
  await recordProgramLeft({ userId, enrollmentId: existing.id, programId, occurredAt: at });
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "program_left", target: programId });
}

/** The unit, if this member may work on it now: joined, in order, signed, and
 *  open under today's gate. Anything else is refused with its reason. */
export async function openUnit(userId: string, programId: string, unitId: string): Promise<
  | { ok: true; view: ProgramView; unit: UnitView }
  | { ok: false; reason: "absent" | "not_joined" | "entry_screen" | "after_previous" | "not_today" }
> {
  const view = await programView(userId, programId);
  if (!view) return { ok: false, reason: "absent" };
  const unit = view.units.find((u) => u.unit.id === unitId);
  if (!unit) return { ok: false, reason: "absent" }; // withheld units included
  if (view.enrollment !== "active") return { ok: false, reason: "not_joined" };
  if (view.entry && !view.entry.answered) return { ok: false, reason: "entry_screen" };
  if (unit.state === "after_previous") return { ok: false, reason: "after_previous" };
  if (unit.state === "not_today") return { ok: false, reason: "not_today" };
  return { ok: true, view, unit };
}

/** Mark a unit done. Idempotent; refused out of order or off the gate. */
export async function completeUnit(userId: string, programId: string, unitId: string): Promise<void> {
  const opened = await openUnit(userId, programId, unitId);
  if (!opened.ok) throw new ProgramRefused(opened.reason);
  if (opened.unit.state === "done") return;
  const c = await data();
  const id = newId();
  const at = nowStamp();
  const { changes } = await c.run(
    `INSERT INTO program_unit_completions (id, user_id, program_id, unit_id, created_at)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, program_id, unit_id) DO NOTHING`,
    [id, userId, programId, unitId, at]
  );
  if (changes === 0) return;
  await recordProgramUnitCompleted({ userId, completionId: id, programId, unitId, occurredAt: at });
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "program_unit_completed", target: `${programId}/${unitId}` });
}


