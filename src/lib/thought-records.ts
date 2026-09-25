// A member's own thought records (Handoff 10 2B; row CV10_D04).
//
//   - Signed, or absent (demo shows it as a draft).
//   - The cautious tier, ceiling 6, asked again on every open and every save;
//     below it, "not today" with grounding one tap away.
//   - Everything written runs the companion's crisis check first; a match
//     saves nothing and routes to the crisis page (program-activities.ts).
//   - Encrypted at rest. THE MEMBER'S ONLY: no clinician surface reads this
//     table, the companion cannot reach it (tests/companion-program-readonly),
//     and nothing about an entry reaches the spine — not even the ratings,
//     because the signed row says the entries are private to the member. The
//     audit log records that one was saved or deleted, and nothing else.
//   - The 0 to 10 strengths are stored and never shown back here (CV10_B03's
//     rule for ratings a member enters).

import { data } from "./data";
import { newId } from "./db";
import { audit } from "./audit";
import { encryptField, decryptField } from "./crypto";
import { nowStamp } from "./spine";
import { contentVisibility, type ContentVisibility } from "./content-signoff";
import { practiceGateFor, type PracticeGate } from "./practices";
import { screenMemberText, FREE_TEXT_MAX } from "./program-activities";
import { THOUGHT_RECORD } from "./content/h10-thought-record";

export interface ThoughtRecordPayload {
  situation: string;
  feeling?: string;
  strengthBefore?: number;
  thought?: string;
  supports?: string;
  against?: string;
  balanced?: string;
  strengthAfter?: number;
}

const TEXT_FIELDS = ["situation", "feeling", "thought", "supports", "against", "balanced"] as const;

export type ThoughtRecordStanding =
  | { state: "absent" }
  | { state: "not_today"; visibility: Exclude<ContentVisibility, "absent"> }
  | { state: "open"; visibility: Exclude<ContentVisibility, "absent"> };

/** Pure. Whether today's gate opens the thought record. Unknown activation
 *  reads as 10; an unreadable engine opens nothing. */
export function thoughtRecordAllowed(gate: PracticeGate | null): boolean {
  if (gate === null) return false;
  return gate.tier >= THOUGHT_RECORD.minTier && (gate.activation ?? 10) <= THOUGHT_RECORD.maxActivation;
}

async function signoffs() {
  try {
    const { getRuleSignoffs } = await import("./safety/signoff");
    return await getRuleSignoffs();
  } catch {
    return new Map();
  }
}

export async function thoughtRecordStanding(userId: string): Promise<ThoughtRecordStanding> {
  const visibility = contentVisibility(THOUGHT_RECORD, await signoffs());
  if (visibility === "absent") return { state: "absent" };
  return thoughtRecordAllowed(await practiceGateFor(userId)) ? { state: "open", visibility } : { state: "not_today", visibility };
}

export type ThoughtRecordRefusal = "absent" | "not_today" | "write_something";
export class ThoughtRecordRefused extends Error {
  constructor(public readonly code: ThoughtRecordRefusal) { super(code); }
}

const clip = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, FREE_TEXT_MAX) : "");
const strength = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10 ? v : undefined);

/** Pure. Keep only the record's own fields, clipped; the situation is the one
 *  thing a record needs. Anything else sent is dropped. */
export function cleanThoughtRecord(raw: Partial<Record<keyof ThoughtRecordPayload, unknown>>): ThoughtRecordPayload {
  const out: ThoughtRecordPayload = { situation: clip(raw.situation) };
  if (!out.situation) throw new ThoughtRecordRefused("write_something");
  for (const f of TEXT_FIELDS) {
    if (f === "situation") continue;
    const v = clip(raw[f]);
    if (v) out[f] = v;
  }
  const before = strength(raw.strengthBefore);
  const after = strength(raw.strengthAfter);
  if (before !== undefined) out.strengthBefore = before;
  if (after !== undefined) out.strengthAfter = after;
  return out;
}

/** Save one. `crisis` means the pre-filter matched and nothing was written. */
export async function saveThoughtRecord(
  userId: string, raw: Partial<Record<keyof ThoughtRecordPayload, unknown>>
): Promise<{ ok: true; id: string } | { ok: false; crisis: true }> {
  const standing = await thoughtRecordStanding(userId);
  if (standing.state !== "open") throw new ThoughtRecordRefused(standing.state);
  const payload = cleanThoughtRecord(raw);
  const texts = TEXT_FIELDS.flatMap((f) => (payload[f] ? [payload[f]!] : []));
  const screened = await screenMemberText(userId, texts, THOUGHT_RECORD.id);
  if (!screened.ok) return screened;
  const c = await data();
  const id = newId();
  const at = nowStamp();
  await c.run(
    "INSERT INTO member_thought_records (id, user_id, payload_enc, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [id, userId, encryptField(JSON.stringify(payload)), at, at]
  );
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "thought_record_saved", target: id });
  return { ok: true, id };
}

export interface MemberThoughtRecord {
  id: string;
  createdAt: string;
  /** Question and answer, in the record's order. Never a strength. */
  answers: Array<{ question: string; answer: string }>;
}

/** The member's own records, newest first, for their eyes only. */
export async function memberThoughtRecords(userId: string): Promise<MemberThoughtRecord[]> {
  const c = await data();
  const rows = (await c.all(
    `SELECT id, payload_enc, created_at FROM member_thought_records
      WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, rowid DESC`,
    [userId]
  )) as { id: string; payload_enc: string; created_at: string }[];
  return rows.map((r) => {
    const p = JSON.parse(decryptField(r.payload_enc)) as ThoughtRecordPayload;
    const answers = THOUGHT_RECORD.steps.flatMap((s) => {
      if (s.field === "strengthAfter") return [];
      const v = p[s.field];
      return v ? [{ question: s.question, answer: v }] : [];
    });
    return { id: r.id, createdAt: r.created_at, answers };
  });
}

/** Delete: the words are overwritten, not hidden. */
export async function deleteThoughtRecord(userId: string, id: string): Promise<boolean> {
  const c = await data();
  const { changes } = await c.run(
    `UPDATE member_thought_records SET payload_enc = ?, deleted_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [encryptField("{}"), nowStamp(), nowStamp(), id, userId]
  );
  if (changes > 0) {
    await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "thought_record_deleted", target: id });
  }
  return changes > 0;
}
