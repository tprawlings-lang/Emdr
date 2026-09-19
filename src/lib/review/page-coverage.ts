// The page coverage matrix (17 September handoff, P7).
//
//   "For every registered route, record its role, job, primary action, data
//   source, permission boundary, presentation states, desktop evidence,
//   narrow-screen evidence, keyboard evidence, screen-reader evidence,
//   limitations, and latest verified commit."
//
// TWELVE COLUMNS, AND THE INTERESTING ANSWER IS WHICH ONES ARE EMPTY. A matrix
// assembled by hand would be filled in — every cell would say something,
// because a blank cell in a document looks like an oversight and the person
// filling it in has a deadline. So this one is DERIVED: each column reads a
// source that already exists, and a column with no source says so.
//
// Four of the twelve have no source, and that is the finding rather than a
// formatting problem:
//
//   PRIMARY ACTION and PRESENTATION STATES are not recorded per route. The
//   route register carries a job — what somebody comes to do — and the two are
//   not the same: "understand what changed" is a job, and the primary action is
//   the control that does it. Recording them means writing them, route by
//   route, with somebody who knows which control is primary.
//
//   KEYBOARD and SCREEN-READER EVIDENCE are not recorded because nobody has
//   produced any. The automated scan covers every working route and finds
//   contrast, names, roles and structure; it does not operate the product with
//   a keyboard or listen to it. Those columns stay empty until a person fills
//   them, and an empty column is the honest state.

import { ROUTE_REGISTER, WORKSPACE_OWNER, type RouteEntry } from "../app/route-register";
import { ACCESS_INVENTORY } from "../governance/access-inventory.generated";
import { VISUAL_BASELINE } from "../experience/visual-baseline.generated";
import { versionReport } from "../version";

/** A column's answer, or the reason there is not one. */
export type Cell =
  | { known: true; value: string }
  | { known: false; because: string };

const known = (value: string): Cell => ({ known: true, value });
const unknown = (because: string): Cell => ({ known: false, because });

export interface PageRow {
  path: string;
  role: Cell;
  job: Cell;
  owner: Cell;
  primaryAction: Cell;
  dataSource: Cell;
  permissionBoundary: Cell;
  presentationStates: Cell;
  desktopEvidence: Cell;
  narrowScreenEvidence: Cell;
  keyboardEvidence: Cell;
  screenReaderEvidence: Cell;
  limitations: Cell;
  verifiedCommit: Cell;
}

export const COLUMNS: Array<{ key: keyof Omit<PageRow, "path">; label: string }> = [
  { key: "role", label: "Role" },
  { key: "job", label: "Job" },
  { key: "owner", label: "Owner" },
  { key: "primaryAction", label: "Primary action" },
  { key: "dataSource", label: "Data source" },
  { key: "permissionBoundary", label: "Permission boundary" },
  { key: "presentationStates", label: "Presentation states" },
  { key: "desktopEvidence", label: "Desktop evidence" },
  { key: "narrowScreenEvidence", label: "Narrow-screen evidence" },
  { key: "keyboardEvidence", label: "Keyboard evidence" },
  { key: "screenReaderEvidence", label: "Screen-reader evidence" },
  { key: "limitations", label: "Limitations" },
  { key: "verifiedCommit", label: "Latest verified commit" },
];

/**
 * Which routes the automated sweeps cover.
 *
 * DERIVED FROM THE SAME RULE THE SPECS USE — every route the register calls
 * `working`, minus the dynamic segments they cannot resolve — rather than from
 * a second list that would drift from what actually ran.
 */
function sweptByAutomatedChecks(route: RouteEntry): boolean {
  if (route.state !== "working") return false;
  if (!route.path.includes("[")) return true;
  return route.path.startsWith("/clinician/member/[id]");
}

export function pageCoverage(): PageRow[] {
  const v = versionReport();
  const commit: Cell = v.commitShort
    ? known(v.commitShort)
    : unknown("This build reports no commit, so nothing gathered here can be tied to one.");

  const baselined = new Set(VISUAL_BASELINE.screens.map((s) => s.route));
  const access = new Map(ACCESS_INVENTORY.routes.map((r) => [r.path, r]));

  return ROUTE_REGISTER.map((route): PageRow => {
    const swept = sweptByAutomatedChecks(route);
    const acc = access.get(route.path);

    return {
      path: route.path,
      role: known(route.audience),
      job: known(route.job),
      owner: known(WORKSPACE_OWNER[route.workspace]),

      // The register records the JOB — what somebody comes here to do. The
      // primary action is the control that does it, and the two are not the
      // same sentence.
      primaryAction: unknown("Not recorded per route. The register carries the job, which is not the control."),
      dataSource: unknown("Not recorded per route."),

      permissionBoundary: acc
        ? acc.missing.length === 0
          ? known(`${acc.owed.length} access step(s) owed, all shown`)
          : known(`${acc.owed.length} owed, step(s) ${acc.missing.join(", ")} not shown`)
        : route.audience === "public"
          ? known("Public: no boundary owed")
          : unknown("The access inventory does not cover this route."),

      presentationStates: unknown("Not recorded per route."),

      desktopEvidence: swept
        ? known(
            baselined.has(route.path)
              ? "Automated accessibility scan and a committed structural baseline"
              : "Automated accessibility scan",
          )
        : unknown(
            route.state === "working"
              ? "A dynamic segment the automated sweeps cannot resolve."
              : `The route is ${route.state}, so there is nothing to scan.`,
          ),

      narrowScreenEvidence: swept
        ? known("Reflow and control size measured at 320px")
        : unknown(
            route.state === "working"
              ? "A dynamic segment the automated sweeps cannot resolve."
              : `The route is ${route.state}.`,
          ),

      // THE TWO COLUMNS NOBODY HAS FILLED. Stated the same way for every route
      // rather than left blank, because a blank cell reads as an oversight and
      // this is a decision nobody has taken yet.
      keyboardEvidence: unknown("No keyboard walkthrough has been recorded for any route."),
      screenReaderEvidence: unknown("No screen-reader pass has been recorded for any route."),

      limitations: route.evidence ? known(route.evidence) : known("None recorded"),
      verifiedCommit: commit,
    };
  });
}

export interface CoverageSummary {
  routes: number;
  /** Column label -> how many routes have an answer for it. */
  answered: Record<string, number>;
  /** Columns no route can answer. The worklist. */
  emptyColumns: string[];
}

export function coverageSummary(rows: readonly PageRow[]): CoverageSummary {
  const answered: Record<string, number> = {};
  for (const col of COLUMNS) {
    answered[col.label] = rows.filter((r) => r[col.key].known).length;
  }
  return {
    routes: rows.length,
    answered,
    emptyColumns: COLUMNS.filter((c) => answered[c.label] === 0).map((c) => c.label),
  };
}
