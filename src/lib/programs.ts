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

import { data } from "./data";
import { newId } from "./db";
import { audit } from "./audit";
import { nowStamp, recordProgramEnrolled, recordProgramLeft, recordProgramUnitCompleted } from "./spine";
import { contentVisibility, type ContentVisibility } from "./content-signoff";
import { practiceGateFor, type PracticeGate } from "./practices";
import { AccessTier } from "./safety/types";
import { H10_PROGRAMS, type Program, type ProgramUnit, type MenuCategory } from "./content/h10-programs";

export type { Program, ProgramId, ProgramUnit } from "./content/h10-programs";

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

export interface ProgramView {
  program: Program;
  visibility: Exclude<ContentVisibility, "absent">;
  /** Null when the member has never joined. */
  enrollment: "active" | "left" | null;
  finished: boolean;
  units: UnitView[];
  /** The unit to pick up, or null. Never a date or a gap. */
  next: ProgramUnit | null;
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

/** Pure: each unit's state from what is done, the sign-off, and the gate. */
export function unitStates(
  program: Program, done: ReadonlySet<string>, gate: PracticeGate | null,
  visible: (u: ProgramUnit) => Exclude<ContentVisibility, "absent"> | null
): UnitView[] {
  const out: UnitView[] = [];
  let previousDone = true;
  for (const unit of program.units) {
    const visibility = visible(unit);
    if (visibility === null) break; // an unsigned unit ends the visible program
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
  const [enrollment, done, gate] = await Promise.all([
    enrollmentOf(userId, program.id), completedUnits(userId, program.id), practiceGateFor(userId),
  ]);
  const units = unitStates(program, done, gate, (u) => {
    const v = contentVisibility(u, s);
    return v === "absent" ? null : v;
  });
  const finished = units.length === program.units.length && units.every((u) => u.state === "done");
  const next = units.find((u) => u.state !== "done")?.unit ?? null;
  return {
    program, visibility: pv,
    enrollment: enrollment ? (enrollment.status === "left" ? "left" : "active") : null,
    finished, units, next,
  };
}

/** Every program a member may see, with their standing in each. */
export async function memberPrograms(userId: string): Promise<ProgramView[]> {
  const views = await Promise.all(PROGRAMS.map((p) => programView(userId, p.id)));
  return views.filter((v): v is ProgramView => v !== null);
}

export class ProgramRefused extends Error {}

/** Join, or join again. One row per member and program; a re-join keeps the
 *  original row and everything done under it. */
export async function enrollInProgram(userId: string, programId: string): Promise<void> {
  const view = await programView(userId, programId);
  if (!view) throw new ProgramRefused("No such program.");
  const c = await data();
  const existing = await enrollmentOf(userId, programId);
  const at = nowStamp();
  const id = existing?.id ?? newId();
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

/** One tap out. What was done stays. */
export async function leaveProgram(userId: string, programId: string): Promise<void> {
  const existing = await enrollmentOf(userId, programId);
  if (!existing || existing.status === "left") return;
  const c = await data();
  const at = nowStamp();
  await c.run("UPDATE program_enrollments SET status = 'left', updated_at = ? WHERE id = ? AND user_id = ?", [at, existing.id, userId]);
  await recordProgramLeft({ userId, enrollmentId: existing.id, programId, occurredAt: at });
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "program_left", target: programId });
}

/** The unit, if this member may work on it now: joined, in order, signed, and
 *  open under today's gate. Anything else is refused with its reason. */
export async function openUnit(userId: string, programId: string, unitId: string): Promise<
  | { ok: true; view: ProgramView; unit: UnitView }
  | { ok: false; reason: "absent" | "not_joined" | "after_previous" | "not_today" }
> {
  const view = await programView(userId, programId);
  if (!view) return { ok: false, reason: "absent" };
  const unit = view.units.find((u) => u.unit.id === unitId);
  if (!unit) return { ok: false, reason: "absent" };
  if (view.enrollment !== "active") return { ok: false, reason: "not_joined" };
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


