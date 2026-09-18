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
import { essaysInFrontOfWork } from "../src/lib/experience/disclosure";

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

test("a shared wrapper never puts a paragraph inside a paragraph", () => {
  // A REAL DEFECT ON NINE SCREENS, and nobody was reading the console.
  //
  // `Callout` wrapped its children in `<p><span>…</span></p>`, and nine call
  // sites pass a `<p>` as their child — which is invalid HTML. React does not
  // merely warn: it finds the mismatch on hydration and REGENERATES THE WHOLE
  // TREE on the client, so every one of those screens was throwing a hydration
  // error in the browser while looking fine in a screenshot.
  //
  // Found twice in this codebase before it was fixed: once on the fairness and
  // model screens, where the call sites were changed, and once here — at which
  // point changing call sites was clearly the wrong layer to fix it at.
  const surfaces = fs.readFileSync(path.join(process.cwd(), "src/components/app/surfaces.tsx"), "utf8");
  const body = prose(surfaces.slice(surfaces.indexOf("export function Callout"), surfaces.indexOf("export type SummaryCard")));
  assert.ok(
    !/<p[\s>][\s\S]*\{children\}/.test(body),
    "Callout renders its children inside a paragraph, so any block child is invalid HTML"
  );
  assert.ok(
    !/<span[^>]*>\s*\{children\}\s*<\/span>/.test(body),
    "Callout wraps its children in a span, which cannot contain a paragraph either"
  );
  assert.match(body, /\{children\}/, "Callout no longer renders its children");
});

