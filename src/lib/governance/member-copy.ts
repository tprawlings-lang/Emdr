// Modality names stay out of member copy (Handoff 10 §8.2; rows CV10_F02 and
// CV10_F03). Run in CI as its own step (scripts/check-member-copy.ts), and by
// tests/member-copy-names.test.ts in the @safety suite.
//
// Why structural rather than a grep: the rule is "fails in member-facing
// string fields; allowed in comments and sign-off ids". A grep reads comments
// and ids too, so it would either fail on the review rows that NAME the rule
// (CV10_F02's own text says "DBT, ACT, STAIR, CBT-I") or need exceptions that
// could hide a real hit. Walking the loaded content reads exactly what a
// member can be shown, and nothing else.
//
// Scanned: every practice (skills and night practices included), every lesson,
// every program with its entry screen. The same files the banned-vocabulary
// grep covers in src/lib (practices.ts, lessons.ts, programs.ts, content/).

import { ALL_PRACTICES } from "../practices";
import { LESSONS } from "../lessons";
import { PROGRAMS } from "../programs";

/** The handoff's names, plus CBT and IPT, which the review worksheet's
 *  voice rule ("no modality names") covers as well. Case-sensitive: "act"
 *  and "stair" are ordinary words. */
export const MODALITY_NAME = /\b(DBT|ACT|STAIR|CBT-I|CBT|EMDRIA|IPT)\b/;

/** Fields that are identifiers or references, never shown as words. */
const NOT_MEMBER_COPY = new Set([
  "id", "signoffRowIds", "sourceTechniqueId", "lessonId", "practiceIds", "audioAssetId",
  "relatedProgramIds", "outcomeMeasureIds", "activity", "type", "kind", "phase",
]);

export interface CopyHit { where: string; text: string }

/** Every member-facing string in one value that names a modality. */
export function copyHits(value: unknown, where: string): CopyHit[] {
  const out: CopyHit[] = [];
  walk(value, where, out);
  return out;
}

function walk(value: unknown, where: string, out: CopyHit[]): void {
  if (typeof value === "string") {
    if (MODALITY_NAME.test(value)) out.push({ where, text: value.match(MODALITY_NAME)![0] });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${where}[${i}]`, out));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (!NOT_MEMBER_COPY.has(k)) walk(v, `${where}.${k}`, out);
    }
  }
}

/** Every member-facing string in the content that names a modality. */
export function modalityHits(): CopyHit[] {
  const out: CopyHit[] = [];
  for (const p of ALL_PRACTICES) walk(p, `practice:${p.id}`, out);
  for (const l of LESSONS) walk(l, `lesson:${l.id}`, out);
  for (const p of PROGRAMS) walk(p, `program:${p.id}`, out);
  return out;
}
