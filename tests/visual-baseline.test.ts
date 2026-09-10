process.env.EMDR_DATA_DIR = `/tmp/steady-visualbase-${process.pid}-${Date.now()}`;

// The structural visual baseline (Package 7's missing piece).
//
// Package 7 covered accessibility, touch targets and narrow viewports
// behaviourally. What it never had was a regression baseline — something that
// notices a screen quietly losing a section between one change and the next.
//
// IT IS NOT A SCREENSHOT COMPARISON, and that is a decision rather than a
// shortcut. This repository's CI installs its own Chromium on ubuntu-latest
// while the container the baseline was captured in pins a different build, and
// one Chromium version plus a font renderer is enough to fail every pixel
// comparison. A baseline that only matches on the machine that made it is a red
// suite everybody learns to ignore, which is the failure this codebase keeps
// naming in other places.
//
// So the guards below are about the comparison being honest in both directions:
// it must notice what it claims to notice, and it must say plainly what it
// cannot. A baseline that overclaims is how a regression gets through.
//
// The comparison itself runs in tests/e2e/visual-baseline.spec.ts, because it
// needs a rendered page. These are the properties of the comparator and of the
// committed artefact.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  driftBetween, NOT_CAUGHT, type VisualBaseline, type ScreenBaseline,
} from "../src/lib/experience/visual-baseline";
import { VISUAL_BASELINE } from "../src/lib/experience/visual-baseline.generated";

const ROOT = path.join(__dirname, "..");
const read = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
/** The file including its prose. Used only where the PROSE is the thing under
 *  test — a rationale lives in comments by design, and a stripped read would
 *  assert it away. */
const raw = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const screen = (over: Partial<ScreenBaseline> = {}): ScreenBaseline => ({
  route: "/clinician/today",
  role: "clinician",
  headings: [{ level: 1, text: "Your attention queue" }, { level: 2, text: "Coverage" }],
  landmarks: ["main:", "nav:Steady Clinical navigation"],
  palette: { background: ["rgb(255, 255, 255)"], text: ["rgb(0, 0, 0)"] },
  rhythm: ["8px", "16px"],
  ...over,
});

const baseline = (screens: ScreenBaseline[]): VisualBaseline => ({
  capturedAt: "2026-09-10T00:00:00Z",
  conditions: "test",
  screens,
});

// ---------------------------------------------------------------------------
// The comparison notices what it claims to
// ---------------------------------------------------------------------------

test("a section that disappears is reported", () => {
  // The regression this exists for. A panel that stops rendering looks like
  // nothing at all in a diff of the code that removed one condition.
  const before = baseline([screen()]);
  const after = baseline([screen({ headings: [{ level: 1, text: "Your attention queue" }] })]);
  const drift = driftBetween(before, after);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].what, "headings");
  assert.deepEqual(drift[0].removed, ["h2: Coverage"]);
});

test("a heading that is demoted is reported, not treated as the same heading", () => {
  // A section that becomes a subsection reads differently to a screen reader
  // and to anybody skimming, and the text is unchanged — so a comparison on
  // text alone would miss it.
  const drift = driftBetween(
    baseline([screen()]),
    baseline([screen({ headings: [{ level: 1, text: "Your attention queue" }, { level: 3, text: "Coverage" }] })])
  );
  assert.equal(drift.length, 1);
  assert.deepEqual(drift[0].removed, ["h2: Coverage"]);
  assert.deepEqual(drift[0].added, ["h3: Coverage"]);
});

test("a colour that was never declared is reported", () => {
  // A raw hex creeping past the token system changes the painted palette. A
  // font renderer does not.
  const drift = driftBetween(
    baseline([screen()]),
    baseline([screen({ palette: { background: ["rgb(255, 255, 255)", "rgb(255, 0, 0)"], text: ["rgb(0, 0, 0)"] } })])
  );
  assert.equal(drift.length, 1);
  assert.equal(drift[0].what, "background colours");
  assert.deepEqual(drift[0].added, ["rgb(255, 0, 0)"]);
});

test("a landmark that vanishes is reported", () => {
  const drift = driftBetween(
    baseline([screen()]),
    baseline([screen({ landmarks: ["main:"] })])
  );
  assert.equal(drift[0].what, "landmarks");
  assert.deepEqual(drift[0].removed, ["nav:Steady Clinical navigation"]);
});

