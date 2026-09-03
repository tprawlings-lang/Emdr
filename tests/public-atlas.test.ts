// The public institutional site against §26 p45's atlas — all eleven screens.
//
// This guard exists because the gap it closes was invisible for a long time,
// and invisible in a specific way: `/personal` and `/intelligence` were listed
// in the repository's own tracker as "naming only — content lives at
// /platform", which is what you conclude if you read the route names and not
// the atlas. p45 gives every screen its own PURPOSE, and the purposes are not
// the same:
//
//   /platform      "Understand one system and three surfaces"
//   /personal      "Review member value and limits"
//   /intelligence  "Review aggregate intelligence"
//
// The second is the question a clinician asks and the third is the question a
// reviewer asks. Filing them as duplicates of the first meant the site had no
// answer to either, and the tracker recorded that as a naming gap.
//
// So this checks the atlas by ROUTE AND PURPOSE, not by counting files.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { NAV } from "../src/components/site/PublicChrome";

const APP = path.join(process.cwd(), "src/app");

/** §26 p45's eleven, with the purpose each one owes the reader. Each purpose is
 *  a phrase the page must actually address — checked below against its own
 *  copy, so a page cannot satisfy this list by existing and saying nothing. */
const ATLAS: Array<{ route: string; dir: string; purpose: RegExp }> = [
  { route: "/", dir: "", purpose: /three products|choose|path/i },
  { route: "/platform", dir: "platform", purpose: /one system|three (layers|surfaces)/i },
  { route: "/personal", dir: "personal", purpose: /member/i },
  { route: "/clinical", dir: "clinical", purpose: /care team|clinician|caseload/i },
  { route: "/intelligence", dir: "intelligence", purpose: /aggregate/i },
  { route: "/organizations", dir: "organizations", purpose: /access|capacity|operating/i },
  { route: "/payers", dir: "payers", purpose: /contract|measure/i },
  { route: "/trust", dir: "trust", purpose: /safety|privacy|security/i },
  { route: "/evidence", dir: "evidence", purpose: /demonstrated|validat/i },
  { route: "/faq", dir: "faq", purpose: /question|objection/i },
  { route: "/request-review", dir: "request-review", purpose: /role|purpose|request/i },
];

function pageSource(dir: string): string {
  const p = path.join(APP, dir, "page.tsx");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

test("all eleven public screens exist", () => {
  const missing = ATLAS.filter((s) => pageSource(s.dir) === "").map((s) => s.route);
  assert.deepEqual(missing, [], `§26 p45 screens with no page: ${missing.join(", ")}`);
  assert.equal(ATLAS.length, 11, "the atlas list itself has drifted from p45's count");
});

test("each screen addresses its own purpose, not another's", () => {
  for (const s of ATLAS) {
    const src = pageSource(s.dir);
    assert.match(src, s.purpose,
      `${s.route} does not address its p45 purpose — it may be a copy of another screen`);
  }
});

test("/personal and /intelligence are not duplicates of their neighbours", () => {
  // The specific failure this file was written for. Two pages that render the
  // same sections satisfy "exists" and answer neither question.
  const personal = pageSource("personal");
  const platform = pageSource("platform");
  const intelligence = pageSource("intelligence");
  const organizations = pageSource("organizations");

  // A crude but honest similarity check: the fraction of one page's
  // non-trivial lines that appear verbatim in the other.
  const overlap = (a: string, b: string) => {
    const lines = a.split("\n").map((l) => l.trim()).filter((l) => l.length > 40);
    if (lines.length === 0) return 1;
    return lines.filter((l) => b.includes(l)).length / lines.length;
  };
  assert.ok(overlap(personal, platform) < 0.3,
    "/personal is largely a copy of /platform, so it answers /platform's question");
  assert.ok(overlap(intelligence, organizations) < 0.3,
    "/intelligence is largely a copy of /organizations");
});

test("every public screen is reachable from the navigation", () => {
  // p45's role-level acceptance: "Denied and missing pages do not reveal
  // protected existence" — and a page nothing links to is one nobody reviews.
  // Home and request-review are reached by the header logo and the site-wide
  // call to action rather than the nav row, so they are excluded by name here
  // rather than by the check quietly not covering them.
  const reachedElsewhere = new Set(["/", "/request-review"]);
  const inNav = new Set(NAV.map((n) => n.href as string));
  const orphans = ATLAS
    .filter((s) => !reachedElsewhere.has(s.route) && !inNav.has(s.route))
    .map((s) => s.route);
  assert.deepEqual(orphans, [],
    `these public screens are in the atlas but not in the nav: ${orphans.join(", ")}`);
});

test("the two exclusions are genuinely reachable", () => {
  // Named exclusions have to be checked, or the list above becomes a way to
  // hide an orphan by adding its route to it.
  const chrome = fs.readFileSync(
    path.join(process.cwd(), "src/components/site/PublicChrome.tsx"), "utf8"
  );
  assert.match(chrome, /href="\/"/, "the header does not link home");
  assert.match(chrome, /\/request-review/, "nothing links to the review request");
});

test("/personal states limits, not only capabilities", () => {
  // p45's purpose for this screen is "review member value AND LIMITS". A
  // product page that lists what a member gets and footnotes what it will not
  // do has answered half the question it was given.
  const src = pageSource("personal");
  assert.match(src, /does not|refuses|cannot/i);
  // The limits are structural on this page: each capability is paired with the
  // thing it deliberately does not do.
  assert.match(src, /WHAT_IT_DOES|Does, and does not/,
    "/personal has no paired limits section, so its limits are decoration");
});
