// The type system (Presentation Layer Handoff §7, revised by GUI and
// Decision-Surface Handoff §12.3, and revised again by the Expansion Handoff
// §8.3 on 24 September).
//
// THIS FILE RECORDS TWO REVERSALS. Read all three positions before relaxing
// anything.
//
//   1. Handoff 04 §7 collapsed Steady to one family and retired Cormorant
//      Garamond: Vol 1 requires legibility under fatigue and cognitive load, and
//      Cormorant's small x-height and high stroke contrast fail a tired reader.
//
//   2. Handoff 05 §12.3 asked for a serif back for page identity. Resolved in
//      its favour with a text-grade serif (Literata) confined to .type-identity,
//      on the ground that the objection was to Cormorant's drawing rather than
//      to serifs as such. Two families, Inter and Literata.
//
//   3. The Expansion Handoff §8.3, approved by the product owner on 24
//      September: "Atkinson Hyperlegible Next for everything... One family,
//      weights 400 and 700." Drawn by the Braille Institute so confusable
//      letters stay distinct, for "a population that may be reading while
//      dysregulated". This is position 1's goal pursued with a face designed for
//      it, and it retires position 2's serif.
//
// So the bounds are now:
//
//   - EXACTLY ONE FAMILY. A second is the two-voice problem again, whichever
//     handoff asks for it.
//   - EXACTLY TWO WEIGHTS. Emphasis is carried by weight; a third weight is a
//     hierarchy nobody can see at a glance.
//   - THE DISPLAY-REVIVAL BAN STAYS, because it is the part of position 1 that
//     every later position agreed with.
//
// .type-identity is kept as a class so its call sites still read as what they
// are, and --font-serif as an alias so a missed reference cannot fall back to
// Georgia. Both now resolve to the one family.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const CSS = fs.readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
const LAYOUT = fs.readFileSync(path.join(process.cwd(), "src", "app", "layout.tsx"), "utf8");

function srcFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(".tsx") || p.endsWith(".ts")) out.push(p);
    }
  };
  walk(path.join(process.cwd(), "src"));
  return out;
}

test("exactly one type family is loaded — Atkinson Hyperlegible Next", () => {
  // next/font imports are the only way a family enters the app.
  const families = [...LAYOUT.matchAll(/import\s*\{([^}]+)\}\s*from\s*"next\/font\/google"/g)]
    .flatMap((m) => m[1].split(",").map((s) => s.trim()))
    .filter(Boolean)
    .sort();
  assert.deepEqual(
    families, ["Atkinson_Hyperlegible_Next"],
    `expected one family, found: ${families.join(", ")}. §8.3: "One family, weights 400 and ` +
    '700." A second family is the two-voice problem again.'
  );
});

