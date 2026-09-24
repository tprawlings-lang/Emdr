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
  // The ratios are RECOMPUTED from the current tokens rather than quoted, so
  // the list stays true when a palette changes under it — which it did on 24
  // September. `sand` joined because §8.2 says "fills only, never text", and
  // `clay` stayed because it now takes sand's value.
  const BANNED: Record<string, string> = Object.fromEntries(
    ["sage-deep", "clay", "sand", "safe-deep", "mist-deep"].map((t) => [
      t, `${ratio(token(t), token("ivory")).toFixed(2)}:1 on the page`,
    ])
  );
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

// ---------------------------------------------------------------------------
// The Expansion Handoff §8.2 palette (approved 24 September)
// ---------------------------------------------------------------------------
//
// §8.2: "designer to confirm; verify WCAG 2.2 AA contrast in CI". This is the
// CI half. Read by §8.2's own names, which globals.css defines as aliases, so
// the test reads the way the handoff does.

test("§8.2's text colours pass AA on both the page and a card", () => {
  const fails: string[] = [];
  for (const fg of ["ink", "ink-muted", "steady", "help"]) {
    for (const bg of ["canvas", "surface"]) {
      const r = ratio(token(fg), token(bg));
      if (r < 4.5) fails.push(`${fg} on ${bg}: ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(fails, [], "a §8.2 text colour is below 4.5:1:\n  " + fails.join("\n  "));
});

test("sand is below AA as text, which is why it is a fill", () => {
  // THE REASON FOR THE RULE, CHECKED. If a later palette change made sand
  // legible as text, the ban above would be protecting nothing and should be
  // reconsidered rather than left standing on a stale measurement.
  assert.ok(ratio(token("sand"), token("canvas")) < 4.5,
    "sand now passes as text — the fills-only rule may no longer be needed");
  // And what DOES sit on a sand fill has to read.
  assert.ok(ratio(token("ink"), token("sand")) >= 4.5,
    "ink on a sand fill is below AA, so the resource-tool cards cannot carry text");
});

test("text on a primary action reads", () => {
  // Every primary button is `bg-app-ink text-app-surface`: steady with the
  // card colour on it.
  const r = ratio(token("app-surface"), token("app-ink"));
  assert.ok(r >= 4.5, `text on a primary button is ${r.toFixed(2)}:1`);
});

test("the focus ring is visible against everything it sits on", () => {
  // WCAG 2.2 SC 2.4.13 asks for 3:1 between a focus indicator and what is next
  // to it. The ring is steady, offset onto the page or a card.
  for (const bg of ["canvas", "surface", "app-rail", "app-accent"]) {
    const r = ratio(token("app-ink"), token(bg));
    assert.ok(r >= 3, `the focus ring on ${bg} is ${r.toFixed(2)}:1, below 3:1`);
  }
});

test("the derived fills carry ink, and the selected fill carries steady", () => {
  // §8.2 stops at seven colours; the product needs a few tints. Each is the
  // card mixed toward steady, and each has to hold the text that sits on it.
  for (const fill of ["sage", "sage-deep", "moss", "app-accent", "app-rail"]) {
    const r = ratio(token("ground"), token(fill));
    assert.ok(r >= 4.5, `ink on ${fill} is ${r.toFixed(2)}:1`);
  }
  // The selected navigation item is `bg-app-accent text-app-ink`.
  const sel = ratio(token("app-ink"), token("app-accent"));
  assert.ok(sel >= 4.5, `the selected navigation item's text is ${sel.toFixed(2)}:1`);
});

test("the ordinary data mark is visible as a graphical object", () => {
  // WCAG 1.4.11: 3:1 for a graphical object against what it is drawn on.
  // Separation from the colours it sits beside is checked with the dataviz
  // validator and recorded beside the token; this holds the half a palette
  // change is most likely to break without anybody noticing.
  for (const bg of ["surface", "canvas"]) {
    const r = ratio(token("chart-neutral"), token(bg));
    assert.ok(r >= 3, `a data mark on ${bg} is ${r.toFixed(2)}:1`);
  }
});

test("muted text never sits on a sand fill, at any opacity", () => {
  // FOUND BY COMPUTING, NOT BY THE SCAN. Three status pills — "Due in 5
  // days", "Canceled", "Closed" — set muted text on sand at 40–60% opacity.
  // Blended, that is 3.69 to 4.39:1 in light mode: below AA since the §8.2
  // palette landed, and missed by the automated scan because none of the three
  // states is on a route it visits. They were neutral states wearing a
  // resource-tool fill, and now use the neutral state pair verified above.
  const offenders: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p2 = path.join(d, e.name);
      if (e.isDirectory()) walk(p2);
      else if (p2.endsWith(".tsx")) {
        for (const cls of fs.readFileSync(p2, "utf8").match(/"[^"]*"|`[^`]*`/g) ?? []) {
          if (/\bbg-(sand|clay)(\/\d+)?\b/.test(cls) && /\btext-olive\b/.test(cls)) {
            offenders.push(`${path.relative(process.cwd(), p2)}: ${cls.slice(0, 80)}`);
          }
        }
      }
    }
  };
  walk(path.join(process.cwd(), "src"));
  assert.deepEqual(offenders, [], "muted text on a sand fill is below AA:\n  " + offenders.join("\n  "));
});

// ---------------------------------------------------------------------------
// Dark mode (§8.2's dark column)
// ---------------------------------------------------------------------------
//
// The dark block redefines tokens inside a media query, so `token()` above —
// which reads the first definition — returns the light value. This reads the
// dark block on its own, and every check below runs against it.

const DARK = (() => {
  const start = CSS.indexOf("@media (prefers-color-scheme: dark)");
  assert.ok(start >= 0, "there is no dark-mode block, so §8.2's dark column is not implemented");
  const body = CSS.slice(start, CSS.indexOf("\n}\n", start));
  return Object.fromEntries(
    [...body.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]])
  ) as Record<string, string>;
})();

