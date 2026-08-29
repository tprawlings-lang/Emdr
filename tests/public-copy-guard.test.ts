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
import { DEMO_PASSWORDS } from "../src/lib/demo-seed";
import fs from "node:fs";
import path from "node:path";
import {
  CAPABILITIES, STATUS_LABEL, RESTRICTED_PHRASES, RETIRED_ROUTES, BOUNDARY,
} from "../src/lib/site/registry";
import { FAQ, FAQ_HIGHLIGHTS, faqItem, type Verdict } from "../src/lib/site/faq";
import { CONTROLS, CONTROL_STATE_LABEL, KNOWN_GAPS } from "../src/lib/site/trust";
import { REVIEW_PATHS, personasFor } from "../src/lib/site/review-access";

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
  "about/page.tsx",
  "trust/page.tsx",
  "evidence/page.tsx",
  "faq/page.tsx",
  "demo/page.tsx",
  "demo/[path]/page.tsx",
  "terms/page.tsx",
  "privacy/page.tsx",
  "accessibility/page.tsx",
  "request-review/page.tsx",
  "subscribe/page.tsx",
  "signup/page.tsx",
  "crisis/page.tsx",
  "login/page.tsx",
];

/** Content files that feed public pages. A claim moved out of a page and into a
 *  content module is still a public claim; scanning only `src/app` would let a
 *  refactor walk copy straight past the guard. */
const CONTENT_FILES = [
  "src/lib/site/registry.ts",
  "src/lib/site/faq.ts",
  "src/lib/site/trust.ts",
  "src/lib/site/review-access.ts",
  "src/components/site/PublicChrome.tsx",
];

