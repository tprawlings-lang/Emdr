import { data } from "../data";
import type { TenantContext } from "../repository";

// What a person has asked to open (17 September handoff, P3).
//
//   "Replace the isolated feel of Module requests with an Assign support action
//   inside Care and relevant clinical contexts."
//
// THE ISOLATION IS THE DEFECT, not the screen. /clinician/unlocks answers a
// request properly — tenant-scoped, a reason required, the member reads it
// back — and it is the only place in the product that knows the request
// exists. It is not in navigation, and a person's own record says nothing about
// what they have asked for, so the two halves of one conversation live on
// screens that never mention each other: the clinician assigns support in Care,
// and the person's own request sits somewhere else entirely.
//
// SO THE REQUEST IS READABLE FROM THE RECORD. The same rows, scoped to one
// person, for the Care screen that already shows what was assigned to them.
// Together they are the whole picture: what the clinician asked of them, and
// what they asked for.
//
// THIS GRANTS NOTHING AND DECIDES NOTHING. Like assigned support beside it,
// this is a read: the decision stays on the screen that owns it, with the
// reason it requires, and this links there rather than growing a second answer
// path.

export interface ModuleRequest {
  id: string;
  personId: string;
  moduleId: string;
  /** What the person said when they asked. Their words. */
  note: string | null;
  requestedAt: string;
  status: "requested" | "unlocked" | "denied" | "revoked";
  /** The reason a clinician gave, which the person reads on their own screen. */
  decisionReason: string | null;
  decidedAt: string | null;
}

/**
 * The module requests on one person's record, newest first.
 *
 * TENANT-SCOPED THROUGH THE PERSON, like the queue it mirrors: a request is
 * keyed to a member account, and reading one outside the acting tenant would
 * disclose what somebody in another organization has asked for.
 */
export async function moduleRequestsFor(
  ctx: TenantContext, personId: string
): Promise<ModuleRequest[]> {
  const c = await data();
  const rows = (await c.all(
    `SELECT mu.id, mu.user_id, mu.module_id, mu.member_note, mu.requested_at,
            mu.status, mu.decision_reason, mu.decided_at
       FROM module_unlocks mu
       JOIN users u ON u.id = mu.user_id
      WHERE mu.user_id = ? AND u.tenant_id = ?
      ORDER BY CASE mu.status WHEN 'requested' THEN 0 ELSE 1 END,
               mu.requested_at DESC`,
    [personId, ctx.tenantId],
  )) as Array<{
    id: string; user_id: string; module_id: string; member_note: string | null;
    requested_at: string; status: string; decision_reason: string | null; decided_at: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    personId: r.user_id,
    moduleId: r.module_id,
    note: r.member_note,
    requestedAt: r.requested_at,
    status: r.status as ModuleRequest["status"],
    decisionReason: r.decision_reason,
    decidedAt: r.decided_at,
  }));
}

/** Requests still waiting on a clinician's answer. */
export function awaitingDecision(requests: ModuleRequest[]): ModuleRequest[] {
  return requests.filter((r) => r.status === "requested");
}
