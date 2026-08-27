// Automated public-copy guard (Redesign handoff §15).
//
// The handoff asks for a test that scans active public pages for retired
// consumer CTAs and restricted phrases, and that "allows approved
// qualifications in controlled contexts, not rely only on a raw banned-word
// list." So this is not a keyword blocklist: a phrase like "HIPAA compliant" is
// permitted where it appears inside an explicit denial ("Steady is not HIPAA
// compliant"), and forbidden where it appears as a claim.
//
// Why a test rather than a review checklist: marketing copy is edited by
// whoever is closest to a deadline, and the failure mode is silent. A page that
// quietly regains a purchase link or a compliance claim looks fine to everyone
// who did not write the rule.
//
// This guard runs against SOURCE, not a rendered page, so it fails in the same
// commit that introduces the problem rather than after a deploy.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  CAPABILITIES, STATUS_LABEL, RESTRICTED_PHRASES, RETIRED_ROUTES, BOUNDARY,
} from "../src/lib/site/registry";

const APP = path.join(process.cwd(), "src", "app");

/** Public routes: everything a visitor can reach without authentication. The
 *  authenticated product surfaces carry the demo banner instead and are not in
 *  scope for marketing-copy rules. */
const PUBLIC_ROUTES = [
  "page.tsx",                    // /
  "platform/page.tsx",
  "clinical/page.tsx",
  "organizations/page.tsx",
  "payers/page.tsx",
  "request-review/page.tsx",
  "subscribe/page.tsx",
  "signup/page.tsx",
  "crisis/page.tsx",
  "login/page.tsx",
];

