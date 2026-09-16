// Checking the register against the source.
//
// A HAND-MAINTAINED LIST DRIFTS EXACTLY LIKE THE PARAGRAPHS IT REPLACES, so
// every claim in `WORK_REGISTER` is checked mechanically and the suite fails
// when one stops being true. The register is the claim; this is the evidence.
//
// THE REACHABILITY CHECK IS THE POINT. `requestUnlock` and `decideUnlock` were
// fully built, tested, and referenced by nothing outside their own module —
// recorded as done and unreachable from any screen. A check that only asked
// "does the symbol exist" would have passed them, and did, for weeks.

import fs from "fs";
import path from "path";

import { WORK_REGISTER, type WorkEntry, type WorkState } from "./work-register";

export interface EntryFinding {
  id: string;
  /** What the register claims. */
  claimed: WorkState;
  /** The strongest claim the source actually supports. */
  supported: WorkState;
  problems: string[];
}

const ROOT = path.join(__dirname, "..", "..", "..");
/** Every source and test file, read once. */
function allFiles(): { rel: string; src: string }[] {
  const out: { rel: string; src: string }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push({ rel, src: fs.readFileSync(path.join(ROOT, rel), "utf8") });
    }
  };
  walk("src");
  walk("tests");
  return out;
}

function parseCode(code: string): { file: string; symbol: string } | null {
  const [file, symbol] = code.split("#");
  return file && symbol ? { file, symbol } : null;
}

export interface EntryFacts {
  /** The symbol exists where the entry says it does. */
  defined: boolean;
  /** A test file names it. */
  tested: boolean;
  /** Something outside its own module and the tests refers to it. */
  wired: boolean;
}

/**
 * THREE INDEPENDENT FACTS, not a ladder.
 *
 * The first version of this walked defined → tested → wired and stopped at the
 * first failure, which made "wired but untested" inexpressible — and the very
 * first run hit it: `decideUnlock` is referenced by two pages and named by no
 * test. A model that cannot describe the state a thing is actually in will be
 * made to lie about it, which is the drift this file exists to catch.
 */
export function factsFor(entry: WorkEntry, files: { rel: string; src: string }[]): EntryFacts {
  const parsed = entry.code ? parseCode(entry.code) : null;
  if (!parsed) return { defined: false, tested: false, wired: false };

  const file = files.find((f) => f.rel === parsed.file);
  const named = new RegExp(`\\b${parsed.symbol}\\b`);
  if (!file || !named.test(file.src)) return { defined: false, tested: false, wired: false };

  const test = entry.test ? files.find((f) => f.rel === entry.test) : undefined;
  // ITS OWN FILE AND THE TESTS DO NOT COUNT. A symbol always appears where it
  // is defined, and a feature reachable only from its tests is the unlock gap
  // exactly: fully built, fully tested, and unreachable from any screen.
  const wired = files.some(
    (f) => f.rel !== parsed.file && !f.rel.startsWith("tests/") && named.test(f.src),
  );
  return { defined: true, tested: Boolean(test && named.test(test.src)), wired };
}

const REQUIRES: Record<WorkState, Partial<EntryFacts>> = {
  proposed: {},
  held: {},
  superseded: {},
  built: { defined: true },
  tested: { defined: true, tested: true },
  reachable: { defined: true, tested: true, wired: true },
};

export function verifyRegister(entries: WorkEntry[] = WORK_REGISTER): EntryFinding[] {
  const files = allFiles();
  return entries.map((entry) => {
    const problems: string[] = [];
    const facts = factsFor(entry, files);
    const parsed = entry.code ? parseCode(entry.code) : null;

    if (entry.code && !parsed) problems.push(`code should read "path#symbol", got "${entry.code}"`);

    if (parsed && !facts.defined) {
      const file = files.find((f) => f.rel === parsed.file);
      problems.push(file ? `${parsed.file} does not define ${parsed.symbol}` : `${parsed.file} does not exist`);
    }
    if (entry.test && !files.some((f) => f.rel === entry.test)) {
      problems.push(`${entry.test} does not exist`);
    } else if (parsed && facts.defined && entry.test && !facts.tested) {
      problems.push(`${entry.test} never mentions ${parsed.symbol}`);
    }

    // SAID FOR EVERY BUILT ENTRY, whatever it claims. Something built and
    // unreachable is the failure this register was written for, and hiding it
    // behind a modest claim would be the register colluding in it.
    if (parsed && facts.defined && !facts.wired && entry.state !== "superseded") {
      problems.push(
        `${parsed.symbol} is referenced by nothing outside ${parsed.file} and the tests — ` +
        "built and unreachable",
      );
    }
    if (parsed && facts.defined && !facts.tested && entry.state !== "held" && entry.state !== "proposed") {
      problems.push(`no test names ${parsed.symbol}`);
    }
    if ((entry.state === "held" || entry.state === "superseded") && !entry.note) {
      problems.push(`state "${entry.state}" needs a note saying why`);
    }

    for (const [fact, needed] of Object.entries(REQUIRES[entry.state])) {
      if (needed && !facts[fact as keyof EntryFacts]) {
        problems.push(`claims "${entry.state}", which requires ${fact}`);
      }
    }

    const supported: WorkState =
      !facts.defined ? "proposed" : facts.tested && facts.wired ? "reachable" : facts.tested ? "tested" : "built";
    return { id: entry.id, claimed: entry.state, supported, problems };
  });
}

/** The entries whose claim the source does not support. */
export function registerDrift(entries: WorkEntry[] = WORK_REGISTER): EntryFinding[] {
  return verifyRegister(entries).filter((f) => f.problems.length > 0);
}