test("a screen that disappears entirely is reported, and so is one with no baseline", () => {
  const gone = driftBetween(baseline([screen()]), baseline([]));
  assert.deepEqual(gone, [{ route: "/clinician/today", what: "screen", added: [], removed: ["the whole screen"] }]);
  const fresh = driftBetween(baseline([]), baseline([screen()]));
  assert.equal(fresh[0].added[0], "a screen with no baseline");
});

test("every difference is reported, not the first one", () => {
  // A reviewer looking at a regression wants the shape of it. A comparison that
  // stops at the first mismatch turns one review into five.
  const drift = driftBetween(
    baseline([screen()]),
    baseline([screen({
      headings: [],
      landmarks: [],
      palette: { background: [], text: [] },
      rhythm: [],
    })])
  );
  assert.ok(drift.length >= 5, `only ${drift.length} differences reported from five changes`);
  assert.deepEqual(
    [...new Set(drift.map((d) => d.what))].sort(),
    ["background colours", "headings", "landmarks", "spacing", "text colours"]
  );
});

test("an unchanged screen produces nothing", () => {
  assert.deepEqual(driftBetween(baseline([screen()]), baseline([screen()])), []);
});

// ---------------------------------------------------------------------------
// It says what it cannot catch
// ---------------------------------------------------------------------------

test("the limits are stated, and they are the real ones", () => {
  // A baseline that overclaims is how a regression gets through. These four are
  // genuinely invisible to it, and each is covered somewhere else or by nothing
  // — which is a thing a reader is entitled to know.
  assert.ok(NOT_CAUGHT.length >= 4);
  const joined = NOT_CAUGHT.join(" ").toLowerCase();
  for (const must of ["spacing", "colour", "pixel", "position"]) {
    assert.ok(joined.includes(must), `the limits never mention ${must}`);
  }
  // And a spacing change inside the scale really is invisible, as claimed.
  const same = driftBetween(baseline([screen()]), baseline([screen({ rhythm: ["8px", "16px"] })]));
  assert.deepEqual(same, []);
});

test("the module says why it is not a screenshot comparison", () => {
  // The decision, where somebody deciding to 'upgrade' this to pixels will read
  // it. CI installs a different Chromium from the container that captured this.
  const src = raw("src/lib/experience/visual-baseline.ts");
  assert.match(src, /toHaveScreenshot/, "the alternative is not named");
  assert.match(src, /ubuntu-latest/, "the reason is not stated");
  // And the reason is true: CI really does install its own browser.
  assert.match(
    fs.readFileSync(path.join(ROOT, ".github/workflows/safety.yml"), "utf8"),
    /playwright install/,
    "CI no longer installs its own browser, so the reasoning here is stale"
  );
});

// ---------------------------------------------------------------------------
// The committed artefact
// ---------------------------------------------------------------------------

test("the baseline covers a screen from every role that has one", () => {
  const roles = new Set(VISUAL_BASELINE.screens.map((s) => s.role));
  for (const role of ["member", "clinician", "organization", "reviewer"]) {
    assert.ok(roles.has(role), `no ${role} screen is in the baseline`);
  }
  assert.ok(VISUAL_BASELINE.screens.length >= 8, "too few screens to be a baseline");
});

test("every screen in the baseline actually captured something", () => {
  // An empty capture compares equal to the next empty capture forever, which is
  // a green check over a screen that never rendered.
  for (const s of VISUAL_BASELINE.screens) {
    assert.ok(s.headings.length > 0, `${s.route} captured no headings`);
    assert.ok(s.landmarks.length > 0, `${s.route} captured no landmarks`);
    assert.ok(s.palette.background.length > 0, `${s.route} captured no background colours`);
    assert.ok(s.rhythm.length > 0, `${s.route} captured no spacing`);
  }
});

test("the baseline carries the conditions it was captured under", () => {
  // The first capture was taken against a different seed from the one the check
  // runs against, and reported eight colour differences that were not a
  // regression at all. The conditions are what stops that being rediscovered.
  assert.ok(VISUAL_BASELINE.capturedAt.length >= 20);
  assert.match(VISUAL_BASELINE.conditions, /1280x900/, "the viewport is not recorded");
  assert.match(VISUAL_BASELINE.conditions, /e2e/i, "the seed it was captured against is not recorded");
});

