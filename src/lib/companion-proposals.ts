import { newId, tenantForUser } from "./db";
import { data } from "./data";
import { encryptField, decryptField } from "./crypto";
import { audit } from "./audit";
import { type MemoryType, writeMemory } from "./companion";
import { SESSION_TARGET_MEMORY_TYPES } from "./governance/session-state";

// Every write a model makes, and the door a person decides at.
//
// TWO SURFACES IN ONE FILE, AND THE BOUNDARY TEST NAMES WHICH IS WHICH. The
// companion's tool runtime may import exactly two things from here —
// `proposeToMember` and `writeModelMemory` — and tests/companion-boundary.test.ts
// fails if it imports anything else. The accept and dismiss functions below are
// for the member's own actions, and a model reaching one would be a model
// confirming its own suggestion.
//
// WHY PROPOSALS AT ALL. The companion's `record_trigger` tool wrote the trigger
// map directly, including intensity, and intensity is what keeps a trigger out
// of self-guided processing. The Expansion Handoff's non-negotiable 2: "A model
// may only add a flag for human review, never remove one." So what a model
// notices is recorded as a suggestion; it becomes something a person may be
// asked to process only when they accept it and rate it themselves.

export type ProposalKind = "trigger" | "focus_area";

export interface CompanionProposal {
  id: string;
  kind: ProposalKind;
  title: string;
  detail: string | null;
  category: string | null;
  createdAt: string;
}

/** The model-facing write: record what the companion noticed, for the person
 *  to decide on. Writes nothing a session can read. */
