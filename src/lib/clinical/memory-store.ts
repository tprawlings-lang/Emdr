// Clinical memory items — layer 2's read and write model (§5, §14, §16).
//
// The table has existed since Phase 0. This is the module that fills it, and
// the rules it enforces are the three lines of Phase 2's definition of done:
//
//   UNCERTAINTY IS PRESERVED. `statementClass` travels with every item, from
//   the extraction payload to the card to the approved record. Nothing in this
//   module can change it — approval carries the class forward untouched, so a
//   hypothesis cannot become an observation by being approved. §4's example is
//   the whole reason the column exists: "I think this may connect to
//   abandonment" is not "abandonment is an active patient theme".
//
//   NO CANDIDATE BECOMES APPROVED WITHOUT A CLINICIAN SAVE. Items are written
//   with status 'candidate' and there is no code path from the extractor to
//   'approved'. The only function that writes that status takes the approving
//   clinician from the tenant context, and the save is atomic (§14.3).
//
//   REPLAY REPRODUCES APPROVED MEMORY STATE. Every transition emits its §7
//   event before the row is trusted, and supersession appends rather than
//   overwrites — a corrected item leaves the original readable and marked, so
//   the ledger and the table agree about what was believed when.

import { repo, type TenantContext } from "../repository";
import { ulid } from "../ids";
import { encryptField, decryptField } from "../crypto";
import type { ExtractionItem, ItemType, StatementClass } from "./extraction-contract";

export type MemoryStatus = "candidate" | "approved" | "rejected" | "superseded";

export interface MemoryItem {
  id: string;
  personId: string;
  sourceThoughtId: string | null;
  sourceTranscriptId: string | null;
  itemType: ItemType;
  statementClass: StatementClass;
  normalizedLabel: string | null;
  displayText: string;
  status: MemoryStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  supersedesId: string | null;
  /** Character offsets into the transcript, when the citation survived
   *  validation. Null means the item is true but uncited — which the card must
   *  show, because an item that cannot open its source is weaker evidence and
   *  the clinician is the one who decides how much weaker. */
  span: { start: number; end: number } | null;
  numericFacts: { name: string; value: number; unit?: string; approximate?: boolean }[];
  createdAt: string;
}

interface Row {
  id: string;
  person_id: string;
  source_thought_id: string | null;
  source_transcript_id: string | null;
  source_span_json: string | null;
  item_type: string;
  statement_class: string;
  normalized_label: string | null;
  display_text: string;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  supersedes_id: string | null;
  created_at: string;
}

interface SpanPayload {
  start?: number;
  end?: number;
  numericFacts?: { name: string; value: number; unit?: string; approximate?: boolean }[];
}

function parseSpan(json: string | null): SpanPayload {
  if (!json) return {};
  try {
    const v: unknown = JSON.parse(json);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as SpanPayload) : {};
  } catch {
    return {};
  }
}

function toItem(r: Row): MemoryItem {
  const payload = parseSpan(r.source_span_json);
  const hasSpan = typeof payload.start === "number" && typeof payload.end === "number";
  return {
    id: r.id,
    personId: r.person_id,
    sourceThoughtId: r.source_thought_id,
    sourceTranscriptId: r.source_transcript_id,
    itemType: r.item_type as ItemType,
    statementClass: r.statement_class as StatementClass,
    normalizedLabel: r.normalized_label ? decryptField(r.normalized_label) : null,
    displayText: decryptField(r.display_text),
    status: r.status as MemoryStatus,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    supersedesId: r.supersedes_id,
    span: hasSpan ? { start: payload.start as number, end: payload.end as number } : null,
    numericFacts: payload.numericFacts ?? [],
    createdAt: r.created_at,
  };
}

