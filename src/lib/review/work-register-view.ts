// The work register, arranged for somebody reading it rather than for a test.
//
// THE REGISTER'S CONSUMER WAS THE BUILD ALONE. Sixty-two entries recording what
// exists and what each claim rests on, checked mechanically on every run — and
// the only way to read one was to open a source file. That is most of what
// makes a handoff paragraph go stale in the first place: the accurate record
// was somewhere the person asking could not get to, so they asked a document
// instead, and the document was three weeks old.
//
// WHAT A READER ACTUALLY ASKS is not "list the register". It is one of three
// questions, and the arrangement here is those three rather than the file's
// own order:
//
//   "Is this built?" — answered by an entry, with the evidence under it, so
//   the answer arrives with its receipts instead of as a word.
//
//   "What is NOT built?" — the question a stale handoff gets wrong in the
//   expensive direction, because somebody rebuilds a thing that exists or
//   ships a thing that does not. Held and proposed entries are lifted out of
//   the list rather than left to be found in it.
//
//   "Why should I believe any of this?" — answered by the drift count, which
//   is the only number on the screen that can go up on its own.
//
// NOTHING HERE READS THE FILESYSTEM. The facts come from the committed
// `REGISTER_FINDINGS`; the walk that produced them ran in
// scripts/gen-work-register.ts. A screen that verified at request time would be
// reading `src` and `tests` in a deployed build, where neither exists.

import { WORK_REGISTER, type WorkEntry, type WorkState } from "../governance/work-register";
import { REGISTER_FINDINGS } from "../governance/work-register.generated";
import type { EntryFinding } from "../governance/work-register-verify";

/** Areas, in the order they are shown. */
export const AREA_LABEL: Record<string, string> = {
  clinical: "Clinical care",
  experience: "Experience",
  governance: "Governance",
  platform: "Platform",
  ops: "Operations",
  pilot: "Pilot",
  demo: "Demonstration",
  auth: "Sign-in",
  member: "Member",
  companion: "Companion",
  buyer: "Buyer",
};

export const STATE_LABEL: Record<WorkState, string> = {
  proposed: "Decided, not built",
  built: "Built, nothing has demonstrated it works",
  tested: "Tested, not reachable from a screen",
  reachable: "Built, tested, and reachable",
  held: "Deliberately not finished",
  superseded: "Replaced",
};

/** What a reader should do about an entry in this state. */
export const STATE_ADVICE: Record<WorkState, string> = {
  proposed: "Do not look for it in the product. Nothing has been written.",
  built: "Do not rely on it. Nothing has demonstrated it works.",
  tested: "It works in a test and no screen reaches it. Building it again would duplicate it.",
  reachable: "It exists and a person can get to it. Building it again would duplicate it.",
  held: "Stopped on purpose. Read the reason before restarting it.",
  superseded: "Replaced. Read the reason before rebuilding it.",
};

/** One claim the source was asked to support, and whether it does. */
export interface Evidence {
  claim: string;
  met: boolean;
  /** Said whether met or not: an unmet claim needs the reason, and a met one
   *  needs to say what was actually checked, or "yes" is just another word
   *  somebody has to trust. */
  detail: string;
}

export interface RegisterRow {
  entry: WorkEntry;
  area: string;
  finding: EntryFinding;
  evidence: Evidence[];
  /** The source disagrees with the entry's own claim. */
  drifted: boolean;
}

export function areaOf(id: string): string {
  return id.split(".")[0] ?? "other";
}

/**
 * THE EVIDENCE, IN THE ORDER IT WAS EARNED.
 *
 * Three claims rather than a state word, because the state collapses them and
 * the collapse is where the register could mislead: `built` is what a symbol
 * with no test reports, and it is also what a symbol wired into two screens
 * with no test reports. A reader deciding whether to trust something needs the
 * third row, not the summary of it.
 */
