// One visual system across the product.
//
// The defect this exists to prevent, in the words it was reported in: "why
// don't any of the screens look different on the clinician side."
//
// The cause was that Wave 3 built new screens BESIDE the old ones instead of
// restyling them. Eight clinician surfaces shipped as the pages that existed
// before — /review/audit was byte-identical, the rest changed only their route
// strings — and the semantic palette was used exclusively in the files written
// that week. A clinician moving from Today to Caseload crossed from one design
// language into another, and the older one was most of their screens.
//
// So this holds two rules. The old brand tokens are not used as state on a
// clinical surface, and a concept with a shared component does not get a second
// hand-rolled implementation. Both are the kind of thing that is invisible in a
// diff and obvious on screen.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["src/app/clinician", "src/app/review", "src/app/app", "src/components/clinical", "src/components/member"];

function walk(d: string): string[] {
  if (!fs.existsSync(d)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}
const FILES = ROOTS.flatMap((r) => walk(path.join(process.cwd(), r)));
const rel = (f: string) => path.relative(process.cwd(), f);
const prose = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

test("state is expressed with the semantic palette, not the brand tokens", () => {
  // The brand tokens keep their decorative jobs — a sage fill, a linen card.
  // What they may not do is carry MEANING, because they were never contrast-
  // verified for it and because two vocabularies for one concept is how the
  // product ended up looking like two products.
  const BANNED: Array<[RegExp, string]> = [
    [/\btext-support-deep\b/, "text-support-deep (use text-state-support)"],
    [/\bbg-support\/\d+\b/, "bg-support/N (use bg-state-support-bg)"],
    [/\bbg-pause-soft\b/, "bg-pause-soft (use bg-state-caution-bg)"],
    [/\bborder-pause\/\d+\b/, "border-pause/N (use border-state-caution)"],
    [/\btext-safe-deep\b/, "text-safe-deep (use text-state-safe)"],
    [/\bbg-mist\/\d+\b/, "bg-mist/N (use bg-state-info-bg)"],
    [/\btext-mist-deep\b/, "text-mist-deep (use text-state-info)"],
  ];
  const offenders: string[] = [];
  for (const f of FILES) {
    const src = prose(fs.readFileSync(f, "utf8"));
    for (const [rx, what] of BANNED) {
      if (rx.test(src)) offenders.push(`${rel(f)} — ${what}`);
    }
  }
  assert.deepEqual(offenders, [],
    "these surfaces express state with the old brand tokens:\n  " + offenders.join("\n  "));
});

test("priority is rendered by one component, not re-implemented per screen", () => {
  // Caseload and the alert list each had their own band-to-colour map, on the
  // same screen, disagreeing with the badge used everywhere else.
  const offenders: string[] = [];
  // primitives.tsx is where the badge is defined; the rule is that nobody else
  // defines a second one.
  const CANONICAL = path.join("components", "clinical", "primitives.tsx");
  for (const f of FILES) {
    if (rel(f).includes(CANONICAL)) continue;
    const src = prose(fs.readFileSync(f, "utf8"));
    // A local map from band names to classes is the tell.
    if (/(BAND_STYLE|BAND_COLOU?R|bandClass)\s*[:=]/.test(src)) {
      offenders.push(`${rel(f)} — defines its own band styling`);
    }
    // A bare band value rendered as text where the badge exists.
    if (/>\s*\{\s*[ar]\.band\s*\}\s*</.test(src)) {
      offenders.push(`${rel(f)} — renders a raw band value instead of PriorityBadge`);
    }
  }
  assert.deepEqual(offenders, [],
    "priority is styled in more than one place:\n  " + offenders.join("\n  ") +
    "\nUse PriorityBadge from components/clinical/primitives.tsx.");
});

test("clinician surfaces share a page shell rather than each opening their own way", () => {
  // Four review consoles opened at three different widths with three subtitle
  // conventions. Individually invisible; together it is why moving between them
  // felt like moving between separate tools.
  const shelled = [
    ["src/app/review/audit/page.tsx", "ReviewPage"],
    ["src/app/review/bls/page.tsx", "ReviewPage"],
    ["src/app/review/testing/page.tsx", "ReviewPage"],
    ["src/app/review/autonomous/page.tsx", "ReviewPage"],
    ["src/app/clinician/member/[id]/page.tsx", "PersonShell"],
    ["src/app/clinician/member/[id]/record/page.tsx", "PersonShell"],
    ["src/app/clinician/member/[id]/measures/page.tsx", "PersonShell"],
    ["src/app/clinician/member/[id]/sessions/page.tsx", "PersonShell"],
    ["src/app/clinician/member/[id]/safety/page.tsx", "PersonShell"],
    ["src/app/clinician/member/[id]/plan/page.tsx", "PersonShell"],
    ["src/app/clinician/member/[id]/audit/page.tsx", "PersonShell"],
  ];
  const missing = shelled
    .filter(([f, shell]) => !fs.readFileSync(path.join(process.cwd(), f), "utf8").includes(`<${shell}`))
    .map(([f, shell]) => `${f} — not wrapped in ${shell}`);
  assert.deepEqual(missing, [], "these surfaces open with their own chrome:\n  " + missing.join("\n  "));
});

test("every person sub-route is reachable from the record's own tabs", () => {
  // A tab strip that omits a sub-route makes it reachable only from wherever
  // happened to link it, which is how the trajectory ended up four hops deep.
  const shell = fs.readFileSync(path.join(process.cwd(), "src/components/clinical/PersonShell.tsx"), "utf8");
  for (const slug of ["/safety", "/measures", "/sessions", "/plan", "/audit", "/record"]) {
    assert.ok(shell.includes(`"${slug}"`), `the person tab strip omits ${slug}`);
  }
});
