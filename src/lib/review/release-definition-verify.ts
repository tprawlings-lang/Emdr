// Checking the release definition against the repository.
//
// The `computed` rows answer themselves and need no checking — that is the
// whole reason to prefer them. The `attested` rows are the ones that can drift:
// they name a test file and claim it holds a line of the release definition, so
// the file has to exist and has to MENTION THE ITEM, the same two-way link the
// failure register uses. A test that does not name what it is evidence for is a
// test that can be rewritten into something else while the checklist keeps its
// tick.

import fs from "fs";
import path from "path";

import { RELEASE_DEFINITION, type ReleaseItem } from "./release-definition";

const ROOT = path.join(__dirname, "..", "..", "..");

export interface ItemFinding {
  id: string;
  problems: string[];
}

export function verifyDefinition(
  items: readonly ReleaseItem[] = RELEASE_DEFINITION
): ItemFinding[] {
  return items.map((item) => {
    const problems: string[] = [];

    if (item.answerable === "computed" && !item.answer) {
      problems.push("is computed and has nothing to compute");
    }
    if (item.answerable === "attested") {
      if (!item.evidence || item.evidence.length === 0) {
        problems.push("is attested and names no evidence, which is an assertion");
      }
      for (const rel of item.evidence ?? []) {
        let src: string;
        try {
          src = fs.readFileSync(path.join(ROOT, rel), "utf8");
        } catch {
          problems.push(`names ${rel}, which does not exist`);
          continue;
        }
        if (!src.includes(item.id)) {
          problems.push(`${rel} never names ${item.id}, so it is not evidence for this line`);
        }
      }
    }
    if ((item.answerable === "human" || item.answerable === "decision")) {
      if (!item.owner) problems.push("waits on a person and names nobody");
      if (!item.asks || item.asks.length < 40) {
        // A row that says only "a human must do this" is a row nobody can pick
        // up, and it will still be open at the next release for that reason.
        problems.push("waits on a person and does not say what is actually required");
      }
    }
    if (item.answerable !== "attested" && item.evidence) {
      problems.push("names test evidence but is not attested, so nothing checks the link");
    }

    return { id: item.id, problems };
  });
}

export function definitionDrift(
  items: readonly ReleaseItem[] = RELEASE_DEFINITION
): ItemFinding[] {
  return verifyDefinition(items).filter((f) => f.problems.length > 0);
}
