// What a member writes inside a program (Handoff 10 §3.4; row CV10_A15).
//
//   member text -> crisis pre-filter (the companion's own deterministic check)
//               -> match? the scripted crisis interrupt, nothing saved,
//                  a coded safety event
//               -> encrypt (enc1:) -> save -> a coded spine event
//
// The text is the member's. It is never given to the companion, never put in
// a prompt, and never shown on a clinician surface; the spine carries the
// activity's kind and any 0–10 ratings, nothing else. Ratings are stored but
// not shown back to the member outside Progress (CV10_B03), so a member's own
// view of an entry carries no number.

import { data } from "./data";
import { newId } from "./db";
import { audit } from "./audit";
import { encryptField, decryptField } from "./crypto";
import { detectRisk } from "./companion";
import { createAlert } from "./clinical/alert-create";
import { nowStamp, recordProgramActivity } from "./spine";
import { completeUnit, menuFor, openUnit, ProgramRefused } from "./programs";
import type { ActivityKind } from "./content/h10-programs";

/** Cap on any one free-text field. A sentence or two is what every prompt asks for. */
export const FREE_TEXT_MAX = 500;

export type Screened = { ok: true } | { ok: false; crisis: true };

/** Every free-text string a payload carries, for the pre-filter. */
function freeTextOf(payload: ActivityPayload): string[] {
  switch (payload.kind) {
    case "values-pick": return payload.other ? [payload.other] : [];
    case "activity-plan": return [...payload.items.filter((i) => i.own).map((i) => i.text), ...(payload.remember ? [payload.remember] : [])];
    case "activity-reflect": return payload.noticed ? [payload.noticed] : [];
  }
}

/** The pre-filter. On a match: nothing is saved, a coded safety event and a
 *  care-team alert are raised (neither carries the words), and the caller
 *  routes to the crisis page. */
export async function screenMemberText(userId: string, texts: readonly string[], where: string): Promise<Screened> {
  if (!texts.some((t) => detectRisk(t))) return { ok: true };
  await audit({
    actorId: userId, actorRole: "member", family: "safety",
    type: "free_text_crisis_interrupt", target: where,
    detail: { fields: texts.length },
  });
  await createAlert({
    userId, type: "activity_risk_language", severity: "urgent",
    detail: `Risk language in something the member wrote in ${where}. Nothing was saved; they were shown the crisis page.`,
  });
  return { ok: false, crisis: true };
}

export type ActivityPayload =
  | { kind: "values-pick"; areas: string[]; other?: string }
  | { kind: "activity-plan"; items: Array<{ text: string; category?: string; own?: boolean; day?: string }>; remember?: string }
  | {
      kind: "activity-reflect"; planItem: string; outcome: "did" | "partly" | "not";
      mastery?: number; enjoyment?: number; noticed?: string; notThisTime?: "smaller" | "keep" | "skip";
    };

/** Why a save was refused, as a code. The screen maps each to fixed words —
 *  never echoes a message from the address bar, which would let a crafted
 *  link put any sentence on a member's screen. */
export type RefusalCode = "wrong_activity" | "no_activity" | "pick_up_to_three" | "not_on_menu" | "one_to_three" | "not_in_plan" | "choose_outcome";

export class ActivityRefused extends Error {
  constructor(public readonly code: RefusalCode) { super(code); }
}

export const REFUSAL_WORDS: Record<RefusalCode, string> = {
  wrong_activity: "That didn't come through. Please try again.",
  no_activity: "That didn't come through. Please try again.",
  pick_up_to_three: "Pick up to three.",
  not_on_menu: "One of those isn't on today's menu. Please pick again.",
  one_to_three: "Pick 1 to 3 things.",
  not_in_plan: "Pick something from your plan.",
  choose_outcome: "Choose how it went.",
};

const DAYS = new Set(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
const rating = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10 ? v : undefined);
const clip = (s: string) => s.trim().slice(0, FREE_TEXT_MAX);

/** Validate against the unit's own copy and today's gate. Anything not on the
 *  unit's lists, or out of range, is refused rather than coerced. */
async function validate(
  userId: string, programId: string, unitId: string, raw: ActivityPayload
): Promise<ActivityPayload> {
  const opened = await openUnit(userId, programId, unitId);
  if (!opened.ok) throw new ProgramRefused(opened.reason);
  const unit = opened.unit.unit;
  if ((unit.activity as ActivityKind) !== raw.kind) throw new ActivityRefused("wrong_activity");
  const copy = unit.copy;
  if (!copy) throw new ActivityRefused("no_activity");

  if (raw.kind === "values-pick") {
    const allowed = new Set((copy.options ?? []).filter((o) => !o.endsWith(": ____")));
    const areas = [...new Set(raw.areas)].filter((a) => allowed.has(a));
    const other = raw.other ? clip(raw.other) : undefined;
    const picks = areas.length + (other ? 1 : 0);
    if (picks === 0 || picks > (copy.maxPicks ?? 3)) throw new ActivityRefused("pick_up_to_three");
    return { kind: raw.kind, areas, ...(other ? { other } : {}) };
  }

  if (raw.kind === "activity-plan") {
    const { practiceGateFor } = await import("./practices");
    const menu = menuFor(copy.categories ?? [], await practiceGateFor(userId));
    const offered = new Map(menu.flatMap((c) => c.items.map((i) => [i, c.name] as const)));
    const items = raw.items.map((i) => {
      const text = clip(i.text);
      const day = i.day && DAYS.has(i.day) ? i.day : undefined;
      if (i.own) return { text, own: true, ...(day ? { day } : {}) };
      const category = offered.get(text);
      // Not on today's menu (a Gentle-only day, or not on it at all): refused.
      if (!category) throw new ActivityRefused("not_on_menu");
      return { text, category, ...(day ? { day } : {}) };
    }).filter((i) => i.text.length > 0);
    if (items.length < 1 || items.length > 3) throw new ActivityRefused("one_to_three");
    const remember = copy.remember && raw.remember ? clip(raw.remember) : undefined;
    return { kind: raw.kind, items, ...(remember ? { remember } : {}) };
  }

  // activity-reflect: the item must be one the member planned.
  const planned = await plannedItems(userId, programId);
  if (!planned.includes(raw.planItem)) throw new ActivityRefused("not_in_plan");
  if (!["did", "partly", "not"].includes(raw.outcome)) throw new ActivityRefused("choose_outcome");
  if (raw.outcome === "not") {
    const choice = raw.notThisTime && ["smaller", "keep", "skip"].includes(raw.notThisTime) ? raw.notThisTime : undefined;
    // Never asks why: nothing else is taken on "not this time".
    return { kind: raw.kind, planItem: raw.planItem, outcome: "not", ...(choice ? { notThisTime: choice } : {}) };
  }
  const mastery = rating(raw.mastery);
  const enjoyment = rating(raw.enjoyment);
  const noticed = raw.noticed ? clip(raw.noticed) : undefined;
  return {
    kind: raw.kind, planItem: raw.planItem, outcome: raw.outcome,
    ...(mastery !== undefined ? { mastery } : {}), ...(enjoyment !== undefined ? { enjoyment } : {}),
    ...(noticed ? { noticed } : {}),
  };
}

