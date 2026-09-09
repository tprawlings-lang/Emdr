process.env.EMDR_DATA_DIR = `/tmp/steady-quality-${process.pid}-${Date.now()}`;

// Cross-role quality, as static rules (handoff 09 §8.6, §10's Package 7).
//
// §10 warns that this package is "not a cleanup sprint", and the difference
// shows up in what a guard is allowed to be. A cleanup sprint produces a list
// of screens somebody fixed; these are the rules that hold on the route added
// next month by somebody who never opened the handoff.
//
// WHAT THESE GUARDS CANNOT DO, and why there is an e2e spec beside them. A
// screen reader hears rendered HTML, not source, and the three defects this
// package found were all invisible in source review: no route in the product
// had a skip link, the activity shell had lost its <main> when it dropped its
// navigation, and six definition lists on /review/status were built so that
// axe reported 64 serious violations. Two of those are checkable here. The
// third — a control sitting behind the support dock when it takes focus — is
// only measurable in a browser, and lives in tests/e2e/cross-role-quality.spec.ts.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  MAIN_ID, SKIP_LINK_LABEL, TOUCH_TARGET_GOAL_PX, TOUCH_TARGET_FLOOR_PX,
  targetVerdict, conformant, meetsProductGoal, NARROW_VIEWPORTS_PX,
  ABSENCE_STATES, NEVER_IMPLY, type AbsenceState,
} from "../src/lib/experience/quality";
import { DOCK_RESERVE_PX, NARROW_VIEWPORT_PX } from "../src/lib/experience/activity-shell";

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");

const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

/** Source with comments removed. A guard that reads raw text finds the thing it
 *  forbids in the sentence explaining why it is forbidden — this repository has
 *  made that mistake three times, and each time the fix was this helper. */
const stripComments = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

const TSX = walk(SRC);

// ---------------------------------------------------------------------------
// §8.6 — one main landmark and a skip link, on every route
// ---------------------------------------------------------------------------

test("every main landmark carries the id the skip link targets", () => {
  // The skip link is written once, in the root layout, so it cannot be
  // forgotten on a route. That only works if the anchor it points at exists on
  // every page — a shell with its own id is a page that silently stops being
  // skippable, and nothing on screen changes when it does.
  const missing: string[] = [];
  for (const p of TSX) {
    const src = stripComments(fs.readFileSync(p, "utf8"));
    for (const m of src.matchAll(/<main\b([^>]*)>/g)) {
      if (!/id=\{MAIN_ID\}/.test(m[1])) missing.push(`${path.relative(ROOT, p)}: <main${m[1]}>`);
    }
  }
  assert.deepEqual(missing, [], `these <main> landmarks cannot be skipped into:\n  ${missing.join("\n  ")}`);
});

test("the skip link is in the root layout, ahead of the banner it exists to skip", () => {
  // A skip link placed after the demo banner and the review strip skips
  // neither, which is the version of this control that passes an audit and
  // helps nobody.
  const layout = read("app/layout.tsx");
  const skip = layout.indexOf("<SkipLink />");
  assert.ok(skip > 0, "the root layout does not render the skip link");
  const banner = layout.indexOf("DEMO — FABRICATED DATA");
  assert.ok(banner > 0, "the demo banner moved; this guard is checking the wrong thing");
  assert.ok(skip < banner, "the skip link comes after the banner, so it skips nothing");

  // Stripped, because this component's own comment explains why it carries
  // `focus:not-sr-only` — and a guard that reads the explanation instead of the
  // class passes on a component that has lost the class.
  const link = stripComments(read("components/experience/SkipLink.tsx"));
  assert.match(link, /href=\{`#\$\{MAIN_ID\}`\}/, "the skip link does not target MAIN_ID");
  assert.match(link, /focus:not-sr-only/, "the skip link never becomes visible when focused");
});

test("the skip link says the words a screen-reader user is listening for", () => {
  assert.equal(SKIP_LINK_LABEL, "Skip to main content");
});

// ---------------------------------------------------------------------------
// §8.6 — structure a screen reader can use
// ---------------------------------------------------------------------------

