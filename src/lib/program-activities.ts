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
//
// STEADIER SLEEP (1C). The getting-up time is the only thing stored for
// "The bed is for sleep": HH:MM, nothing else. Nothing here or anywhere
// computes, suggests or stores a bedtime, a time-in-bed limit or a sleep
// window — sleep restriction is excluded from self-guided use (row CV10_C03;
// tests/sleep-entry.test.ts holds the line).

import { data } from "./data";
import { newId } from "./db";
import { audit } from "./audit";
import { encryptField, decryptField } from "./crypto";
import { detectRisk } from "./companion";
import { createAlert } from "./clinical/alert-create";
import { nowStamp, recordProgramActivity } from "./spine";
import { completeUnit, menuFor, openUnit, programView, ProgramRefused } from "./programs";
import { getPractice } from "./practices";
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
    case "wind-down-plan": return payload.own ? [payload.own] : [];
    case "sleep-window": return [];
    case "sleep-reflect": return payload.keepDoing ? [payload.keepDoing] : [];
    case "reflect-text": return [payload.text];
    case "feeling-words": return payload.words;
    case "skill-pick": return [];
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
    }
  | { kind: "wind-down-plan"; picks: string[]; own?: string }
  /** The getting-up time, "HH:MM", and nothing else (CV10_C03). */
  | { kind: "sleep-window"; wakeTime: string }
  | { kind: "sleep-reflect"; helped: string[]; keepDoing?: string }
  | { kind: "reflect-text"; text: string }
  /** One or two words, typed: no signed word list exists yet. */
  | { kind: "feeling-words"; words: string[] }
  /** One of the unit's own practices. */
  | { kind: "skill-pick"; practiceId: string };

/** Why a save was refused, as a code. The screen maps each to fixed words —
 *  never echoes a message from the address bar, which would let a crafted
 *  link put any sentence on a member's screen. */
export type RefusalCode =
  | "wrong_activity" | "no_activity" | "pick_up_to_three" | "not_on_menu" | "one_to_three" | "not_in_plan" | "choose_outcome"
  | "pick_two_or_three" | "choose_time" | "not_on_list"
  | "write_something" | "one_or_two_words" | "pick_one";

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
  pick_two_or_three: "Pick two or three.",
  choose_time: "Choose a time.",
  not_on_list: "One of those isn't on the list. Please pick again.",
  write_something: "Write a few words, or go back — this part can wait.",
  one_or_two_words: "Write one or two words.",
  pick_one: "Pick one.",
};

/** A feeling word: short, one line. */
const WORD_MAX = 40;

/** A clock time, 00:00 to 23:59. */
const WAKE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const OWN = ": ____";

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

  if (raw.kind === "wind-down-plan") {
    const allowed = new Set((copy.options ?? []).filter((o) => !o.endsWith(OWN)));
    const picks = [...new Set(raw.picks ?? [])];
    if (picks.some((p) => !allowed.has(p))) throw new ActivityRefused("not_on_menu");
    const own = raw.own ? clip(raw.own) : undefined;
    const n = picks.length + (own ? 1 : 0);
    if (n < (copy.minPicks ?? 1) || n > (copy.maxPicks ?? 3)) throw new ActivityRefused("pick_two_or_three");
    return { kind: raw.kind, picks, ...(own ? { own } : {}) };
  }

  if (raw.kind === "sleep-window") {
    // Rebuilt from the one field, so nothing else a client sends is kept.
    if (typeof raw.wakeTime !== "string" || !WAKE_TIME.test(raw.wakeTime)) throw new ActivityRefused("choose_time");
    return { kind: raw.kind, wakeTime: raw.wakeTime };
  }

  if (raw.kind === "sleep-reflect") {
    const offered = new Set(await reflectOptions(userId, programId, unitId));
    const helped = [...new Set(raw.helped ?? [])];
    if (helped.some((h) => !offered.has(h))) throw new ActivityRefused("not_on_list");
    const keepDoing = raw.keepDoing ? clip(raw.keepDoing) : undefined;
    return { kind: raw.kind, helped, ...(keepDoing ? { keepDoing } : {}) };
  }

  if (raw.kind === "reflect-text") {
    const text = typeof raw.text === "string" ? clip(raw.text) : "";
    if (!text) throw new ActivityRefused("write_something");
    return { kind: raw.kind, text };
  }

  if (raw.kind === "feeling-words") {
    const words = (Array.isArray(raw.words) ? raw.words : [])
      .map((w) => (typeof w === "string" ? w.trim().slice(0, WORD_MAX) : ""))
      .filter(Boolean);
    if (words.length < 1 || words.length > 2) throw new ActivityRefused("one_or_two_words");
    return { kind: raw.kind, words };
  }

  if (raw.kind === "skill-pick") {
    if (!unit.practiceIds.includes(raw.practiceId)) throw new ActivityRefused("pick_one");
    return { kind: raw.kind, practiceId: raw.practiceId };
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

const practiceTitle = (id: string) => getPractice(id)?.title ?? id;

function summarise(p: ActivityPayload): string[] {
  switch (p.kind) {
    case "values-pick": return [...p.areas, ...(p.other ? [p.other] : [])];
    case "activity-plan": return [...p.items.map((i) => (i.day ? `${i.text} (${i.day})` : i.text)), ...(p.remember ? [p.remember] : [])];
    case "activity-reflect": return [p.planItem, p.outcome === "did" ? "Did it" : p.outcome === "partly" ? "Partly" : "Not this time", ...(p.noticed ? [p.noticed] : [])];
    case "wind-down-plan": return [...p.picks, ...(p.own ? [p.own] : [])];
    case "sleep-window": return [p.wakeTime];
    case "sleep-reflect": return [...p.helped, ...(p.keepDoing ? [p.keepDoing] : [])];
    case "reflect-text": return [p.text];
    case "feeling-words": return p.words;
    case "skill-pick": return [practiceTitle(p.practiceId)];
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

/** What "Which parts helped most?" offers (Steadier Sleep unit 4: "from units
 *  1 to 3 items"). For each part before this one that the member can see — a
 *  withheld part is not offered — its items in the pack's own words: the
 *  member's latest wind-down picks (or the list, if they saved none), the
 *  part's habits, and the titles of its practices. Nothing is added that the
 *  pack does not say, and a bedtime or a time limit is never an item. */
export async function reflectOptions(userId: string, programId: string, unitId: string): Promise<string[]> {
  const { getPractice } = await import("./practices");
  const view = await programView(userId, programId);
  if (!view) return [];
  const idx = view.units.findIndex((u) => u.unit.id === unitId);
  const before = view.units.slice(0, idx < 0 ? 0 : idx).map((u) => u.unit);
  const entries = await liveEntries(userId, programId);
  const out: string[] = [];
  for (const u of before) {
    if (u.activity === "wind-down-plan") {
      const mine = entries.filter((e) => e.unit_id === u.id && e.payload.kind === "wind-down-plan").at(-1)?.payload;
      if (mine && mine.kind === "wind-down-plan") out.push(...mine.picks, ...(mine.own ? [mine.own] : []));
      else out.push(...(u.copy?.options ?? []).filter((o) => !o.endsWith(OWN)));
    }
    out.push(...(u.list ?? []));
    for (const id of u.practiceIds) {
      const p = getPractice(id);
      if (p) out.push(p.title);
    }
  }
  return [...new Set(out)];
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
