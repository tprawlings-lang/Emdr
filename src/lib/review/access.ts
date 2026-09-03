// Scoped access requests (§26 p44: "Access requests — /review/access —
// Approve scoped access — Role, purpose, expiration — Approve or deny").
//
// Read side. The request and the decision are separate records — see the
// access_requests comment in db.ts — so this module joins them for display and
// never infers one from the other.

import { data } from "../data";
import { decryptField } from "../crypto";
import { decisionsAt, type ReviewDecision } from "./decisions";

export interface AccessRequest {
  id: string;
  tenantId: string;
  requestedBy: string;
  requesterName: string | null;
  requestedRole: string;
  purpose: string;
  expiresAt: string;
  createdAt: string;
  /** The decision in force for exactly this role-and-expiry, or null. */
  decision: ReviewDecision | null;
  /** True when the expiry has passed. An approved-but-expired grant is not an
   *  active grant, and the two must not render alike. */
  expired: boolean;
}

export async function listAccessRequests(limit = 50): Promise<AccessRequest[]> {
  const c = await data();
  const rows = (await c.all(
    `SELECT r.id, r.tenant_id, r.requested_by, r.requested_role, r.purpose,
            r.expires_at, r.created_at, u.email AS requester
       FROM access_requests r
       LEFT JOIN users u ON u.id = r.requested_by
      ORDER BY r.created_at DESC
      LIMIT ?`,
    [limit]
  )) as {
    id: string;
    tenant_id: string;
    requested_by: string;
    requested_role: string;
    purpose: string;
    expires_at: string;
    created_at: string;
    requester: string | null;
  }[];

  // Decisions are keyed by the role-and-expiry that was asked for, so an
  // edited request cannot inherit an old approval. Group the lookups by that
  // key rather than querying per row.
  const versions = new Set(rows.map((r) => `${r.requested_role}@${r.expires_at}`));
  const byVersion = new Map<string, Map<string, ReviewDecision>>();
  for (const v of versions) byVersion.set(v, await decisionsAt("access_request", v));

  const now = Date.now();
  return rows.map((r) => {
    const version = `${r.requested_role}@${r.expires_at}`;
    return {
      id: r.id,
      tenantId: r.tenant_id,
      requestedBy: r.requested_by,
      // Plaintext in the users table — it carries a UNIQUE constraint, so it
      // cannot be encrypted at rest. Only `purpose` is written encrypted here.
      requesterName: r.requester,
      requestedRole: r.requested_role,
      purpose: decryptField(r.purpose),
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      decision: byVersion.get(version)?.get(r.id) ?? null,
      expired: Date.parse(r.expires_at) < now,
    };
  });
}