test("no definition list puts content where a term or a description belongs", () => {
  // FOUND BY MEASUREMENT, not by reading: axe reported 6 definition-list and 64
  // dlitem violations on /review/status, all serious. The shape was a <div>
  // wrapper holding <dt>/<dd> and then a couple of <p> siblings — which reads
  // fine and is not a definition list. A screen reader announcing that list
  // gets the term, the value, and then loose text belonging to nothing.
  //
  // The fix was to make the explanation a second <dd>, because that is what it
  // is: a term may have more than one description.
  const offenders: string[] = [];
  for (const p of TSX) {
    const src = stripComments(fs.readFileSync(p, "utf8"));
    let from = 0;
    for (;;) {
      const open = src.indexOf("<dl", from);
      if (open < 0) break;
      const close = src.indexOf("</dl>", open);
      if (close < 0) break;
      const block = src.slice(open, close);
      from = close + 5;

      // Remove the terms and descriptions; whatever is left is a direct child
      // of the list (or of a wrapper div), and only div/dt/dd may be there.
      const rest = block
        .replace(/<dt\b[\s\S]*?<\/dt>/g, "")
        .replace(/<dd\b[\s\S]*?<\/dd>/g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
      for (const m of rest.matchAll(/<([a-z][a-z0-9]*)\b/g)) {
        if (["div", "dl"].includes(m[1])) continue;
        const line = src.slice(0, open).split("\n").length;
        offenders.push(`${path.relative(ROOT, p)}:${line} — <${m[1]}> inside <dl> is neither a term nor a description`);
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

// ---------------------------------------------------------------------------
// §8.6 — a fixed element may not obscure a focused control
// ---------------------------------------------------------------------------

test("the dock's focus rule is expressed once, on the scrollport", () => {
  // §1.6: "No fixed element may obscure a focused control at 320 CSS px."
  // §8.6 repeats it for any zoom level and narrow width.
  //
  // Package 3 reserved space at the END of the document, which is a different
  // claim and was measured to be insufficient: four controls at 320px still
  // took focus behind the dock. The rule that fixes it insets the SCROLLPORT,
  // so the strip behind the dock counts as out of view when the browser
  // decides both whether to scroll and where to stop.
  const css = fs.readFileSync(path.join(SRC, "app", "globals.css"), "utf8");
  assert.match(
    css,
    /html:has\(\[data-support-dock\]\)\s*\{[^}]*scroll-padding-bottom/,
    "nothing keeps a focused control out from under the support dock"
  );
  // Same number as the reserve, in both languages.
  assert.match(css, new RegExp(`padding-bottom:\\s*${DOCK_RESERVE_PX}px`));
  assert.match(css, new RegExp(`scroll-padding-bottom:\\s*calc\\(${DOCK_RESERVE_PX}px`));
});

test("the narrow viewport the rules are checked at is the one the handoff names", () => {
  // 320 px is §8.6's own number and Package 3's NARROW_VIEWPORT_PX. 640 is the
  // same layout problem as 200% zoom in a 1280px window, which is how a
  // headless browser can check a zoom requirement honestly.
  assert.equal(NARROW_VIEWPORTS_PX[0], 320);
  assert.equal(NARROW_VIEWPORTS_PX[0], NARROW_VIEWPORT_PX);
  assert.equal(NARROW_VIEWPORTS_PX[1], 640);
});

// ---------------------------------------------------------------------------
// §1.10 / §8.6 — two target numbers, reported separately
// ---------------------------------------------------------------------------

test("the product goal and the conformance floor stay two different numbers", () => {
  // §1.10's ruling is the whole point: Handoff 08 and Astra disagreed, and the
  // resolution was to keep 44 as the goal and cite WCAG 2.2 SC 2.5.8's 24 × 24
  // as the floor — "do not conflate the two". Collapsing them to one number is
  // the mistake the ruling exists to prevent, in either direction.
  assert.equal(TOUCH_TARGET_GOAL_PX, 44);
  assert.equal(TOUCH_TARGET_FLOOR_PX, 24);
  assert.ok(TOUCH_TARGET_GOAL_PX > TOUCH_TARGET_FLOOR_PX);

  assert.equal(targetVerdict(44), "meets_goal");
  assert.equal(targetVerdict(43), "meets_floor");
  assert.equal(targetVerdict(24), "meets_floor");
  assert.equal(targetVerdict(23), "below_floor");
});

test("a screen can conform without meeting the product goal, and the report says which", () => {
  // §8.6: "Report them separately." A single boolean would either fail screens
  // that conform or let a 24px control be reported as meeting the goal.
  const onlyFloor = { meetsGoal: 3, meetsFloor: 2, belowFloor: 0 };
  assert.equal(conformant(onlyFloor), true);
  assert.equal(meetsProductGoal(onlyFloor), false);

  const clean = { meetsGoal: 5, meetsFloor: 0, belowFloor: 0 };
  assert.equal(conformant(clean), true);
  assert.equal(meetsProductGoal(clean), true);

  const failing = { meetsGoal: 5, meetsFloor: 0, belowFloor: 1 };
  assert.equal(conformant(failing), false);
  assert.equal(meetsProductGoal(failing), false);
});

// ---------------------------------------------------------------------------
// §8.4 — honest absence, the same words in every role
// ---------------------------------------------------------------------------

test("every absence state says what it must never imply", () => {
  // §8.4's last column is the one that turns a copy question into a checkable
  // rule: "empty" must never read as healthy, "withheld" must never read as
  // nothing exists. A state with no such sentence is a state nobody can be held
  // to.
  assert.equal(ABSENCE_STATES.length, 10);
  for (const s of ABSENCE_STATES) {
    const never = NEVER_IMPLY[s as AbsenceState];
    assert.ok(never && never.trim().length > 0, `${s} does not say what it must never imply`);
  }
  assert.equal(Object.keys(NEVER_IMPLY).length, ABSENCE_STATES.length);
});

// ---------------------------------------------------------------------------
// The module stays usable everywhere it is needed
// ---------------------------------------------------------------------------

test("the quality rules import nothing, so any component may hold itself to them", () => {
  // A client component that imports this must not pull a database driver into
  // the browser bundle — the mistake this repository has made three times, each
  // time caught by a guard like this one rather than by review.
  const src = read("lib/experience/quality.ts");
  const imports = [...src.matchAll(/^import\s/gm)];
  assert.equal(imports.length, 0, "the quality rules took a dependency");
});

test("MAIN_ID is a single shared value, not a string repeated in shells", () => {
  // The failure this prevents: two shells with two ids, one skip link, and a
  // whole role's routes that quietly stop being skippable.
  assert.equal(MAIN_ID, "main-content");
  const literal = TSX.filter((p) => /id="main-content"/.test(fs.readFileSync(p, "utf8")));
  assert.deepEqual(literal, [], "a shell hardcodes the anchor instead of importing MAIN_ID");
});
