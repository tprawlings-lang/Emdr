// Regenerate the committed access inventory.
//
//   npx tsx scripts/gen-access-inventory.ts
//
// WHY IT IS COMMITTED RATHER THAN COMPUTED ON THE SCREEN. The inventory is
// derived from SOURCE, and source is not present at runtime in a deployed
// build — so a page that walked the tree would be reading files that are not
// there. Turbopack said so first, and in stronger terms: a dynamic filesystem
// read from a server component traces the whole project into the server bundle,
// which deploys every source file to serve one table.
//
// So the walk happens here, the result is checked in, and
// tests/access-enforcement.test.ts asserts the committed file still matches a
// fresh walk. A generated artefact nobody verifies is a stale artefact; this
// one fails the suite the moment a route's guards change.

import fs from "fs";
import path from "path";
import { inventory } from "../src/lib/governance/access-evidence";

const OUT = path.join(process.cwd(), "src/lib/governance/access-inventory.generated.ts");

const inv = inventory();
const header = `// GENERATED — do not edit by hand.
//
// Regenerate with: npx tsx scripts/gen-access-inventory.ts
//
// The permission-sequence inventory for every protected route (handoff 06
// §30.6, §31.5), walked out of the source at build time and committed so the
// review screen can render it without reading the filesystem at runtime.
// tests/access-enforcement.test.ts fails if this drifts from a fresh walk.

import type { AccessInventory } from "./access-evidence";

export const ACCESS_INVENTORY: AccessInventory = `;

fs.writeFileSync(OUT, `${header}${JSON.stringify(inv, null, 2)};\n`);
console.log(
  `wrote ${path.relative(process.cwd(), OUT)}: ${inv.protectedCount} protected routes, ` +
  `${inv.complete} with no gap`
);