export function evidenceFor(entry: WorkEntry, finding: EntryFinding): Evidence[] {
  if (!entry.code) {
    return [{
      claim: "Has code",
      met: false,
      detail: entry.state === "proposed"
        ? "No code is named, which is what this state means."
        : "No code is named on the entry, so there is nothing to check.",
    }];
  }
  const [file, symbol] = entry.code.split("#");
  const f = finding.facts;
  return [
    {
      claim: "The code exists",
      met: f.defined,
      detail: f.defined ? `${file} defines ${symbol}.` : `${file} does not define ${symbol}.`,
    },
    {
      claim: "A test names it",
      met: f.tested,
      detail: entry.test
        ? f.tested ? `${entry.test} names ${symbol}.` : `${entry.test} never mentions ${symbol}.`
        : "No test is named on the entry.",
    },
    {
      // THE ONE THAT CAUGHT THE UNLOCK GAP. `requestUnlock` and `decideUnlock`
      // were fully built and fully tested and no screen called them.
      claim: "Something outside its own module uses it",
      met: f.wired,
      detail: f.wired
        ? `${symbol} is referenced outside ${file} and the tests.`
        : `${symbol} is referenced by nothing outside ${file} and the tests — built and unreachable.`,
    },
  ];
}

export function registerRows(
  entries: readonly WorkEntry[] = WORK_REGISTER,
  findings: readonly EntryFinding[] = REGISTER_FINDINGS,
): RegisterRow[] {
  const byId = new Map(findings.map((f) => [f.id, f]));
  return entries.map((entry) => {
    // A MISSING FINDING IS NOT AN ABSENT PROBLEM. An entry the generated file
    // has never seen is an entry nothing checked, and reporting it as clean
    // would be the register's own failure mode: a claim that looks verified
    // because nobody looked.
    const finding: EntryFinding = byId.get(entry.id) ?? {
      id: entry.id,
      claimed: entry.state,
      supported: "proposed",
      facts: { defined: false, tested: false, wired: false },
      problems: ["nothing has checked this entry — run: npx tsx scripts/gen-work-register.ts"],
    };
    return {
      entry,
      area: areaOf(entry.id),
      finding,
      evidence: evidenceFor(entry, finding),
      drifted: finding.problems.length > 0,
    };
  });
}

export interface RegisterArea {
  area: string;
  label: string;
  rows: RegisterRow[];
}

/** Grouped for browsing, areas in `AREA_LABEL` order and anything new after. */
export function registerAreas(rows: readonly RegisterRow[] = registerRows()): RegisterArea[] {
  const order = Object.keys(AREA_LABEL);
  const seen = new Map<string, RegisterRow[]>();
  for (const row of rows) {
    const list = seen.get(row.area) ?? [];
    list.push(row);
    seen.set(row.area, list);
  }
  const rank = (a: string) => {
    const i = order.indexOf(a);
    return i === -1 ? order.length : i;
  };
  return [...seen.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([area, list]) => ({ area, label: AREA_LABEL[area] ?? area, rows: list }));
}

export interface RegisterSummary {
  entries: number;
  byState: Record<WorkState, number>;
  /** Entries whose own claim the source does not support. Reads zero, or the
   *  register is lying and the suite is already red. */
  drifted: number;
}

export function registerSummary(rows: readonly RegisterRow[] = registerRows()): RegisterSummary {
  const byState: Record<WorkState, number> = {
    proposed: 0, built: 0, tested: 0, reachable: 0, held: 0, superseded: 0,
  };
  for (const row of rows) byState[row.entry.state]++;
  return {
    entries: rows.length,
    byState,
    // NO `unfinished` COUNT HERE. The screen shows those entries in a panel of
    // their own and counts what it renders; a second derivation of the same
    // number in a second place is the shape of every figure that eventually
    // disagrees with the list under it.
    drifted: rows.filter((r) => r.drifted).length,
  };
}

/**
 * What is NOT built, with the reason, lifted to the top of the screen.
 *
 * NOT A FILTER OVER THE SAME LIST. Somebody who reads this screen to decide
 * whether to build something is reading it for these entries, and asking them
 * to spot four rows in sixty-two is asking them to miss one — which costs a
 * rebuild of something that exists, or a shipped promise of something that
 * does not.
 */
export function unfinished(rows: readonly RegisterRow[] = registerRows()): RegisterRow[] {
  return rows
    .filter((r) => r.entry.state === "held" || r.entry.state === "proposed")
    .sort((a, b) => a.entry.id.localeCompare(b.entry.id));
}