test("no captured value carries a live number", () => {
  // A heading with a count in it drifts on every reseed, and a baseline that
  // drifts for a reason nobody cares about teaches everybody to refresh it
  // rather than read the diff. Digits are normalised at capture.
  for (const s of VISUAL_BASELINE.screens) {
    for (const h of s.headings) {
      assert.ok(!/\d/.test(h.text), `${s.route} baselines a heading with a live number: ${h.text}`);
    }
    for (const l of s.landmarks) {
      const label = l.split(":").slice(1).join(":");
      assert.ok(!/\d/.test(label), `${s.route} baselines a landmark with a live number: ${l}`);
    }
  }
  // AND THE CAPTURE STILL DOES THE NORMALISING. The loop above reads the
  // committed artefact, so it passes forever on a capture that stopped
  // normalising — the next recapture would be the first anybody noticed.
  const capture = read("scripts/capture-visual-baseline.ts");
  const normalisers = capture.match(/\.replace\(\/\\d\+\/g, "#"\)/g) ?? [];
  assert.equal(
    normalisers.length, 2,
    "the capture no longer normalises digits in both headings and landmarks"
  );
});

test("the baseline and its limits reach a screen", () => {
  // A baseline nobody can see is a baseline nobody questions. The testing
  // console lists what can be exercised; this is the only place that answers
  // "would we notice if a screen quietly lost a section" — and what it would
  // not notice, which is the half worth reading.
  const page = read("src/app/review/testing/page.tsx");
  assert.match(page, /VISUAL_BASELINE\.screens\.map\(/, "the baseline is imported but not rendered");
  assert.match(page, /NOT_CAUGHT\.map\(/, "the limits are not on the screen");
  assert.match(page, /\{VISUAL_BASELINE\.conditions\}/, "the conditions are not rendered");
});

test("the capture freezes motion and parks the pointer", () => {
  // BOTH INSTABILITIES THE FIRST REAL RUNS FOUND, and both were the reader
  // catching a screen mid-step rather than the screen changing. A row with
  // `transition-colors` read while the transition is in flight returns the same
  // colour at a part-way alpha; a row under the mouse is in its hover state.
  const capture = read("scripts/capture-visual-baseline.ts");
  assert.match(capture, /transition:none!important/, "transitions are not frozen before reading");
  assert.match(capture, /animation:none!important/);
  assert.match(capture, /mouse\.move\(0, 0\)/, "the pointer is left wherever it was");
});

test("no clock-dependent screen is in the baseline", () => {
  // The caseload came out on the first real run: its alert heading reads
  // "Alerts #" or "Alerts # overdue" according to whether anything has passed
  // its deadline since the seed, and the overdue tone is a colour that appears
  // only when something has. Both are the screen working, and a baseline over
  // them goes red on its own after a few hours.
  const routes = VISUAL_BASELINE.screens.map((s) => s.route);
  assert.ok(
    !routes.includes("/clinician/caseload"),
    "the caseload is baselined again; its headings and palette follow the wall clock"
  );
  // And no baselined heading carries a word that only appears past a deadline.
  for (const s of VISUAL_BASELINE.screens) {
    for (const h of s.headings) {
      assert.ok(
        !/\boverdue\b/i.test(h.text),
        `${s.route} baselines "${h.text}", which depends on how long since the seed`
      );
    }
  }
});

test("the capture reads a screen the same way the check does", () => {
  // Two readers that drift apart report a regression that is only a
  // disagreement, so the end-to-end check imports the capture's own reader
  // rather than reimplementing it.
  const spec = read("tests/e2e/visual-baseline.spec.ts");
  assert.match(spec, /import \{ readScreen/, "the check has its own reader");
  assert.match(spec, /viewport: \{ width: 1280, height: 900 \}/, "the check reads at a different width");
  assert.match(spec, /driftBetween\(/);
  // And it tells whoever it fails how to act on it.
  assert.match(spec, /capture-visual-baseline/, "a failure does not say how to recapture");
});