test("exactly two weights are loaded, and every emphasis maps onto them", () => {
  const weights = /weight:\s*\[([^\]]+)\]/.exec(LAYOUT);
  assert.ok(weights, "the font is loaded without naming its weights, so every weight ships");
  const loaded = weights![1].split(",").map((w) => w.replace(/["'\s]/g, "")).sort();
  assert.deepEqual(loaded, ["400", "700"], `§8.3 allows two weights; loaded ${loaded.join(", ")}`);

  // 1,300 existing `font-medium` and `font-semibold` classes ask for 500 and
  // 600. Unmapped, the browser would synthesise them from 400 — a smeared
  // middle weight that §8.3 exists to prevent.
  for (const w of ["medium", "semibold"]) {
    const m = new RegExp(`--font-weight-${w}:\\s*(\\d+)`).exec(CSS);
    assert.ok(m, `--font-weight-${w} is not mapped, so it resolves to a weight that is not loaded`);
    assert.equal(m![1], "700", `font-${w} maps to ${m![1]}, which is not one of the two weights`);
  }
});

test("the identity serif is text-grade, not a display revival", () => {
  // The specific bound on the reversal. These faces share the properties that
  // retired Cormorant: small x-height and high stroke contrast at text sizes.
  // Allowing "a serif" without this reads as permission to use any serif.
  const REVIVALS = /Cormorant|Garamond|Playfair|Bodoni|Didot|Baskerville|Caslon/i;
  assert.doesNotMatch(
    LAYOUT, REVIVALS,
    "a display serif revival is loaded. §12.3 restores a serif for identity, but Vol 1's " +
    "fatigue requirement is what retired Cormorant — small x-height and high stroke " +
    "contrast fail a tired reader whatever the family is called."
  );
});

test("the serif token is an alias of the one family, not a second face", () => {
  // Kept rather than deleted: `.type-identity` names it, and a missing variable
  // would fall back to Georgia on the member completion screens.
  const m = /--font-serif:\s*([^;]+);/.exec(CSS);
  assert.ok(m, "--font-serif is not defined, so anything still naming it falls back to Georgia");
  assert.match(m![1].trim(), /^var\(--font-sans\)$/,
    "--font-serif points somewhere other than the one family");
  const sans = /--font-sans:\s*([^;]+);/.exec(CSS);
  assert.ok(sans && /var\(--font-atkinson\)/.test(sans[1]),
    "--font-sans does not resolve to the loaded family");
  assert.match(sans![1], /sans-serif/, "the stack has no generic fallback for a failed webfont");
});

test("every type role uses the one family", () => {
  for (const role of ["type-display", "type-identity"]) {
    const block = new RegExp(`\\.${role}\\s*\\{([^}]+)\\}`).exec(CSS);
    assert.ok(block, `no .${role} role is defined`);
    assert.match(block![1], /font-family:\s*var\(--font-sans\)/,
      `.${role} uses a different family — §8.3 is one face for everything`);
  }
});

test("body copy meets the 17px floor and the 1.6 line-height minimum", () => {
  // §7: "Minimum body size 17px… Line height generous — 1.6 minimum on body
  // copy." Set on the base step so the floor holds by default rather than by
  // remembering it on each page.
  const size = /--text-base:\s*([\d.]+)rem/.exec(CSS);
  assert.ok(size, "--text-base is not set; the 17px floor is not enforced anywhere");
  const px = parseFloat(size![1]) * 16;
  assert.ok(px >= 17, `base body size is ${px}px, below the 17px floor`);

  const lh = /--text-base--line-height:\s*([\d.]+)/.exec(CSS);
  assert.ok(lh, "--text-base--line-height is not set");
  assert.ok(parseFloat(lh![1]) >= 1.6, `base line-height is ${lh![1]}, below the 1.6 minimum`);
});

test("a measure cap exists for the ~60 character rule", () => {
  // Long measure is a specific failure under cognitive load: the eye loses the
  // line return and re-reads the same line.
  assert.match(CSS, /\.measure\s*\{[^}]*max-width:\s*60ch/,
    "no .measure utility — §7's ~60 character cap has nothing to enforce it");
});

test("the display role is carried by weight and scale, not by a second family", () => {
  // Under Inter this also asserted negative tracking at the base, because Inter
  // reads loose at display sizes. Atkinson is spaced for legibility on purpose,
  // so the base is neutral and tracking is set per size — and that per-size
  // scale is measured in a browser by tests/e2e/interaction-feedback.spec.ts,
  // which is where a rendered value can be checked.
  const block = /\.type-display\s*\{([^}]+)\}/.exec(CSS);
  assert.ok(block, "no .type-display role is defined");
  assert.match(block![1], /font-family:\s*var\(--font-sans\)/,
    "the display role uses a different family");
  assert.match(block![1], /font-weight:\s*700/,
    "the display role is not bold — with two weights, a heading at 400 is a large paragraph");
});

test("prefers-reduced-motion is honoured globally, not per component", () => {
  // §7: "a hard requirement, not a nicety." Visual BLS is already removed
  // globally for photosensitivity and seizure risk, so motion sensitivity is an
  // established first-class concern here rather than a general accessibility
  // gesture. A global rule means a future animation cannot opt out by omission.
  assert.match(CSS, /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
    "no global prefers-reduced-motion rule in globals.css");
  const rule = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(rule, /animation-duration:\s*0\.01ms\s*!important/,
    "the reduced-motion rule does not actually stop animations");
});

test("no surface reintroduces a serif family inline", () => {
  // The other way a second voice arrives: a one-off font-family on a component.
  const offenders: string[] = [];
  for (const f of srcFiles()) {
    const src = fs.readFileSync(f, "utf8");
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    if (/font-family:\s*["']?(?:Georgia|Times|Garamond|Cormorant|serif)/i.test(stripped)) {
      offenders.push(path.relative(process.cwd(), f));
    }
    // The raw utility stays banned even though the token is real again: the
    // serif is allowed in one named role, and `font-serif` sprayed on a
    // component is how a bounded reversal becomes an unbounded one. Use
    // .type-identity, which is what the guard above checks.
    if (/\bfont-serif\b/.test(stripped)) {
      offenders.push(`${path.relative(process.cwd(), f)} (font-serif utility — use .type-identity)`);
    }
  }
  assert.deepEqual(offenders, [],
    "a second type family is being reintroduced:\n  " + offenders.join("\n  ") +
    "\nUse .type-display for the display role — same family, larger and tighter.");
});