function dark(name: string): string {
  const v = DARK[name];
  assert.ok(v, `--color-${name} has no dark value, so it keeps its light colour on a dark page`);
  return v;
}

test("every colour token the light theme defines has a dark value", () => {
  // A token left out keeps its light value — a light fill on a dark page, or
  // dark text on a dark card. The failure dark mode exists not to have.
  const light = [...new Set([...CSS.matchAll(/--color-([a-z0-9-]+):\s*#[0-9a-fA-F]{6}/g)].map((m) => m[1]))];
  const missing = light.filter((t) => !(t in DARK));
  assert.deepEqual(missing, [], `these tokens have no dark value: ${missing.join(", ")}`);
});

test("in dark mode, every pairing the product draws passes AA", () => {
  // The pairs are the ones actually used — text class on fill class — found
  // by searching the components, not a theoretical grid.
  const PAIRS: Array<[string, string]> = [
    ["ground", "ivory"], ["ground", "linen"], ["olive", "ivory"], ["olive", "linen"],
    ["app-ink", "ivory"], ["app-ink", "linen"], ["support", "ivory"], ["support", "linen"],
    ["app-surface", "app-ink"], ["ivory", "ground"],
    ["ground", "sage"], ["ground", "sage-deep"], ["ground", "moss"], ["olive", "moss"],
    ["ground", "app-accent"], ["app-ink", "app-accent"], ["ground", "app-rail"],
    ["ground", "pause"], ["ground", "pause-soft"], ["ground", "safe"], ["ground", "clay"],
    ["app-ink", "app-flag"], ["ivory", "state-support"],
    ...(["support", "caution", "safe", "info", "review", "unknown"] as const).flatMap((h) => [
      [`state-${h}`, `state-${h}-bg`], [`state-${h}`, "ivory"], [`state-${h}`, "linen"], ["ground", `state-${h}-bg`],
    ] as Array<[string, string]>),
  ];
  const fails = PAIRS.map(([f, b]) => [f, b, ratio(dark(f), dark(b))] as const)
    .filter(([, , r]) => r < 4.5)
    .map(([f, b, r]) => `${f} on ${b}: ${r.toFixed(2)}:1`);
  assert.deepEqual(fails, [], "dark-mode pairings below AA:\n  " + fails.join("\n  "));
});

test("in dark mode, the focus ring and the data mark are visible", () => {
  for (const bg of ["canvas", "surface", "app-rail", "app-accent"]) {
    const r = ratio(dark("app-ink"), dark(bg));
    assert.ok(r >= 3, `the dark focus ring on ${bg} is ${r.toFixed(2)}:1`);
  }
  for (const bg of ["canvas", "surface"]) {
    const r = ratio(dark("chart-neutral"), dark(bg));
    assert.ok(r >= 3, `a dark data mark on ${bg} is ${r.toFixed(2)}:1`);
  }
});

test("nothing that inverts with the theme is paired with a colour that does not", () => {
  // THE CRISIS BUTTONS. `bg-ground text-white` is dark-on-light in light mode
  // and white-on-near-white in dark, because ground inverts and white does
  // not. It was the pattern on SOS, the crisis page and Today's crisis link.
  const offenders: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p2 = path.join(d, e.name);
      if (e.isDirectory()) walk(p2);
      else if (p2.endsWith(".tsx")) {
        const src = fs.readFileSync(p2, "utf8");
        if (/\b(bg|text|border)-(white|black)\b/.test(src)) {
          offenders.push(path.relative(process.cwd(), p2));
        }
      }
    }
  };
  walk(path.join(process.cwd(), "src"));
  assert.deepEqual(offenders, [],
    "these files use white or black, which do not change with the theme:\n  " + offenders.join("\n  "));
});

test("the emphasis card reads in both modes, and does not glare in dark", () => {
  for (const [mode, get] of [["light", token], ["dark", dark]] as const) {
    const text = ratio(get("on-emphasis"), get("emphasis"));
    assert.ok(text >= 4.5, `${mode}: text on the emphasis card is ${text.toFixed(2)}:1`);
    const btn = ratio(get("on-emphasis-action"), get("emphasis-action"));
    assert.ok(btn >= 4.5, `${mode}: the Begin button's text is ${btn.toFixed(2)}:1`);
    // WCAG 1.4.11: a control's boundary at 3:1 against what it sits on.
    const edge = ratio(get("emphasis-action"), get("emphasis"));
    assert.ok(edge >= 3, `${mode}: the Begin button stands off its card at ${edge.toFixed(2)}:1`);
  }
  // THE GLARE CHECK, which is the reason the role exists. In dark mode the
  // card must be darker than the text on it — a light slab on a dark page is
  // exactly what the inversion produced.
  const lum = (h: string) => {
    const v = h.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)).reduce((a, b) => a + b, 0);
  };
  assert.ok(lum(dark("emphasis")) < lum(dark("on-emphasis")),
    "in dark mode the emphasis card is lighter than its own text — a bright slab at night");
});