/** Save an activity entry and mark its unit done. Returns `crisis` when the
 *  pre-filter matched, in which case nothing was written. */
export async function saveActivityEntry(
  userId: string, programId: string, unitId: string, raw: ActivityPayload
): Promise<{ ok: true; id: string } | { ok: false; crisis: true }> {
  const payload = await validate(userId, programId, unitId, raw);
  const screened = await screenMemberText(userId, freeTextOf(payload), `${programId}/${unitId}`);
  if (!screened.ok) return screened;
  const c = await data();
  const id = newId();
  const at = nowStamp();
  await c.run(
    `INSERT INTO activity_entries (id, user_id, program_id, unit_id, kind, payload_enc, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, programId, unitId, payload.kind, encryptField(JSON.stringify(payload)), at, at]
  );
  const ratings: Record<string, number> = {};
  if (payload.kind === "activity-reflect") {
    if (payload.mastery !== undefined) ratings.mastery = payload.mastery;
    if (payload.enjoyment !== undefined) ratings.enjoyment = payload.enjoyment;
  }
  await recordProgramActivity({ userId, programId, unitId, kind: payload.kind, ratings, occurredAt: at });
  await completeUnit(userId, programId, unitId);
  return { ok: true, id };
}

export interface MemberEntry {
  id: string;
  unitId: string;
  kind: ActivityPayload["kind"];
  /** The member's own words and choices — never a rating (CV10_B03). */
  summary: string[];
  createdAt: string;
}

function summarise(p: ActivityPayload): string[] {
  switch (p.kind) {
    case "values-pick": return [...p.areas, ...(p.other ? [p.other] : [])];
    case "activity-plan": return [...p.items.map((i) => (i.day ? `${i.text} (${i.day})` : i.text)), ...(p.remember ? [p.remember] : [])];
    case "activity-reflect": return [p.planItem, p.outcome === "did" ? "Did it" : p.outcome === "partly" ? "Partly" : "Not this time", ...(p.noticed ? [p.noticed] : [])];
  }
}

async function liveEntries(userId: string, programId: string): Promise<Array<{ id: string; unit_id: string; payload: ActivityPayload; created_at: string }>> {
  const c = await data();
  const rows = (await c.all(
    `SELECT id, unit_id, payload_enc, created_at FROM activity_entries
      WHERE user_id = ? AND program_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid`,
    [userId, programId]
  )) as { id: string; unit_id: string; payload_enc: string; created_at: string }[];
  return rows.map((r) => ({ id: r.id, unit_id: r.unit_id, payload: JSON.parse(decryptField(r.payload_enc)) as ActivityPayload, created_at: r.created_at }));
}

/** The member's own entries in a program, for their eyes only. */
export async function memberEntries(userId: string, programId: string): Promise<MemberEntry[]> {
  return (await liveEntries(userId, programId)).map((e) => ({
    id: e.id, unitId: e.unit_id, kind: e.payload.kind, summary: summarise(e.payload), createdAt: e.created_at,
  }));
}

/** The items in the member's most recent plan — what unit 3 reflects on. */
export async function plannedItems(userId: string, programId: string): Promise<string[]> {
  const plans = (await liveEntries(userId, programId)).filter((e) => e.payload.kind === "activity-plan");
  const last = plans[plans.length - 1]?.payload;
  return last && last.kind === "activity-plan" ? last.items.map((i) => i.text) : [];
}

/** The areas the member picked in unit 1. */
export async function pickedAreas(userId: string, programId: string): Promise<string[]> {
  const picks = (await liveEntries(userId, programId)).filter((e) => e.payload.kind === "values-pick");
  const last = picks[picks.length - 1]?.payload;
  return last && last.kind === "values-pick" ? [...last.areas, ...(last.other ? [last.other] : [])] : [];
}

/** Delete: the words are overwritten, not just hidden, and the row keeps only
 *  that something existed. A unit already done stays done. */
export async function deleteActivityEntry(userId: string, entryId: string): Promise<boolean> {
  const c = await data();
  const { changes } = await c.run(
    `UPDATE activity_entries SET payload_enc = ?, deleted_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [encryptField("{}"), nowStamp(), nowStamp(), entryId, userId]
  );
  if (changes > 0) {
    await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "activity_entry_deleted", target: entryId });
  }
  return changes > 0;
}
