// Longitudinal threads and their membership (§5, §7, Phase 3).
//
// A thread is a thing that keeps coming up: the sister, the accident, sleep,
// the work situation. Memory items attach to it over months, and the thread is
// how a clinician sees a pattern rather than forty separate observations.
//
// PHASE 3'S DEFINITION OF DONE IS THREE LINES, and two of them are about what
// the system must NOT do on its own.
//
//   NO AUTO-LINK IN V1. A model may propose a membership; only a clinician
//   decision moves one to accepted. `proposed_by` and `decided_by` are separate
//   columns for exactly this, and `acceptMembership` takes the deciding
//   clinician from the tenant context rather than an argument — so there is no
//   call a background job could make that would look like a clinician's.
//
//   REJECTED LINKS REMAIN REJECTED unless a clinician deliberately revisits
//   them. The table's UNIQUE(thread_id, memory_item_id) does most of this by
//   itself: a second proposal for the same pair cannot be inserted, so a
//   matcher that runs again next week cannot quietly resurrect a link the
//   clinician threw out. Revisiting is a separate, explicit command — a
//   clinician changing their mind is a real event and it looks different from
//   the system asking twice.
//
//   THREAD EVIDENCE ALWAYS OPENS SOURCE. Every membership points at a memory
//   item, and every memory item points at the thought and transcript span it
//   came from. The timeline read below carries those references rather than
//   flattening the thread into prose, because a pattern a clinician cannot
//   drill into is an assertion.

import { repo, type TenantContext } from "../repository";
import { ulid } from "../ids";
import { encryptField, decryptField } from "../crypto";
import type { MemoryItem } from "./memory-store";

export type ThreadStatus = "active" | "resolved" | "archived";
export type MembershipStatus = "proposed" | "accepted" | "rejected";
export type ProposedBy = "clinician" | "model" | "system";