function read(rel: string): string {
  const p = path.join(APP, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

function readRepo(rel: string): string {
  const p = path.join(process.cwd(), rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

/** Strip code comments before scanning. A comment explaining *why* a phrase is
 *  banned must not itself trip the ban — otherwise the rule punishes writing
 *  the rule down. */
function prose(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    // The list that defines the ban necessarily contains the banned phrases.
    // Same principle as stripping comments: the rule must not punish writing
    // the rule down. Only this one declaration is exempt, and it is matched by
    // name so nothing else can hide inside the exemption.
    .replace(/export const RESTRICTED_PHRASES[\s\S]*?\]\s*as const;/, " ");
}

const routeSources = PUBLIC_ROUTES
  .map((r) => ({ route: r, src: read(r) }))
  .filter((f) => f.src.length > 0);

const contentSources = CONTENT_FILES
  .map((r) => ({ route: r, src: readRepo(r) }))
  .filter((f) => f.src.length > 0);

/** Everything the copy rules apply to: public routes plus the content modules
 *  those routes render. */
const publicSources = [...routeSources, ...contentSources];

test("the public routes under guard actually exist", () => {
  // Every route named above must be present. A page that is deleted or renamed
  // silently drops out of the guard, which is the failure this catches.
  const missing = PUBLIC_ROUTES.filter((r) => read(r).length === 0);
  assert.deepEqual(missing, [], `public routes under guard are missing: ${missing.join(", ")}`);
  const missingContent = CONTENT_FILES.filter((r) => readRepo(r).length === 0);
  assert.deepEqual(missingContent, [], `content files under guard are missing: ${missingContent.join(", ")}`);
});

test("every page in the site's information architecture exists", () => {
  // §5's route list, plus every destination the shared chrome links to. A
  // broken footer link on an institutional site reads as neglect, and the
  // review gateway is the one path a reviewer actually has to walk.
  const chrome = readRepo("src/components/site/PublicChrome.tsx");
  const linked = new Set(
    [...chrome.matchAll(/href="(\/[a-z-]*)"/g)].map((m) => m[1])
  );
  for (const href of linked) {
    const slug = href === "/" ? "page.tsx" : `${href.slice(1)}/page.tsx`;
    assert.ok(read(slug).length > 0, `the shared chrome links to ${href}, which has no page`);
  }
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
  const hay = text.toLowerCase();
  const needle = phrase.toLowerCase();
  const DENIAL =
    /\b(not|never|no|none|nothing|neither|nor|without|cannot|does not|do not|is not|are not|before|until|required|requires|claim)\b[^.]*$/;
  // Every occurrence must be qualified, not just the first. A page that denies
  // a claim in paragraph one and makes it in paragraph six is exactly the
  // failure this guard exists to catch, and checking only indexOf would pass it.
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
    if (DENIAL.test(hay.slice(Math.max(0, i - 120), i))) continue;
    // A question is not a claim. "Is Steady HIPAA compliant?" is the reader's
    // question, and the answer beneath it is what carries the assertion — so
    // the verdicts are checked structurally below, where they can actually be
    // read, rather than guessed at from surrounding text.
    const terminator = /[.?!]/.exec(hay.slice(i + needle.length, i + needle.length + 120));
    if (terminator?.[0] === "?") continue;
    return false;
  }
  return true;
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
  //
  // `.local` is admitted on the same grounds rather than as an exception: RFC
  // 6762 reserves the whole TLD for link-local multicast DNS, so it resolves
  // to nothing outside a local network and can reach no inbox anywhere. The
  // guard previously spelled out `test.local` alone, which allowed exactly one
  // fabricated host and would have rejected the `@steady.local` addresses
  // handoff 07 p6 specifies — a rule that is right for the wrong reason.
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const RESERVED = /@(?:example\.(?:com|org|net)|[a-z0-9-]+\.(?:local|test|invalid|example))$/i;

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
  // This is what keeps §6's "one registry" rule true in practice. Scoped to
  // routes: PublicChrome is where the component is defined, not imported.
  for (const { route, src } of routeSources) {
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
  // Every demo password, not one literal. The guard used to name `demo1234`,
  // and the moment the six roles got six passwords it would have gone on
  // passing while five of them leaked.
  const anyDemoPassword = new RegExp(
    Object.values(DEMO_PASSWORDS).join("|") + `|password\\s*[:=]\\s*["'][^"']+["']`, "i",
  );
  assert.doesNotMatch(layout, anyDemoPassword,
    "the global banner exposes a shared credential");
});

test("the demo banner carries the mandated wording", () => {
  const layout = fs.readFileSync(path.join(APP, "layout.tsx"), "utf8");
  assert.match(layout, /DEMO — FABRICATED DATA — NOT CLINICAL CARE/,
    "the mandated demo label is missing or reworded");
});

// ---------------------------------------------------------------------------
// §13 — FAQ answers obey the same rules as pages
// ---------------------------------------------------------------------------

test("every FAQ answer leads with a direct verdict", () => {
  const allowed = new Set<Verdict>(["Yes", "No", "Not yet", "In the fabricated demo only"]);
  const seen = new Set<string>();
  for (const g of FAQ) {
    assert.ok(g.items.length > 0, `FAQ group "${g.id}" is empty`);
    for (const item of g.items) {
      assert.ok(allowed.has(item.verdict), `"${item.q}" has an unrecognised verdict`);
      assert.ok(item.a.trim().length > 0, `"${item.q}" has no answer`);
      assert.ok(!seen.has(item.q), `"${item.q}" is asked twice`);
      seen.add(item.q);
    }
  }
});

test("FAQ answers with legal, clinical, or security consequence carry a review date", () => {
  // §13: an FAQ is where a bounded claim quietly becomes a confident one. Any
  // answer touching compliance, care, or data must be attributable.
  const CONSEQUENTIAL = /\b(HIPAA|therapy|medical care|diagnos|monitor|protected health|business associate|patient data|validated|reimburse|isolation|AI provider|sign up)\b/i;
  for (const g of FAQ) {
    for (const item of g.items) {
      if (!CONSEQUENTIAL.test(item.q) && !CONSEQUENTIAL.test(item.a)) continue;
      assert.match(item.lastReviewed ?? "", /^\d{4}-\d{2}-\d{2}$/,
        `"${item.q}" makes a consequential claim without a review date`);
      assert.ok((item.owner ?? "").length > 0,
        `"${item.q}" makes a consequential claim without a named owner`);
    }
  }
});

test("the FAQ does not answer a boundary question more confidently than the site", () => {
  // The specific drift §13 names: a "Yes" attached to something the rest of the
  // site denies. These questions may never resolve to Yes.
  const MUST_NOT_BE_YES = [
    /HIPAA/i, /therapy or medical care/i, /monitoring activity/i,
    /protected health information/i, /clinically validated/i,
    /individuals sign up/i, /real patient data/i, /savings proven/i,
  ];
  for (const g of FAQ) {
    for (const item of g.items) {
      if (!MUST_NOT_BE_YES.some((rx) => rx.test(item.q))) continue;
      assert.notEqual(item.verdict, "Yes",
        `"${item.q}" is answered Yes, which contradicts the site's boundary`);
    }
  }
});

test("a restricted phrase in an FAQ question is never answered affirmatively", () => {
  // The text scan treats a question as a question rather than a claim. That
  // exemption is only safe because the verdict is checked here, where it can
  // be read directly: asking "Is Steady HIPAA compliant?" is fine, answering
  // Yes is not, and an answer that uses the phrase must still deny it.
  for (const g of FAQ) {
    for (const item of g.items) {
      for (const phrase of RESTRICTED_PHRASES) {
        if (item.q.toLowerCase().includes(phrase.toLowerCase())) {
          assert.notEqual(item.verdict, "Yes",
            `"${item.q}" asks about "${phrase}" and is answered Yes`);
        }
        assert.ok(isQualified(item.a, phrase),
          `the answer to "${item.q}" uses "${phrase}" as a claim rather than a denial`);
      }
    }
  }
});

test("every FAQ highlight resolves to a real question", () => {
  for (const q of FAQ_HIGHLIGHTS) {
    assert.doesNotThrow(() => faqItem(q), `homepage highlights "${q}", which is not in the FAQ`);
  }
});

// ---------------------------------------------------------------------------
// §11 — Trust Center precision
// ---------------------------------------------------------------------------

test("every control has a state, evidence discipline, and an owner", () => {
  const allowed = new Set(Object.keys(CONTROL_STATE_LABEL));
  for (const c of CONTROLS) {
    assert.ok(allowed.has(c.state), `control "${c.id}" has an unknown state`);
    assert.ok(c.owner.length > 0, `control "${c.id}" has no owner`);
    assert.ok(c.detail.length > 0, `control "${c.id}" has no detail`);
    // A control claimed as enforcing today must point at something.
    if (c.state === "current") {
      assert.ok(c.evidence && c.evidence.length > 0,
        `control "${c.id}" is claimed as current with no evidence`);
    }
    // A planned control may cite a design document — that is where the intent
    // is written down. It may not cite a source file or a test, because those
    // exist only for something that runs, and citing one would present a design
    // as an implementation.
    if (c.state === "planned" && c.evidence) {
      assert.doesNotMatch(c.evidence, /\.(?:ts|tsx|sql|sh)\b/,
        `control "${c.id}" is planned but cites an implementation artefact as evidence`);
    }
  }
});

test("a dormant control is never described as protecting the running environment", () => {
  for (const c of CONTROLS) {
    if (c.state === "current") continue;
    assert.doesNotMatch(
      c.detail, /\b(?:protects|enforces|prevents|blocks) (?:all|every|the running)\b/i,
      `control "${c.id}" is ${c.state} but its detail reads as enforcing`
    );
  }
});

test("the known-gap register is published, owned, and has closing conditions", () => {
  assert.ok(KNOWN_GAPS.length > 0, "the known-gap register is empty");
  for (const g of KNOWN_GAPS) {
    assert.ok(g.owner.length > 0, `gap "${g.id}" has no owner`);
    assert.ok(g.finding.length > 0, `gap "${g.id}" has no finding`);
    // A gap without an acceptance condition never closes; it just gets old.
    assert.ok(g.acceptance.length > 0, `gap "${g.id}" states no acceptance condition`);
    assert.ok(["T1", "T2", "T3"].includes(g.targetTier),
      `gap "${g.id}" is not tied to a tier it must close before`);
  }
});

// ---------------------------------------------------------------------------
// §3, §12 — the review gateway never exposes a credential
// ---------------------------------------------------------------------------

test("the demo gateway does not print an access code or a persona password", () => {
  for (const rel of ["demo/page.tsx", "demo/[path]/page.tsx", "login/page.tsx"]) {
    const src = read(rel);
    if (!src) continue;
    assert.doesNotMatch(src, /EMDR_REVIEW_ACCESS_CODE\s*(?:\}|\)|,)?\s*<\//,
      `${rel} renders the access code into the page`);
    assert.doesNotMatch(src, /(?:password|passcode|code)\s*(?:is|:)\s*["'][A-Za-z0-9]{4,}["']/i,
      `${rel} prints a shared credential`);
  }
});

test("a read-only review path is never offered a write-capable persona", () => {
  // Scope is decided server-side. Picking a different card must not widen it.
  for (const p of REVIEW_PATHS) {
    assert.ok(p.personas.length > 0, `review path "${p.id}" offers no persona`);
    if (p.writeCapable) continue;
    for (const persona of personasFor(p)) {
      assert.equal(persona.role, "member",
        `read-only path "${p.id}" offers the write-capable role "${persona.role}"`);
    }
  }
});

test("every review persona uses a reserved demonstration address", () => {
  // Same rule as the public-page guard above, and the same reasoning: RFC 2606
  // reserves the example domains, RFC 6762 reserves .local. Both are kept here
  // as a literal rather than shared, because a persona address and a page
  // address are checked for different reasons and a shared constant invites
  // loosening one to fix the other.
  const RESERVED = /@(?:example\.(?:com|org|net)|[a-z0-9-]+\.(?:local|test|invalid|example))$/i;
  for (const p of REVIEW_PATHS) {
    for (const persona of p.personas) {
      assert.match(persona.email, RESERVED,
        `review path "${p.id}" uses "${persona.email}", which is not a reserved address`);
      assert.match(persona.label, /fabricated/i,
        `persona "${persona.email}" is not labelled as fabricated`);
    }
  }
});

// ---------------------------------------------------------------------------
// §16 — legal copy is marked unreviewed until counsel has seen it
// ---------------------------------------------------------------------------

test("the demo legal documents are marked as pending counsel review", () => {
  for (const rel of ["terms/page.tsx", "privacy/page.tsx"]) {
    const src = read(rel);
    assert.ok(src.length > 0, `${rel} is missing`);
    assert.match(src, /Counsel has not yet reviewed/i,
      `${rel} does not state that counsel has not reviewed it`);
    // A demo notice must not present itself as a binding production policy.
    assert.match(src, /\bDemo\b/, `${rel} does not scope itself to the demonstration`);
  }
});

test("the review environment is not indexable", () => {
  const robots = read("robots.ts");
  assert.ok(robots.length > 0, "src/app/robots.ts is missing");
  assert.match(robots, /disallow:\s*["']\/["']/i, "robots.ts does not disallow indexing");
});
