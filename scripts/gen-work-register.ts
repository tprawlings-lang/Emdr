// Regenerate the committed work-register verification.
//
//   npx tsx scripts/gen-work-register.ts
//
// THE REGISTER'S HEADER HAS NAMED THIS SCRIPT SINCE THE FILE WAS WRITTEN and
// the script did not exist. The check it describes was real — it lives in
// `work-register-verify.ts` and runs from `tests/work-register.test.ts` — but
// the register's own first paragraph pointed at a path nobody could open,
// which is the drift the register exists to end, in the register.
//
// WHY IT IS COMMITTED RATHER THAN COMPUTED ON THE SCREEN. `verifyRegister`
// walks `src` and `tests` off disk. Neither is present in a deployed
// standalone build, so a review screen that called it would read files that
// are not there — and under Turbopack a dynamic filesystem read from a server
// component traces the whole project into the server bundle, deploying every
// source file to render one table. Exactly the reasoning behind
// `access-inventory.generated.ts`, and the same remedy: walk here, commit the
// result, and let the suite fail when it drifts.

import fs from "fs";
import path from "path";
import { verifyRegister } from "../src/lib/governance/work-register-verify";

const OUT = path.join(process.cwd(), "src/lib/governance/work-register.generated.ts");

const findings = verifyRegister();
const drift = findings.filter((f) => f.problems.length > 0);

const header = `// GENERATED — do not edit by hand.
//
// Regenerate with: npx tsx scripts/gen-work-register.ts
//
// What the SOURCE says about every entry in \`WORK_REGISTER\`: whether the
// symbol exists, whether a test names it, and whether anything outside its own
// module refers to it. Walked out of the tree at build time and committed so
// /review/work can render it without reading the filesystem at runtime.
// tests/work-register.test.ts fails if this drifts from a fresh walk.

import type { EntryFinding } from "./work-register-verify";

export const REGISTER_FINDINGS: EntryFinding[] = `;

fs.writeFileSync(OUT, `${header}${JSON.stringify(findings, null, 2)};\n`);
console.log(
  `wrote ${path.relative(process.cwd(), OUT)}: ${findings.length} entries, ` +
  `${drift.length} with the source disagreeing`,
);