export async function proposeToMember(args: {
  userId: string;
  kind: ProposalKind;
  title: string;
  detail?: string | null;
  category?: string | null;
  conversationId?: string | null;
}): Promise<void> {
  const title = args.title.trim().slice(0, 120);
  if (!title) return;
  const c = await data();
  // ONE OPEN SUGGESTION PER THING. A companion that notices the same trigger in
  // three conversations should not hand the person three identical cards.
  //
  // COMPARED DECRYPTED, IN CODE, NOT IN SQL. The title is encrypted with a
  // random IV, so the same words never produce the same ciphertext and a
  // `WHERE title = ?` would match nothing, ever — a duplicate check that reads
  // correctly and cannot fire.
  const open = (await c.all(
    `SELECT title FROM companion_proposals WHERE user_id = ? AND kind = ? AND status = 'proposed'`,
    [args.userId, args.kind]
  )) as Array<{ title: string }>;
  const same = (t: string) => decryptField(t).trim().toLowerCase() === title.toLowerCase();
  if (open.some((r) => same(r.title))) return;
  await c.run(
    `INSERT INTO companion_proposals
       (id, tenant_id, user_id, kind, title, detail, category, source_conversation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId(), tenantForUser(args.userId), args.userId, args.kind,
      encryptField(title),
      args.detail ? encryptField(args.detail.slice(0, 2000)) : null,
      args.category?.slice(0, 30) ?? null,
      args.conversationId ?? null,
    ]
  );
}

/**
 * The model-facing memory write, which refuses to write a session target.
 *
 * NOT `writeMemory`, and the difference is the boundary. `writeMemory` will
 * store any type it is given; this refuses the types that become the focus of a
 * processing session, so a future tool that forgets to route through
 * `proposeToMember` fails loudly instead of quietly choosing somebody's
 * session.
 */
export async function writeModelMemory(args: {
  userId: string;
  type: MemoryType;
  key: string;
  value: string;
  sourceId: string;
}): Promise<void> {
  if ((SESSION_TARGET_MEMORY_TYPES as readonly string[]).includes(args.type)) {
    throw new Error(
      `A model may not write "${args.type}" memory: it becomes the target of a processing session. ` +
      "Propose it to the member instead."
    );
  }
  await writeMemory({
    userId: args.userId, type: args.type, key: args.key, value: args.value,
    source: "user_message", sourceId: args.sourceId,
  });
}

// ---------------------------------------------------------------------------
// The member's side. Never imported by the tool runtime.
// ---------------------------------------------------------------------------

export async function pendingProposals(userId: string): Promise<CompanionProposal[]> {
  const c = await data();
  const rows = (await c.all(
    `SELECT id, kind, title, detail, category, created_at FROM companion_proposals
      WHERE user_id = ? AND status = 'proposed' ORDER BY created_at DESC`,
    [userId]
  )) as Array<{ id: string; kind: ProposalKind; title: string; detail: string | null; category: string | null; created_at: string }>;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: decryptField(r.title),
    detail: r.detail ? decryptField(r.detail) : null,
    category: r.category,
    createdAt: r.created_at,
  }));
}

export class ProposalRefused extends Error {}

async function openProposal(userId: string, proposalId: string) {
  const c = await data();
  const row = (await c.get(
    `SELECT id, kind, title, detail, category FROM companion_proposals
      WHERE id = ? AND user_id = ? AND status = 'proposed'`,
    [proposalId, userId]
  )) as { id: string; kind: ProposalKind; title: string; detail: string | null; category: string | null } | undefined;
  // SCOPED TO THE PERSON IN THE QUERY. A proposal id from somebody else's page
  // reads as absent, not as forbidden.
  if (!row) throw new ProposalRefused("That suggestion is not waiting for you.");
  return {
    ...row,
    title: decryptField(row.title),
    detail: row.detail ? decryptField(row.detail) : null,
  };
}

/**
 * Accept a suggested trigger, with the intensity the PERSON gives it.
 *
 * THE INTENSITY IS REQUIRED AND IT IS THEIRS. This is the whole reason the
 * suggestion waited: a trigger's intensity decides whether it can be processed
 * without a specialist, so it is set by the person who has it, here, and by
 * nothing else.
 */
export async function acceptTriggerProposal(
  userId: string, proposalId: string, intensity: number
): Promise<void> {
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 10) {
    throw new ProposalRefused("Choose how intense this is, from 1 to 10, before adding it.");
  }
  const p = await openProposal(userId, proposalId);
  if (p.kind !== "trigger") throw new ProposalRefused("That suggestion is not a trigger.");
  const c = await data();

  const existing = (await c.get(
    "SELECT id, notes FROM user_triggers WHERE user_id = ? AND trigger_name = ?",
    [userId, p.title]
  )) as { id: string; notes: string | null } | undefined;

  if (existing) {
    // THE PERSON'S OWN WORDS ARE KEPT. What the companion noted is added under
    // what was already there, never written over it.
    const prior = existing.notes ? decryptField(existing.notes) : "";
    const notes = [prior, p.detail].filter(Boolean).join("\n\n") || null;
    await c.run(
      `UPDATE user_triggers SET intensity_score = ?, active = 1, notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?`,
      [intensity, notes ? encryptField(notes) : null, existing.id, userId]
    );
  } else {
    await c.run(
      `INSERT INTO user_triggers (id, tenant_id, user_id, trigger_name, trigger_category, intensity_score, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newId(), tenantForUser(userId), userId, p.title, p.category ?? "other", intensity,
       p.detail ? encryptField(p.detail) : null]
    );
  }
  await settle(userId, p.id, "accepted", { kind: "trigger", intensity });
}

/** Accept a suggested focus. Only the person can make something a focus. */
export async function acceptFocusProposal(userId: string, proposalId: string): Promise<void> {
  const p = await openProposal(userId, proposalId);
  if (p.kind !== "focus_area") throw new ProposalRefused("That suggestion is not a focus.");
  await writeMemory({
    userId, type: "focus_area", key: p.title, value: p.detail ?? p.title,
    // "from something you told it" — which is exactly what it was, and now the
    // person has confirmed it.
    source: "user_message", sourceId: p.id,
  });
  await settle(userId, p.id, "accepted", { kind: "focus_area" });
}

export async function dismissProposal(userId: string, proposalId: string): Promise<void> {
  const p = await openProposal(userId, proposalId);
  await settle(userId, p.id, "dismissed", { kind: p.kind });
}

async function settle(
  userId: string, id: string, to: "accepted" | "dismissed", detail: Record<string, unknown>
): Promise<void> {
  const c = await data();
  await c.run(
    `UPDATE companion_proposals SET status = ?, decided_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND status = 'proposed'`,
    [to, id, userId]
  );
  await audit({
    actorId: userId, actorRole: "member", family: "clinical",
    type: `companion_proposal_${to}`, target: userId,
    detail: { proposalId: id, ...detail },
  });
}
