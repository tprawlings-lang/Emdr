// Approved follow-ups as work (Phase 3: "feed approved follow-ups into patient
// work context").
//
// A follow-up is the clinician's own note to themselves — "follow up on sleep
// next session", "check whether the work thing is still active". It reaches the
// record the same way every other item does: extracted as a candidate, kept by
// the clinician, and only then real. This turns the kept ones into rows on the
// clinician's day.
//
// THEY ARE REVIEW-TODAY WORK, NOT NEEDS-ACTION-NOW. Nothing is wrong. Somebody
// asked themselves to remember something before the next session, and putting
// that in the same band as a safety alert would teach people that the top band
// does not mean what it says.
//
// THE HONEST LIMITATION, STATED RATHER THAN DISCOVERED. There is no way to mark
// a follow-up done. A to-do list with no completion is a list that grows until
// people stop reading it, which would make this feature worse than not having
// it. So follow-ups AGE OUT of the queue after a window: they are context for
// the next session or two, not a permanent backlog. That is a real gap and the
// right place to close it is Phase 4's Session Prep, which is the surface that
// actually knows a session happened. Until then the window is the mechanism and
// this comment is the record of why.

import { repo, type TenantContext } from "../repository";
import { decryptField } from "../crypto";

/** How long a kept follow-up stays on the queue. Two months is roughly two to
 *  eight sessions depending on cadence — long enough to survive a cancellation,
 *  short enough that the list stays readable. */
export const FOLLOWUP_WINDOW_DAYS = 60;

export interface FollowUp {
  itemId: string;
  personId: string;
  /** The clinician's own words. */
  text: string;
  /** What it is about, when the extractor gave it a label. */
  label: string | null;
  approvedBy: string | null;
  approvedAt: string;
  sourceThoughtId: string | null;
}

interface Row {
  id: string;
  person_id: string;
  display_text: string;
  normalized_label: string | null;
  approved_by: string | null;
  approved_at: string;
  source_thought_id: string | null;
}

/**
 * Approved, in-window follow-ups for a tenant.
 *
 * APPROVED ONLY. A candidate follow-up is a suggestion nobody has accepted, and
 * putting one on a clinician's day would be the system adding to their workload
 * on its own say-so — the exact inversion of the human gate the whole feature
 * is built around.
 */
export async function openFollowUps(
  ctx: TenantContext,
  opts: { personId?: string; now?: Date; windowDays?: number } = {}
): Promise<FollowUp[]> {
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? FOLLOWUP_WINDOW_DAYS;
  const since = new Date(now.getTime() - windowDays * 86_400_000).toISOString();

  const where = opts.personId
    ? "item_type = 'follow_up' AND status = 'approved' AND approved_at >= ? AND person_id = ?"
    : "item_type = 'follow_up' AND status = 'approved' AND approved_at >= ?";
  const params = opts.personId ? [since, opts.personId] : [since];

  const rows = await repo(ctx).findMany<Row>("clinical_memory_items", where, params, {
    orderBy: "approved_at DESC, rowid DESC",
    limit: 200,
  });

  return rows.map((r) => ({
    itemId: r.id,
    personId: r.person_id,
    text: decryptField(r.display_text),
    label: r.normalized_label ? decryptField(r.normalized_label) : null,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    sourceThoughtId: r.source_thought_id,
  }));
}
