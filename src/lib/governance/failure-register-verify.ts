// Checking the failure register against the tests.
//
// THE RULE IS STRONGER THAN THE WORK REGISTER'S, on purpose. That one asks
// whether a test file names a symbol. This one asks whether a test names THIS
// SCENARIO — because a file called `queue-concurrency.spec.ts` existing is not
// evidence that anything injects a concurrent command, and the whole value of
// P6's acceptance is the difference between those two statements.
//
// So a `proven` row names a test file that contains the row's id, and the id
// is what a reader greps to find the injection. Delete the assertion, or
// rename the scenario, and the register stops verifying.

import fs from "fs";
import path from "path";

import { FAILURE_REGISTER, type FailureScenario } from "./failure-register";

export interface ScenarioFinding {
  id: string;
  problems: string[];
}

const ROOT = path.join(__dirname, "..", "..", "..");

function readIfPresent(rel: string): string | null {
  const full = path.join(ROOT, rel);
  try {
    return fs.readFileSync(full, "utf8");
  } catch {
    return null;
  }
}

/**
 * Check every row against the tests it names.
 *
 * Takes the register as an argument so a fixture can exercise the rules
 * directly. The suite learned this from the work register: a test that
 * reimplemented a rule instead of calling the verifier passed while the
 * verifier's own copy of that rule was deleted.
 */
export function verifyFailureRegister(
  register: readonly FailureScenario[] = FAILURE_REGISTER
): ScenarioFinding[] {
  return register.map((entry) => {
    const problems: string[] = [];

    for (const rel of entry.injections) {
      const src = readIfPresent(rel);
      if (src === null) {
        problems.push(`names ${rel}, which does not exist`);
        continue;
      }
      // THE TWO-WAY LINK. A test that does not name the scenario cannot be
      // found from it, and nothing stops it drifting to testing something else.
      if (!src.includes(entry.id)) {
        problems.push(`${rel} never names ${entry.id}, so it is not evidence for this row`);
      }
    }

    if (entry.state === "proven" && entry.injections.length === 0) {
      problems.push("is proven with no injection named, which is an assertion rather than evidence");
    }
    if (entry.state === "held" && !(entry.note && entry.note.length > 20)) {
      problems.push("is held and needs a note saying why");
    }
    if (entry.state === "gap" && entry.injections.length > 0) {
      problems.push("is a gap and names an injection, which are contradictory claims");
    }
    if (!entry.required.trim()) {
      problems.push("states no required behaviour, so nothing could be checked against it");
    }

    return { id: entry.id, problems };
  });
}

/** Only the rows with something wrong. */
export function failureRegisterDrift(
  register: readonly FailureScenario[] = FAILURE_REGISTER
): ScenarioFinding[] {
  return verifyFailureRegister(register).filter((f) => f.problems.length > 0);
}
