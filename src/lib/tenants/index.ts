// The tenant configuration registry (Handoff 11 §2). The config is the source
// of truth; the `tenants.mode` column mirrors it (ensureConfiguredTenant) so
// the database's own PHI lock can read it without the application.

import { data } from "../data";
import type { TenantConfig, TenantMode } from "./types";
import { EVOLVEDMD_TENANT } from "./evolvedmd";

export type { TenantConfig, TenantMode } from "./types";

export const TENANT_CONFIGS: readonly TenantConfig[] = [EVOLVEDMD_TENANT];

export function tenantConfig(tenantId: string | null | undefined): TenantConfig | null {
  return TENANT_CONFIGS.find((t) => t.id === tenantId) ?? null;
}

export function tenantMode(tenantId: string | null | undefined): TenantMode {
  return tenantConfig(tenantId)?.mode ?? "standard";
}

export function isEvaluationTenant(tenantId: string | null | undefined): boolean {
  return tenantMode(tenantId) === "evaluation";
}

/** The banner every screen in an evaluation tenant carries (Handoff 11 §0). */
export const EVALUATION_BANNER = "Evaluation environment. No patient data.";

/** Pure. The banner text for a signed-in account's tenant, or null. */
export function evaluationBannerFor(tenantId: string | null | undefined): string | null {
  return isEvaluationTenant(tenantId) ? EVALUATION_BANNER : null;
}

/** Create or bring up to date the tenant row for a configured tenant, with
 *  its mode, so the database's PHI lock applies to it. Idempotent. */
export async function ensureConfiguredTenant(config: TenantConfig): Promise<void> {
  const c = await data();
  await c.run(
    `INSERT INTO tenants (id, kind, name, mode) VALUES (?, 'organization', ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, mode = excluded.mode`,
    [config.id, config.displayName, config.mode]
  );
}
