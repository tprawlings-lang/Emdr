// The reviewer's service-status screen (§26 p44: "/review/status — See health
// and safe fallback — service health, version, degradation and the safe
// fallback").
//
// The failure mode this screen exists to avoid is a status page that is a
// claim rather than a reading. A hand-written row saying "operational" is an
// assertion by somebody who was not looking; the whole value of the screen is
// that every row came from a probe. So the guards below are not about layout.
// They check that the page cannot state health without measuring it, that the
// two functions which must survive every failure are reachable FROM this
// screen (a reviewer reading about the fallback should be one click from
// walking it), and that the version strings have exactly one definition each.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { REVIEW_SCREENS } from "../src/components/clinical/ReviewPage";
import { SAFETY_CONFIG_VERSION } from "../src/lib/safety/governance";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

/** The prose on these pages discusses the rules at length; guards are about
 *  code. Without this, the page's own explanation of why it hard-codes nothing
 *  would trip the check that it hard-codes nothing. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

const PAGE_PATH = "src/app/review/status/page.tsx";
const PAGE = read(PAGE_PATH);
const BODY = code(PAGE);

test("the screen exists and is registered in the review rail", () => {
  const entry = REVIEW_SCREENS.find((s) => s.href === "/review/status");
  assert.ok(entry, "/review/status is not in REVIEW_SCREENS — it would be unreachable by navigation");
  // A screen listed under the wrong layer is a screen a reviewer finds by
  // accident. Health and versions are evidence, not an action.
  assert.equal(entry!.layer, "evidence");
});

test("health is read, never asserted", () => {
  // Both sources probe rather than declare: readServiceStatus queries the
  // database, demoHealth counts rows.
  assert.match(BODY, /readServiceStatus\(\)/, "the page does not call readServiceStatus()");
  assert.match(BODY, /demoHealth\(/, "the page does not call demoHealth()");
  // And it renders what came back, rather than a list of its own.
  assert.match(BODY, /status\.functions\.map/, "the function rows are not mapped from the probe result");
  assert.match(BODY, /health\.checks\.map/, "the invariant rows are not mapped from the health result");
});

test("no state word is written into the rendered rows", () => {
  // Scoped to the two mapped lists on purpose. The page's own prose quotes the
  // word "operational" while explaining that it refuses to write one, and a
  // guard that reads the whole file would fire on that sentence — a check that
  // trips over its subject is a check that will be deleted rather than fixed.
  //
  // Inside a row, though, a state word can only be hand-written: the probe's
  // own vocabulary arrives through `f.state` and `c.ok`.
  const rows = [...BODY.matchAll(/\.map\(\(([\s\S]*?)\n\s*<\/ul>/g)].map((m) => m[1]);
  assert.equal(rows.length, 2, "expected exactly the two probe-driven lists");
  for (const region of rows) {
    // The state words themselves are not forbidden here: a row compares
    // against `f.state` to pick a glyph, which is the correct use of them.
    // What must not appear is vocabulary the probe never produces.
    for (const claim of ["operational", "all systems", "healthy", "no known issues", "up and running"]) {
      assert.ok(!new RegExp(claim, "i").test(region),
        `a row states "${claim}" itself instead of reporting a measurement`);
    }
  }
});

test("the safe fallback is reachable from the screen, not just described", () => {
  // §1: grounding and crisis survive every failure. A reviewer asked "does it
  // fail safe" should be able to press the thing and see.
  for (const href of ["/crisis", "/app/ground", "/status/degraded"]) {
    assert.ok(PAGE.includes(`"${href}"`), `the safe fallback does not link to ${href}`);
  }
});

test("the safety configuration is shown as provisional", () => {
  // The version is the one thing on the page a reader could mistake for
  // ratification. It is not: nothing here carries clinician sign-off.
  assert.match(PAGE, /provisional/i);
  assert.match(PAGE, /sign-?off/i);
});

test("every version on the page comes from its module's own constant", () => {
  // A version copied into a status page is worse than no version: it keeps
  // reporting the build it was typed during.
  assert.match(BODY, /DEMO_SEED_VERSION/);
  assert.match(BODY, /DATASET_VERSION/);
  assert.match(BODY, /RULE_VERSION/);
  assert.match(BODY, /THRESHOLD_VERSION/);
  assert.match(BODY, /SAFETY_CONFIG_VERSION/);
  // No version-shaped literal in the rendered values.
  const literals = BODY.match(/"[a-z0-9]+-[a-z0-9]+-\d{4}-\d{2}"/gi) ?? [];
  assert.deepEqual(literals, [], `version strings written literally into the page: ${literals.join(", ")}`);
});

test("the safety config version has exactly one definition", () => {
  // It used to be typed out in three modules, which is how a page can end up
  // reporting a version the engine has moved past. Comments may name it —
  // several explain the revision — but no other module may define it.
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e.name)) files.push(rel);
    }
  };
  walk("src");
  const offenders = files.filter((f) =>
    f !== "src/lib/safety/governance.ts" && code(read(f)).includes(SAFETY_CONFIG_VERSION));
  assert.deepEqual(offenders, [],
    `these modules repeat the safety config version instead of importing SAFETY_CONFIG_VERSION: ${offenders.join(", ")}`);
});

// ---------------------------------------------------------------------------
// The probe time is a probe time, not a render time
// ---------------------------------------------------------------------------
//
// `checkedAt` is the one line on this page whose entire job is to be
// trustworthy: it says when Steady last looked. It was being stamped with a
// bare `new Date()` inside the render, and React renders a server component
// more than once per request — the HTML pass and the RSC payload — so the two
// passes disagreed by a second and the page hydrated with a mismatch on
// exactly that line.
//
// The fix is to scope the probe to the request rather than to the render.
// These guards check the shape of that rather than the timestamp: a test that
// asserted two calls return the same string would pass by coincidence
// whenever both landed inside one second, which is nearly always.

test("the status probe is scoped to the request, not to the render pass", async () => {
  const SRC = read("src/lib/site/service-status.ts");
  const body = code(SRC);

  // React's `cache` is what makes a probe run once per request across every
  // render pass. Without it the timestamp is a render artefact.
  assert.match(body, /import \{ cache \} from "react"/,
    "service-status does not import React's cache()");
  assert.match(body, /export const readServiceStatus = cache\(/,
    "readServiceStatus is not wrapped in cache() — the probe would re-run per render pass");

  // And the clock is read exactly once, inside the memoised probe. A second
  // `new Date()` anywhere in the module would reintroduce the mismatch on
  // whichever value it fed.
  const clocks = body.match(/new Date\(\)|Date\.now\(\)/g) ?? [];
  assert.equal(clocks.length, 1,
    `service-status reads the clock ${clocks.length} times; the probe stamps one moment`);
});

test("the memoised probe still returns a real reading", async () => {
  const mod = await import("../src/lib/site/service-status");
  const status = await mod.readServiceStatus();

  // Wrapping must not have turned the probe into a stub. Grounding and crisis
  // are the two that must be present in every reading.
  assert.ok(status.functions.length >= 3, "the probe returned almost nothing");
  const always = status.functions.filter((f) => f.alwaysAvailable);
  assert.equal(always.length, 2, "the two always-available functions are not both reported");
  assert.match(status.checkedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    `checkedAt is not a stamped instant: ${status.checkedAt}`);
});
