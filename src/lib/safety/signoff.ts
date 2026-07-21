// Rule sign-off register (clinician review record). Stores the clinician's
// Agree / Needs-change verdict per machine-ID rule, scoped to the current config
// version — so if a threshold changes, its sign-off resets. Read side here; the
// write is a clinician-gated server action (recordRuleSignoff in actions.ts).

import { getDb } from "../db";
import { decryptField } from "../crypto";
import { SAFETY_CONFIG_VERSION } from "./governance";

export type Verdict = "agree" | "needs_change";

export interface RuleSignoff {
  ruleId: string;
  verdict: Verdict;
  note: string | null;
  clinicianId: string | null;
  createdAt: string;
}

/** Latest verdict per rule for the current config version. */
export function getRuleSignoffs(configVersion = SAFETY_CONFIG_VERSION): Map<string, RuleSignoff> {
  const rows = getDb()
    .prepare(
      `SELECT rule_id, verdict, note, clinician_id, created_at
       FROM autonomous_signoffs
       WHERE config_version = ?
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(configVersion) as {
    rule_id: string;
    verdict: Verdict;
    note: string | null;
    clinician_id: string | null;
    created_at: string;
  }[];
  // Last write wins (rows are ascending).
  const map = new Map<string, RuleSignoff>();
  for (const r of rows) {
    map.set(r.rule_id, {
      ruleId: r.rule_id,
      verdict: r.verdict,
      note: r.note ? decryptField(r.note) : null,
      clinicianId: r.clinician_id,
      createdAt: r.created_at,
    });
  }
  return map;
}

export interface SignoffProgress {
  total: number;
  agreed: number;
  needsChange: number;
  unreviewed: number;
}

export function signoffProgress(ruleIds: string[], signoffs: Map<string, RuleSignoff>): SignoffProgress {
  let agreed = 0;
  let needsChange = 0;
  for (const id of ruleIds) {
    const v = signoffs.get(id)?.verdict;
    if (v === "agree") agreed++;
    else if (v === "needs_change") needsChange++;
  }
  return { total: ruleIds.length, agreed, needsChange, unreviewed: ruleIds.length - agreed - needsChange };
}
