import { PLATFORM_TENANT_ID } from "@/lib/db";
import { REGION_NAMES, orgTenantId } from "@/lib/demo-population-seed";
import type { Role } from "@/lib/roles";

// Where planning signals are computed from, and where they are filed.
//
// THESE ARE TWO DIFFERENT ANSWERS, and the difference is not an implementation
// detail. The DATA comes from the eight demo organizations (p11: two per
// region); the SIGNAL belongs to none of them, because a cohort like "South,
// 55–64" or "Spanish preferred" is defined across organizations and filing it
// under whichever one happened to be first in an array would be a lie about
// whose finding it is.
//
// So signals are filed against the platform tenant and read by the roles p50
// gives full planning_review access to — reviewer and demo admin.
//
// WHAT THIS LEAVES OUT, stated rather than discovered later. p50 gives
// organization and payer "subset" on planning_review, and this build gives
// them none. The reason is a gap in the cohort registry rather than in the
// authorization: every cohort declared so far is defined by region, age or
// language, and every one of them spans several organizations. A subset view
// needs cohorts that are scoped to one tenant to be a subset OF, and those
// arrive with the fairness work in Wave 7 (p37, p43) — which is also where the
// small-cell and minimum-analysis-size questions that a per-organization
// cohort immediately raises get answered.

/** Where a signal is filed. */
export const PLANNING_TENANT_ID = PLATFORM_TENANT_ID;

/** The eight demo organizations the population lives in. */
export function populationTenantIds(): string[] {
  const regions = Object.keys(REGION_NAMES) as (keyof typeof REGION_NAMES)[];
  return regions.flatMap((r) => [orgTenantId(r, "A"), orgTenantId(r, "B")]);
}

/** Which stored signals a role may read. Empty means the console is closed to
 *  them, which is a different answer from an empty list of signals and is why
 *  the screens check the role rather than checking for rows. */
export function readableSignalTenants(role: Role): string[] {
  return role === "reviewer" || role === "demo_admin" ? [PLANNING_TENANT_ID] : [];
}
