// The type system (Presentation Layer Handoff §7).
//
// Steady ran Inter for body and Cormorant Garamond for headings — the
// conventional display-serif/body-sans pairing. It was retired, and this
// records why in a form that fails if it creeps back:
//
//   Vol 1 requires legibility under fatigue and cognitive load. Cormorant is a
//   Garamond revival — small x-height, high stroke contrast, drawn for display.
//   Those are exactly the properties that fail a tired reader, and the tired
//   reader is this product's design centre rather than an edge case.
//
// §7's replacement is one humanist sans differentiated by SCALE AND TRACKING
// rather than by contrast, "so it reads as one calm voice and avoids the
// two-voice tension."
//
// The reason this is a test and not a note in a design doc: a second family is
// the single easiest thing to reintroduce. It arrives as one heading on one new
// page, looks fine in isolation, and the system is back to two voices before
// anyone reviews it as a decision.

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

test("exactly one type family is loaded", () => {
  // next/font imports are the only way a family enters the app.
  const families = [...LAYOUT.matchAll(/import\s*\{([^}]+)\}\s*from\s*"next\/font\/google"/g)]
    .flatMap((m) => m[1].split(",").map((s) => s.trim()))
    .filter(Boolean);
  assert.deepEqual(
    families, ["Inter"],
    `expected one family, found: ${families.join(", ")}. §7 asks for a single humanist ` +
    "sans differentiated by scale and tracking, not a second voice."
  );
  assert.doesNotMatch(LAYOUT, /Cormorant/, "the display serif is back in the layout");
});

test("the serif token resolves to the sans stack rather than a second face", () => {
  // Kept as an alias rather than deleted, so a missed surface degrades to the
  // right family instead of silently falling back to Georgia.
  const m = /--font-serif:\s*([^;]+);/.exec(CSS);
  assert.ok(m, "--font-serif is not defined");
  assert.match(
    m![1].trim(), /var\(--font-sans\)/,
    "--font-serif points at a real serif again — that is the two-voice system returning"
  );
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
    // The Tailwind utility, too — it now aliases the sans stack, so using it
    // says something the code does not mean.
    if (/\bfont-serif\b/.test(stripped)) {
      offenders.push(`${path.relative(process.cwd(), f)} (font-serif utility)`);
    }
  }
  assert.deepEqual(offenders, [],
    "a second type family is being reintroduced:\n  " + offenders.join("\n  ") +
    "\nUse .type-display for the display role — same family, larger and tighter.");
});
