// The research workspace's one dataset (§26 p44: "Research workspace —
// /review/research — Use approved de-identified data — Consent and cohort
// guardrails — Request export").
//
// ONE builder, used by both the screen and the export action. That is not
// tidiness — export.ts hashes the filter the SCREEN was showing so a file can
// be checked against the view that produced it, and a second code path
// building "the same" rows for the file is exactly how an export silently
// widens its own filter.

import { COHORTS } from "../metrics/cohorts";
import { eligible, inGroup } from "../metrics/compute";
import { loadObservations, type Window } from "../metrics/population-metrics";
import { populationTenantIds } from "../planning/scope";
import { SMALL_CELL } from "@/components/charts/aggregate";

export interface CohortRow {
  cohortId: string;
  cohortVersion: string;
  label: string;
  question: string;
  /** People meeting the eligibility rule, BEFORE any group filter. */
  eligibleN: number;
  /** People in the group itself. */
  groupN: number;
  /** True when groupN is small enough that reporting it could identify
   *  someone. The number is still carried — suppression is applied at the
   *  point of display and export, not by destroying it here, or the two could
   *  disagree about what was hidden. */
  suppressed: boolean;
}

export interface CohortTable {
  rows: CohortRow[];
  /** The filter the screen was showing, hashed into the export for parity. */
  filter: Record<string, unknown>;
  observations: number;
  smallCell: number;
}

/** The de-identified cohort table. No person-level column is produced at any
 *  point — the workspace has no path to one, rather than a rule against it. */
export async function cohortTable(window?: Window): Promise<CohortTable> {
  const tenantIds = populationTenantIds();
  const rows = await loadObservations(tenantIds, window);

  const out: CohortRow[] = COHORTS.map((c) => {
    const elig = eligible(rows, c);
    const grp = inGroup(rows, c);
    return {
      cohortId: c.id,
      cohortVersion: c.version,
      label: c.label,
      question: c.question,
      eligibleN: elig.length,
      groupN: grp.length,
      suppressed: grp.length > 0 && grp.length < SMALL_CELL,
    };
  });

  return {
    rows: out,
    filter: {
      scope: "demo-population",
      tenants: tenantIds.length,
      window: window ? `${window.start}..${window.end}` : "all",
    },
    observations: rows.length,
    smallCell: SMALL_CELL,
  };
}
