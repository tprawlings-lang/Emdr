// Rebuilding an evaluation tenant (Handoff 11 W1: "npm run seed:evolvedmd and
// a one-click reset in /admin"). One function both call, so the script and
// the button cannot build different caseloads.

import { getDb, syncIdentitySpine } from "../db";
import { tenantConfig } from "./index";
import { DEFAULT_EVAL_PASSWORD, resetEvaluationTenant, seedEvaluationTenant, type EvaluationSeedPlan, type SeedResult } from "./evaluation-seed";
import { EVOLVEDMD_SEED_PLAN, EVOLVEDMD_TENANT } from "./evolvedmd";

/** The seed plan for each evaluation tenant. */
export const EVALUATION_PLANS: Readonly<Record<string, EvaluationSeedPlan>> = {
  [EVOLVEDMD_TENANT.id]: EVOLVEDMD_SEED_PLAN,
};

export class EvaluationRefused extends Error {}

export interface RebuildResult {
  tenantId: string;
  deleted: Record<string, number>;
  counts: SeedResult;
  eventsInserted: number;
}

/** Remove the tenant's rows, seed it again from its plan, and rebuild the
 *  event ledger for it. Refused for anything that is not a configured
 *  evaluation tenant, and for a tenant holding a real person: this deletes
 *  every row in the tenant, and only synthetic rows may be deleted that way. */
export async function rebuildEvaluationTenant(tenantId: string, anchor = new Date()): Promise<RebuildResult> {
  const config = tenantConfig(tenantId);
  const plan = EVALUATION_PLANS[tenantId];
  if (!config || config.mode !== "evaluation" || !plan) {
    throw new EvaluationRefused(`${tenantId} is not a configured evaluation tenant; nothing was changed.`);
  }
  const db = getDb();
  const real = db.prepare("SELECT COUNT(*) AS n FROM persons WHERE tenant_id = ? AND provenance = 'real'").get(tenantId) as { n: number };
  if (real.n > 0) throw new EvaluationRefused(`${tenantId} holds ${real.n} real person(s); an evaluation reset may only remove synthetic rows.`);
  const deleted = resetEvaluationTenant(db, tenantId);
  const counts = seedEvaluationTenant(db, config, plan, anchor);
  syncIdentitySpine(db);
  const { backfillGenesisEvents } = await import("../spine-backfill");
  const events = await backfillGenesisEvents();
  return { tenantId, deleted, counts, eventsInserted: events.inserted };
}

/** What the admin page shows: whether the tenant is seeded, how big, and the
 *  day its synthetic history runs to (a rebuild moves it to today; an old date
 *  means the queue is showing stale weeks). */
export function evaluationStatus(tenantId: string): { seeded: boolean; staff: number; patients: number; historyTo: string | null } {
  const db = getDb();
  const row = db.prepare(
    `SELECT SUM(CASE WHEN role = 'member' AND password_hash = '!' THEN 1 ELSE 0 END) AS patients,
            SUM(CASE WHEN role <> 'member' THEN 1 ELSE 0 END) AS staff
       FROM users WHERE tenant_id = ?`
  ).get(tenantId) as { patients: number | null; staff: number | null };
  const latest = db.prepare("SELECT MAX(checkin_date) AS d FROM checkins WHERE tenant_id = ?").get(tenantId) as { d: string | null };
  const patients = row.patients ?? 0;
  return { seeded: patients > 0, staff: row.staff ?? 0, patients, historyTo: latest.d };
}

/** The accounts an evaluation team signs in with: staff and member testers,
 *  never the synthetic patients (they have no password). */
export function evaluationLogins(tenantId: string): Array<{ email: string; role: string; name: string }> {
  return getDb().prepare(
    `SELECT email, role, name FROM users WHERE tenant_id = ? AND password_hash <> '!'
      ORDER BY CASE role WHEN 'clinician' THEN 0 WHEN 'pcp_viewer' THEN 1 WHEN 'organization' THEN 2 ELSE 3 END, email`
  ).all(tenantId) as Array<{ email: string; role: string; name: string }>;
}

/** What the login list says about the password, without printing a value
 *  somebody set on purpose. */
export function evaluationPasswordHint(): string {
  return process.env.EMDR_EVAL_PASSWORD ? "The value of EMDR_EVAL_PASSWORD on this server." : `${DEFAULT_EVAL_PASSWORD} (EMDR_EVAL_PASSWORD is not set).`;
}
