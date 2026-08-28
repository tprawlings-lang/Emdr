// Visual bilateral stimulation (ledger A7, reversed 2026-08-28).
//
// The finding that led here: the safety config said visual BLS was disabled,
// the rule catalog said "visual BLS stays disabled", a passing test asserted
// the capability was false — and the session offered the moving dot as the
// DEFAULT modality, with a speed picker, to every member without a seizure
// flag. Verified in the running app, not inferred.
//
// The product owner's decision was that the product was right and the config
// wrong, so the flag flipped. That makes these tests more important rather than
// less: the reason the contradiction survived was that nothing connected the
// config to the screen, and a flag nobody reads is a flag that can say anything.
//
// Three things are held here.
//
//   1. The config is load-bearing IN BOTH DIRECTIONS. Flipping it back to false
//      must actually remove the dot. That was the underlying defect.
//   2. Photosensitivity removes the modality rather than defaulting away from
//      it. The screen used to tell a member who answered yes to the seizure
//      question that audio-only was "your default… you can change it", with the
//      control to change it one tap away.
//   3. WCAG 2.3.2's ceiling is enforced in code. It existed as a number in
//      config and a sentence in the catalog and was applied nowhere, which is
//      precisely the a11y validation ledger A7 was waiting on.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { BLS, BETA_CONFIG } from "../src/lib/safety/config";

const PLAYER = fs.readFileSync(path.join(process.cwd(), "src/components/SessionPlayer.tsx"), "utf8");
const ROUTE = fs.readFileSync(path.join(process.cwd(), "src/app/app/session/[moduleId]/page.tsx"), "utf8");
const prose = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

test("the session reads the capability instead of assuming it", () => {
  // The defect in one line. The old default was
  // `audioOnlyDefault ? "audio" : "visual"`, which made visual the fallback for
  // everything the seizure flag did not catch — including a config that had
  // disabled it outright.
  const src = prose(PLAYER);
  assert.match(src, /visualAllowed \? "visual" : "audio"/,
    "the modality default does not derive from the server-supplied capability");
  assert.doesNotMatch(src, /audioOnlyDefault \? "audio" : "visual"/,
    "the old default is back: visual as the fallback for anything not explicitly excluded");
});

test("the capability is computed from the config AND the member's own answer", () => {
  const src = prose(ROUTE);
  assert.match(src, /BETA_CONFIG\.visualStimulationEnabled/,
    "the session route does not consult the safety config");
  assert.match(src, /visualStimulationEnabled\s*&&\s*!audioOnlyDefault/,
    "the two conditions are not both required — either alone must be able to remove the dot");
});

test("photosensitivity removes the modality rather than defaulting away from it", () => {
  const src = prose(PLAYER);
  // The choice must be inside a visualAllowed branch, so it is absent rather
  // than merely unselected. Anchored on the BLS legend specifically — the file
  // has an unrelated fieldset earlier, in the trigger-entry step.
  const guard = src.indexOf("visualAllowed ? (");
  assert.ok(guard > -1, "the modality radio group is not behind the capability");
  // Searched from the guard forward: the phrase also appears earlier in the
  // file, and indexOf from zero finds the wrong one.
  const legend = src.indexOf("Bilateral stimulation", guard);
  assert.ok(legend > -1, "the bilateral-stimulation section is gone");
  assert.ok(legend - guard < 400,
    "the radio group renders outside the capability check");
  assert.doesNotMatch(src, /You can change it/,
    "a member excluded for photosensitivity is being told they can switch it back on");
});

test("no control is offered for a modality that is not on screen", () => {
  const src = prose(PLAYER);
  const speed = src.indexOf("Dot speed");
  assert.ok(speed > -1, "the speed control is gone entirely");
  const before = src.slice(0, speed);
  assert.match(before.slice(-400), /blsMode === "visual" && \(/,
    "the dot-speed control renders in audio-only mode, for a dot that is not there");
});

test("the WCAG 2.3.2 traverse ceiling is enforced in code, not just declared", () => {
  const src = prose(PLAYER);
  assert.match(src, /BLS\.maxFlashesPerSecond/,
    "the renderer does not reference the flash ceiling; it is a number nothing applies");
  assert.match(src, /Math\.max\(requestedMs, MIN_CYCLE_MS\)/,
    "the requested speed is not clamped, so a call site can exceed the ceiling");

  // The ceiling derived the same way the renderer derives it: two midline
  // traverses per cosine cycle.
  const minCycleMs = 2000 / BLS.maxFlashesPerSecond;
  for (const offered of [3200, 2400, 1700]) {
    const traversesPerSec = 2000 / Math.max(offered, minCycleMs);
    assert.ok(traversesPerSec <= BLS.maxFlashesPerSecond + 1e-9,
      `the ${offered}ms option yields ${traversesPerSec.toFixed(2)} traverses/sec, above the ${BLS.maxFlashesPerSecond}/sec ceiling`);
  }
  // And a caller asking for something absurd is clamped rather than obeyed.
  assert.ok(2000 / Math.max(100, minCycleMs) <= BLS.maxFlashesPerSecond + 1e-9);
});

test("the reversal is recorded where the flag lives", () => {
  // A flag flipped with no trace is indistinguishable from drift, and this one
  // reverses a named ledger decision.
  const cfg = fs.readFileSync(path.join(process.cwd(), "src/lib/safety/config.ts"), "utf8");
  const block = /visualStimulationEnabled[\s\S]{0,80}/.exec(cfg);
  assert.ok(block);
  assert.equal(BETA_CONFIG.visualStimulationEnabled, true);
  const preceding = cfg.slice(Math.max(0, cfg.indexOf("visualStimulationEnabled") - 1400), cfg.indexOf("visualStimulationEnabled"));
  assert.match(preceding, /A7/, "the flag does not name the ledger decision it reverses");
  assert.match(preceding, /device validation|DEVICE validation/i,
    "the flag does not record that device validation is still outstanding");
});

test("trauma-memory desensitization is still off", () => {
  // The reversal was about a MODALITY. It did not enable autonomous
  // stimulation, and the two are easy to conflate.
  assert.equal(BETA_CONFIG.autonomousStimulationEnabled, false,
    "enabling visual BLS must not have enabled autonomous reprocessing");
});