function read(rel: string): string {
  const p = path.join(APP, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

/** Strip code comments before scanning. A comment explaining *why* a phrase is
 *  banned must not itself trip the ban — otherwise the rule punishes writing
 *  the rule down. */
function prose(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

const publicSources = PUBLIC_ROUTES
  .map((r) => ({ route: r, src: read(r) }))
  .filter((f) => f.src.length > 0);

test("the public routes under guard actually exist", () => {
  assert.ok(publicSources.length >= 8, `only found ${publicSources.length} public routes`);
});

// ---------------------------------------------------------------------------
// §15 failure condition 1 — no links to retired retail routes
// ---------------------------------------------------------------------------

test("no public page links to a retired retail route", () => {
  for (const { route, src } of publicSources) {
    // The retired routes may reference themselves (a redirect, or the closed
    // page explaining itself), but nothing else may link to them.
    if (RETIRED_ROUTES.some((r) => route.startsWith(r.slice(1)))) continue;
    for (const retired of RETIRED_ROUTES) {
      assert.equal(
        new RegExp(`href=["']${retired}["']`).test(src), false,
        `${route} links to the retired route ${retired}`
      );
    }
  }
});

/** A restricted phrase is allowed only inside an explicit denial or a
 *  requirement statement — "not HIPAA compliant", "before HIPAA compliance can
 *  be claimed". Anything else is a claim. */
function isQualified(text: string, phrase: string): boolean {
  const idx = text.toLowerCase().indexOf(phrase.toLowerCase());
  if (idx < 0) return true;
  const before = text.slice(Math.max(0, idx - 120), idx).toLowerCase();
  return /\b(not|never|no|without|cannot|does not|do not|is not|are not|before|until|required|requires|claim)\b[^.]*$/.test(before);
}

// ---------------------------------------------------------------------------
// §15 failure condition 2 — no pricing, trial, or enrollment language
// ---------------------------------------------------------------------------

test("no public page presents pricing, a free trial, or enrollment", () => {
  const RETAIL = [
    /\$\d+(\.\d{2})?\s*(?:\/|per\s)\s*month/i,
    /\bfree (?:week|trial)\b/i,
    /\b7 days free\b/i,
    /\bcancel anytime\b/i,
    /\bstart (?:free|your free)\b/i,
    /\bchoose (?:a|your) plan\b/i,
    /\bsubscribe now\b/i,
  ];
  for (const { route, src } of publicSources) {
    const text = prose(src);
    for (const rx of RETAIL) {
      const m = rx.exec(text);
      if (!m) continue;
      // A denial is not an offer. "There is no free trial" must pass, while
      // "Start your free trial" must not — the same qualification rule used for
      // restricted phrases below, so the guard bans claims rather than words.
      assert.ok(
        isQualified(text, m[0]),
        `${route} contains retail language "${m[0]}" that is not stated as a denial`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// §15 failure condition 3 — restricted phrases need an approved qualification
// ---------------------------------------------------------------------------

test("restricted phrases appear only as explicit denials, never as claims", () => {
  for (const { route, src } of publicSources) {
    const text = prose(src);
    for (const phrase of RESTRICTED_PHRASES) {
      if (!text.toLowerCase().includes(phrase.toLowerCase())) continue;
      assert.ok(
        isQualified(text, phrase),
        `${route} uses "${phrase}" without an approved qualification. ` +
        `It may appear only inside an explicit denial or requirement.`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// §15 failure condition 4 — screenshots and fixtures use reserved identifiers
// ---------------------------------------------------------------------------

test("no public page contains an identifier outside the reserved demo patterns", () => {
  // RFC 2606 reserves example.com/.org/.net and .test/.invalid/.example for
  // exactly this purpose, so a reserved address can never route to a real
  // person's inbox.
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const RESERVED = /@(?:example\.(?:com|org|net)|test\.local|[a-z0-9-]+\.(?:test|invalid|example))$/i;

  for (const { route, src } of publicSources) {
    for (const found of prose(src).match(EMAIL) ?? []) {
      assert.ok(
        RESERVED.test(found),
        `${route} contains "${found}", which is not a reserved demonstration address`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// §15 failure condition 5 — every capability card carries a status
// ---------------------------------------------------------------------------

test("status labels come only from the registry", () => {
  const allowed = new Set(Object.values(STATUS_LABEL));
  // Every capability the registry defines must use one of the four labels.
  for (const c of CAPABILITIES) {
    assert.ok(
      allowed.has(STATUS_LABEL[c.status]),
      `capability "${c.id}" has an unknown status`
    );
    assert.ok(c.owner.length > 0, `capability "${c.id}" has no owner`);
    assert.match(c.lastReviewed, /^\d{4}-\d{2}-\d{2}$/, `capability "${c.id}" has no review date`);
    assert.ok(c.audiences.length > 0, `capability "${c.id}" is shown to no audience`);
  }
});

test("a capability that is not a working demo does not read as one", () => {
  // The words that would make a planned or simulated capability sound live.
  for (const c of CAPABILITIES) {
    if (c.status === "working_demo") continue;
    assert.doesNotMatch(
      c.summary, /\b(?:is live|now available|in production|fully enforced)\b/i,
      `capability "${c.id}" is ${c.status} but its summary reads as shipped`
    );
  }
});

test("capability cards are rendered through the shared component, not hand-written", () => {
  // Pages import CapabilityCard rather than writing their own status markup.
  // This is what keeps §6's "one registry" rule true in practice.
  for (const { route, src } of publicSources) {
    if (!/CapabilityCard/.test(src)) continue;
    assert.match(src, /from "@\/components\/site\/PublicChrome"/,
      `${route} renders capability cards without importing the shared component`);
  }
});

// ---------------------------------------------------------------------------
// §15 failure condition 6 — the boundary is present on every audience page
// ---------------------------------------------------------------------------

test("the boundary statement appears on the homepage and every audience page", () => {
  const MUST_CARRY = ["page.tsx", "platform/page.tsx", "clinical/page.tsx",
    "organizations/page.tsx", "payers/page.tsx", "request-review/page.tsx"];
  for (const route of MUST_CARRY) {
    const src = read(route);
    assert.ok(src.length > 0, `${route} is missing`);
    assert.match(src, /BoundaryNote/,
      `${route} does not render the boundary statement`);
  }
});

test("the boundary statement itself names every limit", () => {
  const b = BOUNDARY.primary.toLowerCase();
  for (const required of ["prototype", "fabricated data", "not clinical care", "not approved"]) {
    assert.ok(b.includes(required), `the boundary statement omits "${required}"`);
  }
});

// ---------------------------------------------------------------------------
// Safety utilities that must survive any redesign
// ---------------------------------------------------------------------------

test("the crisis route stays public and is reachable from the footer", () => {
  const chrome = fs.readFileSync(
    path.join(process.cwd(), "src", "components", "site", "PublicChrome.tsx"), "utf8"
  );
  assert.match(chrome, /href="\/crisis"/, "the footer no longer links to crisis resources");
  // The sentence is rendered from the registry constant, so follow it there:
  // asserting on the component source alone would pass a footer that dropped
  // the text and fail one that correctly reused it.
  assert.match(chrome, /BOUNDARY\.crisis/, "the footer no longer renders the crisis statement");
  assert.match(BOUNDARY.crisis, /988/, "the crisis statement no longer names the crisis line");
  assert.match(BOUNDARY.crisis, /911/, "the crisis statement no longer names emergency services");
  // It is a safety utility, not a product call to action (§5).
  // [\s\S] rather than the /s flag, which needs an es2018 target.
  assert.doesNotMatch(chrome, /Get help now[\s\S]*rounded-full bg-ground/,
    "the crisis link is styled as a primary product CTA");
});

test("no shared credential appears in the global banner", () => {
  // §3: "Do not expose shared passwords in the global banner." A password
  // printed on every page of an environment shaped like a clinical record
  // outlives every other access control.
  const layout = fs.readFileSync(path.join(APP, "layout.tsx"), "utf8");
  assert.doesNotMatch(layout, /demo1234|password\s*[:=]\s*["'][^"']+["']/i,
    "the global banner exposes a shared credential");
});

test("the demo banner carries the mandated wording", () => {
  const layout = fs.readFileSync(path.join(APP, "layout.tsx"), "utf8");
  assert.match(layout, /DEMO — FABRICATED DATA — NOT CLINICAL CARE/,
    "the mandated demo label is missing or reworded");
});

test("the review environment is not indexable", () => {
  const robots = read("robots.ts");
  assert.ok(robots.length > 0, "src/app/robots.ts is missing");
  assert.match(robots, /disallow:\s*["']\/["']/i, "robots.ts does not disallow indexing");
});
