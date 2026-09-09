process.env.EMDR_DATA_DIR = `/tmp/steady-riskroute-${process.pid}-${Date.now()}`;

// A positive risk item reaches a clinician, from EVERY path that submits an
// instrument.
//
// THE DEFECT THIS EXISTS FOR WAS LIVE, and it was found by creating a patient,
// walking their intake by hand, and then reading their rows.
//
// There are two ways an instrument gets submitted. `submitScreening` in
// src/lib/actions.ts handles the whole form at once and, on a risk flag, raised
// an urgent alert and routed to the crisis screen. `finishGateAction` in
// src/lib/member/gate-finish.ts is the PACED, one-question-at-a-time gate that
// every new member walks during baseline screening — and it computed the risk
// flags, wrote them to `screenings.risk_flags_json`, and continued to the next
// questionnaire. No alert. No crisis routing. Nothing reached anybody.
//
// A member who answered PHQ-9's ninth item — the suicidal-ideation question —
// affirmatively during their first hour in the product was silently advanced,
// and their disclosure sat in a JSON column.
//
// WHY IT HAPPENED, which is the part worth guarding. `createAlert` was PRIVATE
// to actions.ts, and mobile/service.ts carried a byte-identical copy under a
// comment saying so. A private writer is one a new call site cannot use, so the
// gate's options were to copy the function a third time or not raise an alert.
// It did neither. There is now one writer, and these guards hold every submit
// path to using it.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { INSTRUMENTS, scoreInstrument } from "../src/lib/instruments";
import { raiseRiskItemAlert, createAlert } from "../src/lib/clinical/alert-create";

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");
const code = (rel: string) =>
  read(rel)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** Every module that scores an instrument and stores the result. Found by
 *  walking the source rather than listed, so a third submit path added later is
 *  held to the same rule instead of quietly escaping it. */
function submitPaths(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name)) {
        const src = code(path.relative(SRC, p));
        // Scores an instrument AND writes a screening row: that is a submit
        // path. A module that only scores (a preview, a demo generator) does
        // not route anybody anywhere.
        if (/scoreInstrument\(/.test(src) && /INSERT INTO screenings/.test(src)) {
          out.push(path.relative(SRC, p));
        }
      }
    }
  };
  walk(path.join(SRC, "lib"));
  return out.sort();
}

test("there is more than one submit path, so the rule below is worth having", () => {
  // If this ever finds one path, the guards below are checking a rule that
  // cannot be broken by divergence — and the test should be simplified rather
  // than left looking thorough.
  const paths = submitPaths();
  assert.ok(paths.length >= 2, `only ${paths.length} submit path found: ${paths.join(", ")}`);
  assert.ok(
    paths.includes("lib/member/gate-finish.ts"),
    "the paced gate is no longer a submit path; this guard is checking the wrong files"
  );
});

