process.env.EMDR_DATA_DIR = `/tmp/steady-screenerapproval-${process.pid}-${Date.now()}`;

// The fitness screener's approval state (compliance packet 3.6, §34's rule).
//
// THE DEFECT WAS A NAMING CONVENTION DOING A SAFETY JOB. `fit-v1-placeholder`
// is a string, and the only thing between a reader and the belief that these
// criteria are clinically settled was four syllables at the end of it. The
// string travels: it is stamped on every stored screening row and served over
// `/api/mobile/v1/screener` to a client that has no idea what the suffix means.
//
// WHAT THESE ITEMS DECIDE makes that worse than untidy. They are not a
// questionnaire — they are the gate on whether somebody may run self-guided
// EMDR processing at all, with no human on call. A hard stop here is the
// product declining to let a person do something that could hurt them, and the
// wording, the mapping and the cooldown were all taken from a compliance
// packet's standard exclusion list rather than ratified by an EMDR-trained
// clinician.
//
// RUNNING THEM UNAPPROVED IS THE RIGHT CALL and the guards below do not
// second-guess it: a screener that refused to run until somebody signed would
// open self-guided processing to everybody in the meantime, which is plainly
// worse. What was missing is that nobody could SEE they were provisional.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  FITNESS_ITEMS, FITNESS_SCREENER_APPROVAL, FITNESS_SCREENER_VERSION,
  screenerApproved, screenerCaveat,
} from "../src/lib/fitness-screener";
import { screenerInfo } from "../src/lib/mobile/onboarding";

const ROOT = path.join(__dirname, "..");
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

// ---------------------------------------------------------------------------
// The state is data, not a suffix
// ---------------------------------------------------------------------------

test("approval is a record with a named owner, null until somebody signs", () => {
  // The same shape the clinical policy already uses for exactly this question,
  // rather than a second convention for the same idea.
  assert.equal(FITNESS_SCREENER_APPROVAL.approvedBy, null,
    "the screener claims an approver; if one exists, name them and the date");
  assert.equal(FITNESS_SCREENER_APPROVAL.approvedAt, null);
  assert.equal(screenerApproved(), false);

  // And the ask is a list, so a reviewer is signing something specific rather
  // than agreeing in principle.
  assert.ok(FITNESS_SCREENER_APPROVAL.covers.length >= 3,
    "the approval does not say what would be signed off");
  const covers = FITNESS_SCREENER_APPROVAL.covers.join(" ");
  for (const thing of ["wording", "hard stop", "cooldown"]) {
    assert.match(covers, new RegExp(thing, "i"), `the approval does not cover the ${thing}`);
  }
});

test("approving it is a real transition, not a constant nobody can move", () => {
  // A predicate that ignored its argument would make the whole record
  // decorative — and would keep reporting "provisional" after a clinician
  // signed, which teaches a reader to ignore the banner.
  const signed = {
    approvedBy: "Dr Somebody, EMDR-trained",
    approvedAt: "2026-10-01",
    covers: FITNESS_SCREENER_APPROVAL.covers,
  };
  assert.equal(screenerApproved(signed), true, "a signed approval still reads as unapproved");
  assert.equal(screenerCaveat(signed), null, "a signed screener still prints a caveat");

  // Half a signature is not a signature.
  for (const half of [
    { ...signed, approvedBy: null },
    { ...signed, approvedAt: null },
  ]) {
    assert.equal(screenerApproved(half), false, "a half-signed approval passed");
  }
});

test("the caveat says what these questions decide, not that a version is a draft", () => {
  const caveat = screenerCaveat();
  assert.ok(caveat, "an unapproved screener prints no caveat");
  // The stakes, in the reader's terms. "Placeholder version" tells somebody
  // nothing about what is at risk.
  assert.match(caveat!, /self-guided processing/i, "the caveat never says what the gate decides");
  assert.match(caveat!, /PROVISIONAL/, "the caveat does not lead with its status");
  // And it says why it is running anyway, so the state reads as a considered
  // position rather than an oversight somebody should fix by disabling it.
  assert.match(caveat!, /withholding the gate would be worse/i,
    "the caveat does not explain why the gate runs unapproved");
});

// ---------------------------------------------------------------------------
// It travels with the version
// ---------------------------------------------------------------------------

test("the mobile client is told in words, not by a naming convention", () => {
  // A caller reading `version: "fit-v1-placeholder"` out of JSON has to already
  // know this codebase's convention to know it is being warned.
  const info = screenerInfo() as Record<string, unknown>;
  assert.equal(info.version, FITNESS_SCREENER_VERSION);
  assert.equal(info.approved, false, "the API reports the screener as approved");
  assert.ok(
    typeof info.provisional === "string" && (info.provisional as string).length > 80,
    "the API serves the version with no caveat beside it"
  );
  assert.equal((info.items as unknown[]).length, FITNESS_ITEMS.length);
});

test("a reviewer reading the safety console is told the screener is provisional", () => {
  // The ten scenarios replayed on that page exercise the daily check-in gate
  // chain. The screener runs BEFORE any of it and is not among them, so a page
  // of green scenarios was the whole of what a reviewer saw.
  const page = code("src/app/review/safety/page.tsx");
  assert.match(page, /screenerCaveat\(\)/, "the safety console never asks about the screener");
  assert.match(page, /screenerProvisional &&/, "the console prints the caveat unconditionally");
  assert.match(page, /FITNESS_SCREENER_VERSION/, "the console never names the version");
  // Conditional, so the banner disappears when somebody signs rather than
  // becoming a stale warning people learn to scroll past.
  assert.doesNotMatch(page, /"PROVISIONAL/, "the console hard-codes the caveat text");
});

// ---------------------------------------------------------------------------
// The gate still runs
// ---------------------------------------------------------------------------

test("being unapproved does not disable the screener", () => {
  // The one thing that would be worse than a provisional gate: no gate. A
  // future change that made the items conditional on approval would open
  // self-guided processing to everybody the moment somebody read this file and
  // decided to be careful.
  assert.ok(FITNESS_ITEMS.length > 0, "the screener has no items");
  assert.ok(
    FITNESS_ITEMS.some((i) => i.onYes === "hard_stop"),
    "no answer is a hard stop, so the screener excludes nobody"
  );
  const src = code("src/lib/fitness-screener.ts");
  assert.doesNotMatch(
    src, /screenerApproved\(\)\s*[?&|]/,
    "the screener's behaviour branches on its own approval state"
  );
});
