// The review decision record (§26 p44: "Every decision records actor, role,
// version, evidence and time").
//
// Read and shape helpers. The writes are role-gated server actions in
// ./actions.ts — this module is deliberately write-free so a screen cannot
// record a decision by importing the thing it uses to display one.

import { data } from "../data";
import { decryptField } from "../crypto";

export type SubjectKind = "clinical_language" | "release_gate" | "access_request";

/** What a reviewer can say. Three answers, not two: "blocked" and "changes
 *  requested" are different facts — one stops a release, the other asks for
 *  work — and collapsing them into "not approved" loses the difference at
 *  exactly the moment someone needs it. */
export type Decision = "approved" | "blocked" | "changes_requested";

export interface ReviewDecision {
  id: string;
  subjectKind: SubjectKind;
  subjectId: string;
  /** The version, or evidence fingerprint, this decision was made against. */
  subjectVersion: string;
  decision: Decision;
  rationale: string | null;
  evidence: Record<string, unknown>;
  actorId: string | null;
  actorRole: string;
  createdAt: string;
}

interface Row {
  id: string;
  subject_kind: SubjectKind;
  subject_id: string;
  subject_version: string;
  decision: Decision;
  rationale: string | null;
  evidence_json: string;
  actor_id: string | null;
  actor_role: string;
  created_at: string;
}

function hydrate(r: Row): ReviewDecision {
  let evidence: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(r.evidence_json);
    // A non-object parses fine and would then be spread into the screen as
    // though it were evidence. Anything that is not a plain object is treated
    // as no evidence at all, which renders as "none recorded" rather than as
    // a shape the caller did not expect.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      evidence = parsed as Record<string, unknown>;
    }
  } catch {
    evidence = {};
  }
  return {
    id: r.id,
    subjectKind: r.subject_kind,
    subjectId: r.subject_id,
    subjectVersion: r.subject_version,
    decision: r.decision,
    rationale: r.rationale ? decryptField(r.rationale) : null,
    evidence,
    actorId: r.actor_id,
    actorRole: r.actor_role,
    createdAt: r.created_at,
  };
}

/**
 * The decision currently in force for each subject of a kind, AT a given
 * version.
 *
 * The version argument is not a filter for convenience — it is the whole
 * safety property. A caller asks "what is decided about THIS version", and a
 * decision recorded against an earlier version is silently absent from the
 * answer, so the subject reads as unreviewed. That is the intended behaviour:
 * approving version 3 must not make version 4 look approved.
 */
export async function decisionsAt(kind: SubjectKind, version: string): Promise<Map<string, ReviewDecision>> {
  const c = await data();
  const rows = (await c.all(
    `SELECT id, subject_kind, subject_id, subject_version, decision, rationale,
            evidence_json, actor_id, actor_role, created_at
       FROM review_decisions
      WHERE subject_kind = ? AND subject_version = ?
      ORDER BY created_at ASC, rowid ASC`,
    [kind, version]
  )) as Row[];
  // Ascending, so the last row for a subject is the one in force.
  const map = new Map<string, ReviewDecision>();
  for (const r of rows) map.set(r.subject_id, hydrate(r));
  return map;
}

/** Every decision ever recorded for one subject, oldest first — including
 *  those against superseded versions. This is the history a reversal must not
 *  erase, so it deliberately ignores the version. */
export async function decisionHistory(kind: SubjectKind, subjectId: string, limit = 50): Promise<ReviewDecision[]> {
  const c = await data();
  const rows = (await c.all(
    `SELECT id, subject_kind, subject_id, subject_version, decision, rationale,
            evidence_json, actor_id, actor_role, created_at
       FROM review_decisions
      WHERE subject_kind = ? AND subject_id = ?
      ORDER BY created_at ASC, rowid ASC
      LIMIT ?`,
    [kind, subjectId, limit]
  )) as Row[];
  return rows.map(hydrate);
}

export interface DecisionProgress {
  total: number;
  approved: number;
  blocked: number;
  changesRequested: number;
  /** Neither approved nor refused AT THIS VERSION. Includes subjects decided
   *  against an older version, which is why this is computed from the subject
   *  list rather than by counting rows. */
  undecided: number;
}

export function progress(subjectIds: string[], decisions: Map<string, ReviewDecision>): DecisionProgress {
  let approved = 0;
  let blocked = 0;
  let changesRequested = 0;
  for (const id of subjectIds) {
    const d = decisions.get(id)?.decision;
    if (d === "approved") approved++;
    else if (d === "blocked") blocked++;
    else if (d === "changes_requested") changesRequested++;
  }
  return {
    total: subjectIds.length,
    approved,
    blocked,
    changesRequested,
    undecided: subjectIds.length - approved - blocked - changesRequested,
  };
}