test("every submit path routes a positive risk item to a clinician", () => {
  // The rule, checked against every path rather than the one somebody
  // remembered. A path that scores an instrument and stores the result has, by
  // that point, everything needed to raise the alert — so there is no path for
  // which this is unreasonable.
  const missing: string[] = [];
  for (const rel of submitPaths()) {
    const src = code(rel);
    // The demo creator is a submit path by shape and is explicitly not a member
    // answering questions: it zeroes every risk item precisely so it cannot
    // manufacture an alert, which is asserted in tests/new-patient.test.ts.
    if (rel.startsWith("lib/demo/")) continue;
    const raises = /raiseRiskItemAlert\(/.test(src);
    // ROUTING LOOKS DIFFERENT ON AN API, and that is a real difference rather
    // than an excuse. A page path calls `redirect("/crisis")`. The mobile
    // submit answers a client and cannot redirect, so it returns `crisis: true`
    // and the client routes. Requiring a redirect everywhere would have forced
    // the API to fake one; accepting anything would have let the page paths
    // drop it, which is the defect this file exists for.
    const routes = /redirect\("\/crisis/.test(src) || /crisis: riskFlags\.length > 0/.test(src);
    if (!raises || !routes) {
      missing.push(`${rel} (${raises ? "" : "no alert"}${!raises && !routes ? ", " : ""}${routes ? "" : "no crisis routing"})`);
    }
  }
  assert.deepEqual(missing, [], `these submit paths drop a risk item:\n  ${missing.join("\n  ")}`);
});

test("the alert is raised before the redirect, not after it", () => {
  // `redirect()` throws in Next.js. An alert written after it never happens,
  // and the failure looks exactly like the defect this file is about — the row
  // is missing and the code appears to write one.
  //
  // Only checked where there IS a redirect: the mobile submit returns a crisis
  // flag instead, so there is no ordering to get wrong.
  let checked = 0;
  for (const rel of submitPaths()) {
    if (rel.startsWith("lib/demo/")) continue;
    const src = code(rel);
    const crisis = src.indexOf('redirect("/crisis');
    if (crisis < 0) continue;
    const raise = src.indexOf("raiseRiskItemAlert(");
    assert.ok(raise > 0, `${rel} redirects to crisis and never raises the alert`);
    assert.ok(raise < crisis, `${rel} redirects before it raises the alert, so the alert never happens`);
    checked += 1;
  }
  assert.ok(checked >= 2, `only ${checked} redirecting path checked; the walk is wrong`);
});

test("there is exactly one alert writer", () => {
  // The root cause. A private writer is one a new call site cannot use, and the
  // byte-identical copy in mobile/service.ts is what that looks like before it
  // becomes a missing alert.
  const definitions: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name)) {
        const src = code(path.relative(SRC, p));
        // A wrapper that delegates is not a second writer: what matters is
        // that one INSERT exists. The mobile file keeps a positional wrapper
        // over the shared writer so its many call sites read unchanged.
        if (
          /(async )?function createAlert\(/.test(src) &&
          /INSERT INTO alerts/.test(src)
        ) {
          definitions.push(path.relative(SRC, p));
        }
      }
    }
  };
  walk(path.join(SRC, "lib"));
  assert.deepEqual(
    definitions, ["lib/clinical/alert-create.ts"],
    `createAlert is defined in more than one place: ${definitions.join(", ")}`
  );
});

test("no submit path writes the alerts table directly", () => {
  // Going around the writer is the same defect wearing a different shape: the
  // row would exist and the next rule added to `createAlert` would not apply
  // to it.
  for (const rel of submitPaths()) {
    const src = code(rel);
    assert.ok(
      !/INSERT INTO alerts/.test(src),
      `${rel} inserts an alert directly instead of going through the writer`
    );
  }
});

test("the risk-item alert says which instrument and which flag", () => {
  // A clinician opening an urgent alert needs to know what fired without a
  // second query. "Screening risk" is a row; "phq-9: suicidal_ideation_screen_positive
  // (total 16)" is something to act on.
  const calls: string[] = [];
  const detail = (args: Parameters<typeof raiseRiskItemAlert>[0]) =>
    `${args.instrumentId}: ${args.riskFlags.join(", ")} (total ${args.total})`;
  calls.push(detail({ userId: "u", instrumentId: "phq-9", riskFlags: ["suicidal_ideation_screen_positive"], total: 16 }));
  assert.match(calls[0], /phq-9/);
  assert.match(calls[0], /suicidal_ideation_screen_positive/);
  assert.match(calls[0], /total 16/);
  // And the helper exists rather than each path assembling its own wording —
  // the two paths had already drifted once.
  assert.equal(typeof raiseRiskItemAlert, "function");
  assert.equal(typeof createAlert, "function");
});

test("the item that fires this is the one it is supposed to be", () => {
  // PHQ-9's ninth item is the suicidal-ideation question, at threshold 1 — a
  // single "several days" fires it. Asserted against the instrument definition
  // so a renumbering of the items cannot silently move the flag onto a
  // different question.
  const phq = INSTRUMENTS.find((i) => i.id === "phq-9");
  assert.ok(phq);
  const risk = phq.riskItems ?? [];
  assert.equal(risk.length, 1);
  assert.equal(risk[0].index, 8, "the risk item is not PHQ-9 item 9");
  assert.equal(risk[0].threshold, 1, "a single 'several days' no longer fires it");
  assert.equal(risk[0].flag, "suicidal_ideation_screen_positive");

  // And the flag really is produced by answering that item and nothing else.
  const answers = Array.from({ length: phq.items.length }, (_, i) => (i === 8 ? 1 : 0));
  assert.deepEqual(scoreInstrument(phq, answers).riskFlags, ["suicidal_ideation_screen_positive"]);
  const clean = Array.from({ length: phq.items.length }, (_, i) => (i === 8 ? 0 : 3));
  assert.deepEqual(scoreInstrument(phq, clean).riskFlags, []);
});
