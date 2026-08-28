// Color contrast (GUI and Decision-Surface Handoff §3.9, §12.2, §20.1).
//
// §3.9 audited the brand tokens and found several used as text that cannot
// carry it: sageDeep 2.34:1, clay 1.96:1, safeDeep 3.20:1, mistDeep 4.18:1 —
// all against ivory, all short of WCAG AA's 4.5:1 for normal text. The worst
// of them, sage-deep, was rendering the breathing prompt and a grounding link
// inside the SOS panel, which is the surface where a member is least able to
// work at reading something.
//
// The fix is two-part and this test holds both halves: a semantic palette that
// is verified rather than asserted, and a rule that the decorative brand tokens
// stay out of text. Ratios are recomputed here from the CSS rather than
// recorded as numbers in a comment, so a token edit re-runs the audit instead
// of invalidating it silently.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const CSS = fs.readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");

function token(name: string): string {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(CSS);
  assert.ok(m, `token --color-${name} is not defined in globals.css`);
  return m![1];
}

/** WCAG 2.x relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const v = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function ratio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const AA_TEXT = 4.5;
const SURFACES = { ivory: token("ivory"), linen: token("linen") };

const STATES = ["safe", "info", "caution", "support", "review", "unknown"] as const;

test("every semantic state token passes AA on its own background", () => {
  const fails: string[] = [];
  for (const s of STATES) {
    const r = ratio(token(`state-${s}`), token(`state-${s}-bg`));
    if (r < AA_TEXT) fails.push(`state-${s}: ${r.toFixed(2)}:1 on its own background`);
  }
  assert.deepEqual(fails, [], "semantic state text fails AA:\n  " + fails.join("\n  "));
});

test("every semantic state token also passes AA on ivory and linen", () => {
  // A state chip does not always sit on its own tint — it appears bare on the
  // canvas and inside cards, and it has to survive both.
  const fails: string[] = [];
  for (const s of STATES) {
    for (const [name, bg] of Object.entries(SURFACES)) {
      const r = ratio(token(`state-${s}`), bg);
      if (r < AA_TEXT) fails.push(`state-${s} on ${name}: ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(fails, [], "semantic state text fails AA on a base surface:\n  " + fails.join("\n  "));
});

test("body and secondary text pass AA on both base surfaces", () => {
  for (const t of ["ground", "olive"]) {
    for (const [name, bg] of Object.entries(SURFACES)) {
      const r = ratio(token(t), bg);
      assert.ok(r >= AA_TEXT, `${t} on ${name} is ${r.toFixed(2)}:1, below ${AA_TEXT}:1`);
    }
  }
});

test("the tokens §3.9 measured as failing are not used as text", () => {
  // They keep their legitimate jobs — fills, borders, selected backgrounds —
  // but `text-*` is where they break, so that is what is forbidden. Named
  // individually with their measured ratio so the failure explains itself.
  const BANNED: Record<string, string> = {
    "sage-deep": "2.34:1 on ivory",
    "clay": "1.96:1 on ivory",
    "safe-deep": "3.20:1 on ivory",
    "mist-deep": "4.18:1 on ivory",
  };
  const walk = (d: string): string[] => {
    if (!fs.existsSync(d)) return [];
    const out: string[] = [];
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else if (p.endsWith(".tsx")) out.push(p);
    }
    return out;
  };
  const offenders: string[] = [];
  for (const f of walk(path.join(process.cwd(), "src"))) {
    const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
    for (const [tok, measured] of Object.entries(BANNED)) {
      if (new RegExp(`\\btext-${tok}\\b`).test(src)) {
        offenders.push(`${path.relative(process.cwd(), f)} — text-${tok} (${measured})`);
      }
    }
  }
  assert.deepEqual(
    offenders, [],
    "brand tokens are being used as text below AA:\n  " + offenders.join("\n  ") +
    "\nUse a --color-state-* token; those are contrast-verified above."
  );
});

test("the semantic palette is defined once, as tokens, not inline hexes", () => {
  // A one-off hex on a component is how a verified palette stops being one.
  assert.ok(STATES.every((s) => CSS.includes(`--color-state-${s}:`)),
    "a semantic state token is missing from globals.css");
});
