// What content names which sign-off row — so /review/content can say what
// each unsigned row is holding back. Kept apart from content-signoff.ts, which
// the content modules import, so this can import them without a cycle.
//
// Every content module that gains a `signoffRowId` is added here; a test in
// tests/content-signoff.test.ts fails if one names a row this does not see.

import { ALL_PRACTICES } from "./practices";
import { LESSONS } from "./lessons";

export interface RowUse { kind: "practice" | "lesson"; id: string; title: string; signoffRowId: string }

export function contentWithRows(): RowUse[] {
  const out: RowUse[] = [];
  for (const p of ALL_PRACTICES) {
    if (p.signoffRowId) out.push({ kind: "practice", id: p.id, title: p.title, signoffRowId: p.signoffRowId });
  }
  for (const l of LESSONS) {
    if (l.signoffRowId) out.push({ kind: "lesson", id: l.id, title: l.title, signoffRowId: l.signoffRowId });
  }
  return out;
}

export function contentUsingRow(rowId: string): RowUse[] {
  return contentWithRows().filter((u) => u.signoffRowId === rowId);
}
