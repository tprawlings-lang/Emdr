// CI step: modality names stay out of member copy (Handoff 10 §8.2). The rule
// lives in src/lib/governance/member-copy.ts, where the tests reach it.

import { ALL_PRACTICES } from "../src/lib/practices";
import { LESSONS } from "../src/lib/lessons";
import { PROGRAMS } from "../src/lib/programs";
import { modalityHits } from "../src/lib/governance/member-copy";

const hits = modalityHits();
if (hits.length > 0) {
  console.error("Modality names in member copy (Handoff 10 §8.2):");
  for (const h of hits) console.error(`  ${h.where}: ${h.text}`);
  process.exit(1);
}
console.log(`member copy: no modality names (${ALL_PRACTICES.length} practices, ${LESSONS.length} lessons, ${PROGRAMS.length} programs)`);