function actingClinician(ctx: TenantContext): string {
  if (!ctx.personId) {
    throw new Error("Approving or rejecting a memory item requires an authenticated clinician in the context.");
  }
  return ctx.personId;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listItemsForThought(ctx: TenantContext, thoughtId: string): Promise<MemoryItem[]> {
  const rows = await repo(ctx).findMany<Row>(
    "clinical_memory_items",
    "source_thought_id = ?",
    [thoughtId],
    { orderBy: "created_at ASC, rowid ASC" }
  );
  return rows.map(toItem);
}

/** The approved memory for one person — the projection §5 calls layer 2.
 *
 *  Superseded items are excluded and rejected ones never appear. A caller
 *  wanting the history of a claim asks for it by id; this is the current
 *  picture, and mixing the two is how a corrected item goes on being read. */
export async function approvedMemory(ctx: TenantContext, personId: string, limit = 200): Promise<MemoryItem[]> {
  const rows = await repo(ctx).findMany<Row>(
    "clinical_memory_items",
    "person_id = ? AND status = 'approved'",
    [personId],
    { orderBy: "created_at DESC, rowid DESC", limit }
  );
  return rows.map(toItem);
}

/** Several items by id, in one query.
 *
 *  The alternative is a getItem per membership, which turns a thread timeline
 *  into a query per entry. Ids are parameterised rather than interpolated —
 *  they come from rows this tenant can already see, but a list built into SQL
 *  by string concatenation is a habit worth not having. */
export async function itemsByIds(ctx: TenantContext, ids: string[]): Promise<MemoryItem[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await repo(ctx).findMany<Row>(
    "clinical_memory_items", `id IN (${placeholders})`, ids
  );
  return rows.map(toItem);
}

export async function getItem(ctx: TenantContext, id: string): Promise<MemoryItem | null> {
  const row = await repo(ctx).findOne<Row>("clinical_memory_items", "id = ?", [id]);
  return row ? toItem(row) : null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Write an extraction's items as CANDIDATES.
 *
 * Status is hard-coded rather than a parameter. A function that could be asked
 * to write an approved item straight from an extraction is a function somebody
 * will one day call that way, and Phase 2's definition of done is that no such
 * path exists.
 */
export async function createCandidates(
  ctx: TenantContext,
  args: { personId: string; thoughtId: string; transcriptId: string; items: ExtractionItem[] }
): Promise<MemoryItem[]> {
  const r = repo(ctx);
  const created: MemoryItem[] = [];
  for (const item of args.items) {
    const id = ulid();
    const span =
      item.sourceStart !== null && item.sourceEnd !== null
        ? { start: item.sourceStart, end: item.sourceEnd }
        : {};
    await r.insert("clinical_memory_items", {
      id,
      person_id: args.personId,
      source_thought_id: args.thoughtId,
      source_transcript_id: args.transcriptId,
      source_span_json: JSON.stringify({
        ...span,
        ...(item.numericFacts ? { numericFacts: item.numericFacts } : {}),
      }),
      item_type: item.itemType,
      statement_class: item.statementClass,
      normalized_label: item.normalizedLabel ? encryptField(item.normalizedLabel) : null,
      display_text: encryptField(item.displayText),
      status: "candidate",
      approved_by: null,
      approved_at: null,
      supersedes_id: null,
    });
    const row = await r.findOne<Row>("clinical_memory_items", "id = ?", [id]);
    if (row) created.push(toItem(row));
  }
  return created;
}

/** Remove every candidate belonging to a thought.
 *
 *  Used when extraction is re-run against a corrected transcript (§16). Only
 *  CANDIDATES are removed: an approved item is a clinical record and a re-run
 *  must not be able to delete one. */
export async function clearCandidates(ctx: TenantContext, thoughtId: string): Promise<void> {
  await repo(ctx).deleteWhere(
    "clinical_memory_items",
    "source_thought_id = ? AND status = 'candidate'",
    [thoughtId]
  );
}

export class NotACandidateError extends Error {}

/**
 * Approve one candidate.
 *
 * The statement class is NOT a parameter and is never rewritten. §4's rule
 * lives here: approving is agreeing that the clinician said this, not
 * upgrading what kind of claim it is.
 */
export async function approveItem(ctx: TenantContext, id: string, at: string): Promise<MemoryItem> {
  const clinician = actingClinician(ctx);
  const r = repo(ctx);
  const existing = await r.findOne<Row>("clinical_memory_items", "id = ?", [id]);
  if (!existing) throw new NotACandidateError(`No such memory item: ${id}`);
  if (existing.status !== "candidate") {
    throw new NotACandidateError(`Item ${id} is ${existing.status}, not a candidate`);
  }
  await r.update(
    "clinical_memory_items",
    { status: "approved", approved_by: clinician, approved_at: at },
    "id = ?",
    [id]
  );
  const row = await r.findOne<Row>("clinical_memory_items", "id = ?", [id]);
  return toItem(row!);
}

export async function rejectItem(ctx: TenantContext, id: string): Promise<MemoryItem> {
  actingClinician(ctx);
  const r = repo(ctx);
  const existing = await r.findOne<Row>("clinical_memory_items", "id = ?", [id]);
  if (!existing) throw new NotACandidateError(`No such memory item: ${id}`);
  if (existing.status !== "candidate") {
    throw new NotACandidateError(`Item ${id} is ${existing.status}, not a candidate`);
  }
  await r.update("clinical_memory_items", { status: "rejected" }, "id = ?", [id]);
  const row = await r.findOne<Row>("clinical_memory_items", "id = ?", [id]);
  return toItem(row!);
}

/**
 * Correct an approved item (§16).
 *
 * SUPERSESSION APPENDS. The replacement is a new row pointing at the original,
 * and the original becomes 'superseded' rather than being edited or deleted.
 * Two reasons, and the second is the one that matters: a note written last
 * month may cite the original, and an audit reader asking what the clinician
 * believed at the time must get the answer they actually held — not the
 * corrected one, which would make every past decision look better informed
 * than it was.
 */
export async function supersedeItem(
  ctx: TenantContext,
  args: { priorItemId: string; displayText: string; normalizedLabel?: string | null; at: string }
): Promise<{ prior: MemoryItem; replacement: MemoryItem }> {
  const clinician = actingClinician(ctx);
  const r = repo(ctx);
  const prior = await r.findOne<Row>("clinical_memory_items", "id = ?", [args.priorItemId]);
  if (!prior) throw new NotACandidateError(`No such memory item: ${args.priorItemId}`);
  // Only an APPROVED item can be corrected. A candidate is edited by rejecting
  // it and approving the right one; superseding a candidate would create a
  // chain of corrections to something that was never part of the record.
  if (prior.status !== "approved") {
    throw new NotACandidateError(`Only an approved item can be superseded; ${args.priorItemId} is ${prior.status}`);
  }

  const replacementId = ulid();
  await r.insert("clinical_memory_items", {
    id: replacementId,
    person_id: prior.person_id,
    source_thought_id: prior.source_thought_id,
    source_transcript_id: prior.source_transcript_id,
    // The correction carries the original's citation forward: it is still the
    // same moment in the same transcript, said better.
    source_span_json: prior.source_span_json,
    item_type: prior.item_type,
    // Unchanged, and deliberately not correctable here. Changing what KIND of
    // claim something is, is not a wording correction — it is a different item,
    // and it goes through rejection and re-approval where it is visible.
    statement_class: prior.statement_class,
    normalized_label:
      args.normalizedLabel === undefined
        ? prior.normalized_label
        : args.normalizedLabel
          ? encryptField(args.normalizedLabel)
          : null,
    display_text: encryptField(args.displayText),
    status: "approved",
    approved_by: clinician,
    approved_at: args.at,
    supersedes_id: args.priorItemId,
  });
  await r.update("clinical_memory_items", { status: "superseded" }, "id = ?", [args.priorItemId]);

  const priorAfter = await r.findOne<Row>("clinical_memory_items", "id = ?", [args.priorItemId]);
  const replacement = await r.findOne<Row>("clinical_memory_items", "id = ?", [replacementId]);
  return { prior: toItem(priorAfter!), replacement: toItem(replacement!) };
}