test("no shared surface wrapper renders block children inside an inline element", () => {
  // The general form of the rule above, over the wrappers that take children.
  // A wrapper is free to use a paragraph for its OWN text; what it may not do
  // is put the caller's children inside one.
  const surfaces = fs.readFileSync(path.join(process.cwd(), "src/components/app/surfaces.tsx"), "utf8");
  const offenders: string[] = [];
  for (const m of surfaces.matchAll(/export function (\w+)\(/g)) {
    const start = m.index ?? 0;
    const next = surfaces.indexOf("\nexport ", start + 1);
    const body = prose(surfaces.slice(start, next < 0 ? undefined : next));
    if (!body.includes("{children}")) continue;
    if (/<(p|span)[^>]*>(?:(?!<\/?(?:p|span)\b)[\s\S])*\{children\}/.test(body)) {
      offenders.push(m[1]);
    }
  }
  assert.deepEqual(offenders, [], `these wrappers nest caller children inside an inline element: ${offenders.join(", ")}`);
});

// ---------------------------------------------------------------------------
// Legibility: the 17 September handoff's metadata rule
// ---------------------------------------------------------------------------

test("no text on a clinical or member surface is shrunk below the type scale", () => {
  // "Keep routine metadata readable. Do not make it tiny or excessively muted."
  //
  // THE COMPLAINT THIS CAME FROM was that the screens are "very data heavy,
  // very engineer geared". Arbitrary pixel sizes are how that happens one
  // element at a time: a label does not fit, so it is set at 10px, and three
  // months later a clinician is reading an event id and a policy version at
  // two thirds of body size on the line that tells them whose record this is.
  //
  // The floor is the scale's own smallest step. A value written as text-[Npx]
  // is outside the scale by construction, which is the thing being refused —
  // not a particular number.
  const offenders: string[] = [];
  for (const f of FILES) {
    // The reviewer console is a different audience and a different job, and it
    // carries most of the remaining uses. Out of scope here deliberately, and
    // recorded as `experience.review-console-legibility` rather than quietly
    // skipped.
    if (rel(f).startsWith("src/app/review")) continue;
    const body = prose(fs.readFileSync(f, "utf8"));
    for (const m of body.matchAll(/text-\[(\d+)px\]/g)) {
      if (Number(m[1]) < 12) offenders.push(`${rel(f)}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `text set below the scale's floor:\n  ${offenders.join("\n  ")}`);
});

test("no text on a clinical or member surface is faded below legibility", () => {
  // The other half of the same rule. A colour token at 60% opacity over a
  // surface is a contrast figure nobody computed: the palette pairs in
  // globals.css are verified at their full value, and an opacity modifier
  // silently leaves the verified pair.
  //
  // Eighty is the line rather than a hundred, because a genuinely secondary
  // note at /80 still clears its pair with room, and forbidding the modifier
  // outright would ban a legitimate hover and border use of the same syntax.
  const offenders: string[] = [];
  for (const f of FILES) {
    if (rel(f).startsWith("src/app/review")) continue;
    const body = prose(fs.readFileSync(f, "utf8"));
    for (const m of body.matchAll(/\btext-[a-z][a-z-]*\/(\d+)\b/g)) {
      if (Number(m[1]) < 80) offenders.push(`${rel(f)}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `text faded below 80%:\n  ${offenders.join("\n  ")}`);
});

// ---------------------------------------------------------------------------
// UX 010: the essays fold, the claims stay
// ---------------------------------------------------------------------------

test("no console screen opens with an essay in front of the work", () => {
  // UX 010: "Large explanation blocks and narrow columns bury working
  // content." Measured before it was fixed: the first thing a clinician could
  // act on was 813px down on Handoffs, 628 on the caseload, 559 on the module
  // queue — below the fold on a laptop, in the ordinary case where nothing is
  // waiting.
  //
  // WHAT IS BEING REFUSED IS A STANDING ESSAY, not explanation. A sentence
  // that changes with the data — a status line, a refusal, a result — is the
  // screen doing its job. What folds is the paragraph that is identical on
  // every visit and describes a fact that does not change. The rule below
  // cannot tell those apart by reading, so it uses length: past
  // ESSAY_WORD_LIMIT a paragraph is an essay, and an essay belongs behind a
  // summary that keeps its first claim visible. The limit is declared in
  // src/lib/experience/disclosure.ts, because a product decision that lives
  // only in an assertion is one nobody can find.
  const SCREENS = [
    "src/app/clinician/handoffs/page.tsx",
    "src/app/clinician/caseload/page.tsx",
    "src/app/clinician/unlocks/page.tsx",
  ];

  const offenders: string[] = [];
  for (const rel of SCREENS) {
    const src = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    for (const p of essaysInFrontOfWork(src)) {
      offenders.push(`${rel}: ${p.words} words — "${p.text.slice(0, 80)}…"`);
    }
  }
  assert.deepEqual(offenders, [],
    `these paragraphs are long enough to bury the work and are not behind a disclosure:\n  ${offenders.join("\n  ")}`);
});

test("folding an essay did not fold the claim it carries", () => {
  // The other half, and the one that makes the rule above safe. "Keep safety
  // constraints visible while moving repeated technical essays behind
  // disclosure controls" — so each disclosure's SUMMARY has to carry the
  // sentence a clinician must not miss, and a <details> whose summary is a
  // bare "More" would pass the length rule while hiding the point.
  const REQUIRED: Array<[string, RegExp]> = [
    ["src/app/clinician/handoffs/page.tsx", /A transfer moves accountability only when it is accepted/],
    // DERIVED, NOT WRITTEN, which is why this looks for the call rather than
    // the words. The first version of this guard matched the literal "not
    // clinical approval" in the summary — and the summary now says
    // {policyApproval(policy)}, which renders "PROVISIONAL, not clinically
    // approved" from the policy itself. That is the stronger form: a literal
    // keeps saying "not approved" on the day somebody approves the policy, and
    // a call cannot.
    ["src/app/clinician/caseload/page.tsx", /policyApproval\(/],
    ["src/app/clinician/unlocks/page.tsx", /Members can reach them\s*\n?\s*without a decision here/],
  ];
  for (const [rel, claim] of REQUIRED) {
    const src = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    const summaries = [...src.matchAll(/<summary[\s\S]*?<\/summary>/g)].map((m) => m[0]).join("\n");
    assert.match(summaries, claim,
      `${rel} folded an essay without keeping its claim in the summary`);
  }
});
