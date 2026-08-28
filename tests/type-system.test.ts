// The type system (Presentation Layer Handoff §7, revised by GUI and
// Decision-Surface Handoff §12.3).
//
// THIS FILE RECORDS A REVERSAL. Read both halves before relaxing either.
//
// Handoff 04 §7 collapsed Steady to one family and retired Cormorant Garamond,
// for a reason that still holds:
//
//   Vol 1 requires legibility under fatigue and cognitive load. Cormorant is a
//   Garamond revival — small x-height, high stroke contrast, drawn for display.
//   Those are exactly the properties that fail a tired reader, and the tired
//   reader is this product's design centre rather than an edge case.
//
// Handoff 05 §12.3 asks for a serif back: "serif display type for page
// identity, human explanation, and member-facing completion moments…
// sans-serif for controls, tables, labels, measures, and dense clinical work."
//
// Worth knowing when weighing the two: handoff 05 reviewed this repository at
// commit c39447a, which is the commit BEFORE the one-family change landed. It
// was describing the serif it saw, not overturning a decision it had read.
//
// Resolved by the product owner in favour of §12.3, on the ground that the
// original objection was to Cormorant's DRAWING rather than to serifs as such.
// So the reversal is bounded, and this file holds the bounds:
//
//   1. Exactly two families. A third is still the old failure.
//   2. The serif must be text-grade, not a display revival. Literata was drawn
//      for long-form screen reading — large x-height, low stroke contrast, the
//      inverse of what got Cormorant retired. The named-revival ban below is
//      what stops the reversal being read as "serifs are fine now".
//   3. The serif is confined to .type-identity. Dense clinical work keeps
//      .type-display, which stays one family differentiated by scale and
//      tracking, so the serif cannot spread into tables by habit.
//
// TO REVERT: point --font-serif back at var(--font-sans), drop .type-identity
// and the Literata import from layout.tsx, and restore the "exactly one family"
// assertion below. Nothing else depends on the split.

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

test("exactly two type families are loaded — the sans and the identity serif", () => {
  // next/font imports are the only way a family enters the app.
  const families = [...LAYOUT.matchAll(/import\s*\{([^}]+)\}\s*from\s*"next\/font\/google"/g)]
    .flatMap((m) => m[1].split(",").map((s) => s.trim()))
    .filter(Boolean)
    .sort();
  assert.deepEqual(
    families, ["Inter", "Literata"],
    `expected the sans and the identity serif, found: ${families.join(", ")}. §12.3 asks ` +
    "for two optical roles, not an open set — a third family is the two-voice problem again."
  );
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

test("the serif token resolves to the loaded family, with a real fallback", () => {
  const m = /--font-serif:\s*([^;]+);/.exec(CSS);
  assert.ok(m, "--font-serif is not defined");
  assert.match(m![1], /var\(--font-literata\)/,
    "--font-serif does not point at the loaded identity family");
  assert.match(m![1], /serif\s*;?\s*$/,
    "the serif stack has no generic fallback — a failed webfont would land on the sans");
});

test("the serif is confined to the identity role", () => {
  // The bound that keeps the reversal from spreading. .type-display carries 200+
  // usages across member, clinical and public surfaces; if it took the serif,
  // §12.3's "sans-serif for controls, tables, labels, measures, and dense
  // clinical work" would be broken everywhere at once.
  const disp = /\.type-display\s*\{([^}]+)\}/.exec(CSS);
  assert.ok(disp, "no .type-display role is defined");
  assert.match(disp![1], /font-family:\s*var\(--font-sans\)/,
    ".type-display took the serif — that puts it on clinical tables, which §12.3 excludes");

  const ident = /\.type-identity\s*\{([^}]+)\}/.exec(CSS);
  assert.ok(ident, "no .type-identity role is defined — §12.3's serif role has no home");
  assert.match(ident![1], /font-family:\s*var\(--font-serif\)/,
    ".type-identity does not use the serif");
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

test("the display role is carried by scale and tracking, not by a second family", () => {
  const block = /\.type-display\s*\{([^}]+)\}/.exec(CSS);
  assert.ok(block, "no .type-display role is defined");
  const body = block![1];
  assert.match(body, /font-family:\s*var\(--font-sans\)/,
    "the display role uses a different family, which is the thing §7 removes");
  assert.match(body, /letter-spacing:\s*-/,
    "the display role has no negative tracking — Inter reads loose and accidental at " +
    "display sizes, and tracking is what makes one family read as two deliberate voices");
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