export interface Thread {
  id: string;
  personId: string;
  threadType: string;
  canonicalLabel: string;
  status: ThreadStatus;
  createdBy: "clinician" | "system";
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface Membership {
  id: string;
  personId: string;
  threadId: string;
  memoryItemId: string;
  relationship: string;
  status: MembershipStatus;
  proposedBy: ProposedBy;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

interface ThreadRow {
  id: string; person_id: string; thread_type: string; canonical_label: string;
  status: string; created_by: string; first_seen_at: string | null;
  last_seen_at: string | null; created_at: string;
}

interface MembershipRow {
  id: string; person_id: string; thread_id: string; memory_item_id: string;
  relationship: string; status: string; proposed_by: string;
  decided_by: string | null; decided_at: string | null; created_at: string;
}

function toThread(r: ThreadRow): Thread {
  return {
    id: r.id,
    personId: r.person_id,
    threadType: r.thread_type,
    canonicalLabel: decryptField(r.canonical_label),
    status: r.status as ThreadStatus,
    createdBy: r.created_by as "clinician" | "system",
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    createdAt: r.created_at,
  };
}

function toMembership(r: MembershipRow): Membership {
  return {
    id: r.id,
    personId: r.person_id,
    threadId: r.thread_id,
    memoryItemId: r.memory_item_id,
    relationship: r.relationship,
    status: r.status as MembershipStatus,
    proposedBy: r.proposed_by as ProposedBy,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
  };
}

function actingClinician(ctx: TenantContext): string {
  if (!ctx.personId) {
    throw new Error("A thread decision requires an authenticated clinician in the context.");
  }
  return ctx.personId;
}

export class NotProposedError extends Error {}
export class DuplicateMembershipError extends Error {}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listThreads(
  ctx: TenantContext, personId: string, status: ThreadStatus = "active"
): Promise<Thread[]> {
  const rows = await repo(ctx).findMany<ThreadRow>(
    "clinical_threads", "person_id = ? AND status = ?", [personId, status],
    { orderBy: "last_seen_at DESC, created_at DESC" }
  );
  return rows.map(toThread);
}

export async function getThread(ctx: TenantContext, id: string): Promise<Thread | null> {
  const row = await repo(ctx).findOne<ThreadRow>("clinical_threads", "id = ?", [id]);
  return row ? toThread(row) : null;
}

export async function membershipsFor(
  ctx: TenantContext, threadId: string, status?: MembershipStatus
): Promise<Membership[]> {
  const where = status ? "thread_id = ? AND status = ?" : "thread_id = ?";
  const params = status ? [threadId, status] : [threadId];
  const rows = await repo(ctx).findMany<MembershipRow>(
    "clinical_thread_memberships", where, params, { orderBy: "created_at ASC, rowid ASC" }
  );
  return rows.map(toMembership);
}

/** Memberships awaiting a Connect / Not related decision, for one person.
 *
 *  §3.2: "AI-suggested relationships to existing threads appear AFTER the main
 *  review. They are not auto-accepted." So this is its own read — the review
 *  screen finishes, and then this is what is left to decide. */
export async function pendingConnections(ctx: TenantContext, personId: string): Promise<Membership[]> {
  const rows = await repo(ctx).findMany<MembershipRow>(
    "clinical_thread_memberships", "person_id = ? AND status = 'proposed'", [personId],
    { orderBy: "created_at ASC, rowid ASC" }
  );
  return rows.map(toMembership);
}

/** Every membership for one person, in every status.
 *
 *  One query for the whole threads surface. The page needs pending
 *  suggestions, refused ones and accepted members of each theme, and three
 *  reads over the same two tables — or worse, one per theme — is how a page
 *  that is fine with two threads is slow with twenty. */
export async function membershipsForPerson(ctx: TenantContext, personId: string): Promise<Membership[]> {
  const rows = await repo(ctx).findMany<MembershipRow>(
    "clinical_thread_memberships", "person_id = ?", [personId],
    { orderBy: "created_at ASC, rowid ASC" }
  );
  return rows.map(toMembership);
}

/** Every pair that already has a membership row, in any status.
 *
 *  The matcher subtracts this from its candidates. That is what stops a
 *  rejected link being proposed again next week: the clinician's "no" is a row,
 *  and a row is a fact the matcher has to respect rather than an absence it can
 *  fill back in. */
export async function decidedPairs(ctx: TenantContext, personId: string): Promise<Set<string>> {
  const rows = await repo(ctx).findMany<MembershipRow>(
    "clinical_thread_memberships", "person_id = ?", [personId]
  );
  return new Set(rows.map((r) => `${r.thread_id}::${r.memory_item_id}`));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Open a thread. `createdBy` distinguishes a clinician naming a theme from the
 *  system opening one around a repeated label — both legitimate, and not the
 *  same provenance. */
export async function createThread(
  ctx: TenantContext,
  args: {
    personId: string; threadType: string; canonicalLabel: string;
    createdBy: "clinician" | "system"; firstSeenAt?: string | null;
  }
): Promise<Thread> {
  const id = ulid();
  await repo(ctx).insert("clinical_threads", {
    id,
    person_id: args.personId,
    thread_type: args.threadType,
    canonical_label: encryptField(args.canonicalLabel),
    status: "active",
    created_by: args.createdBy,
    first_seen_at: args.firstSeenAt ?? null,
    last_seen_at: args.firstSeenAt ?? null,
  });
  const row = await repo(ctx).findOne<ThreadRow>("clinical_threads", "id = ?", [id]);
  return toThread(row!);
}

/**
 * Propose a membership. NEVER accepts it.
 *
 * There is no `status` parameter, and that is the point: §3.2's "they are not
 * auto-accepted" is a property of this function's signature rather than of its
 * callers' discipline. A model, a background job and a clinician all land in
 * 'proposed', and only `acceptMembership` moves it on.
 */
export async function proposeMembership(
  ctx: TenantContext,
  args: {
    personId: string; threadId: string; memoryItemId: string;
    proposedBy: ProposedBy; relationship?: string;
  }
): Promise<Membership> {
  const existing = await repo(ctx).findOne<MembershipRow>(
    "clinical_thread_memberships",
    "thread_id = ? AND memory_item_id = ?",
    [args.threadId, args.memoryItemId]
  );
  if (existing) {
    // Including a rejected one. Re-proposing a link the clinician threw out is
    // the system asking again, which the definition of done forbids — the way
    // back is `revisitMembership`, which a person has to choose.
    throw new DuplicateMembershipError(
      `This item and thread already have a ${existing.status} connection.`
    );
  }
  const id = ulid();
  await repo(ctx).insert("clinical_thread_memberships", {
    id,
    person_id: args.personId,
    thread_id: args.threadId,
    memory_item_id: args.memoryItemId,
    relationship: args.relationship ?? "supports",
    status: "proposed",
    proposed_by: args.proposedBy,
    decided_by: null,
    decided_at: null,
  });
  const row = await repo(ctx).findOne<MembershipRow>("clinical_thread_memberships", "id = ?", [id]);
  return toMembership(row!);
}

async function decide(
  ctx: TenantContext, membershipId: string, status: "accepted" | "rejected", at: string
): Promise<Membership> {
  const clinician = actingClinician(ctx);
  const r = repo(ctx);
  const existing = await r.findOne<MembershipRow>("clinical_thread_memberships", "id = ?", [membershipId]);
  if (!existing) throw new NotProposedError(`No such connection: ${membershipId}`);
  if (existing.status !== "proposed") {
    throw new NotProposedError(`Connection ${membershipId} is already ${existing.status}.`);
  }
  await r.update(
    "clinical_thread_memberships",
    { status, decided_by: clinician, decided_at: at },
    "id = ?", [membershipId]
  );
  if (status === "accepted") {
    // The thread was seen again. Kept on the thread so a caseload view can order
    // by it without walking every membership.
    await r.update("clinical_threads", { last_seen_at: at }, "id = ?", [existing.thread_id]);
  }
  const row = await r.findOne<MembershipRow>("clinical_thread_memberships", "id = ?", [membershipId]);
  return toMembership(row!);
}

/** Connect. */
export async function acceptMembership(ctx: TenantContext, id: string, at: string): Promise<Membership> {
  return decide(ctx, id, "accepted", at);
}

/** Not related. */
export async function rejectMembership(ctx: TenantContext, id: string, at: string): Promise<Membership> {
  return decide(ctx, id, "rejected", at);
}

/**
 * Reopen a rejected connection, deliberately.
 *
 * The escape hatch the definition of done names — "unless a clinician
 * deliberately revisits them" — and it is a separate command rather than a
 * relaxation of `proposeMembership`, so the thing a clinician does on purpose
 * cannot be reached by the thing the matcher does automatically. Only a
 * REJECTED membership can be revisited: an accepted one is already connected,
 * and a proposed one is still waiting.
 */
export async function revisitMembership(ctx: TenantContext, id: string): Promise<Membership> {
  const clinician = actingClinician(ctx);
  const r = repo(ctx);
  const existing = await r.findOne<MembershipRow>("clinical_thread_memberships", "id = ?", [id]);
  if (!existing) throw new NotProposedError(`No such connection: ${id}`);
  if (existing.status !== "rejected") {
    throw new NotProposedError(`Only a rejected connection can be revisited; this one is ${existing.status}.`);
  }
  await r.update(
    "clinical_thread_memberships",
    // Back to proposed, and re-attributed: the clinician is now the one asking,
    // not the model whose original suggestion they refused.
    { status: "proposed", proposed_by: "clinician", decided_by: null, decided_at: null },
    "id = ?", [id]
  );
  const row = await r.findOne<MembershipRow>("clinical_thread_memberships", "id = ?", [id]);
  void clinician;
  return toMembership(row!);
}

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

export interface ThreadTimelineEntry {
  membership: Membership;
  item: MemoryItem;
}

export interface ThreadTimeline {
  thread: Thread;
  /** Accepted members, oldest first — the shape of the pattern over time. */
  entries: ThreadTimelineEntry[];
}

/**
 * A thread and its accepted evidence, oldest first.
 *
 * Carries the ITEMS, not a summary of them. §Phase 3's third line of done is
 * "thread evidence always opens source", and each item already knows its
 * thought and its transcript span — so the caller can offer the drill-down
 * without a second query, and a caller that renders only the labels has made
 * that choice visibly rather than been forced into it.
 */
export async function threadTimeline(
  ctx: TenantContext,
  threadId: string,
  loadItems: (ids: string[]) => Promise<MemoryItem[]>
): Promise<ThreadTimeline | null> {
  const thread = await getThread(ctx, threadId);
  if (!thread) return null;
  const accepted = await membershipsFor(ctx, threadId, "accepted");
  const items = await loadItems(accepted.map((m) => m.memoryItemId));
  const byId = new Map(items.map((i) => [i.id, i]));
  const entries: ThreadTimelineEntry[] = [];
  for (const m of accepted) {
    const item = byId.get(m.memoryItemId);
    // An accepted membership whose item is gone is not rendered as a blank row.
    // It should not happen — items are never deleted — and if it does, showing
    // a gap in a clinical pattern is worse than showing a shorter one.
    if (item) entries.push({ membership: m, item });
  }
  entries.sort((a, b) => a.item.createdAt.localeCompare(b.item.createdAt));
  return { thread, entries };
}
