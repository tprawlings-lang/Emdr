// Navigation integrity.
//
// Before this work the product had NO navigation component at all. Every
// clinician page carried its own ad-hoc back-link pointing somewhere different,
// `/learn` and `/practices` had zero internal links — you landed there and the
// browser's back button was the only way out — and the member trajectory sat
// four hops deep with nothing signposting the route. A reviewer who did not
// already know the URL could not find it, which reads as a missing feature
// rather than a missing signpost.
//
// The first thing adding a nav did was point at a page that did not exist
// (`/practices` had four children and no index). That is the failure mode this
// file exists for: a nav is a set of promises, and an unkept one is worse than
// no nav, because the reader now believes the thing is missing from the
// product rather than from the menu.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const APP = path.join(process.cwd(), "src", "app");
const COMPONENTS = path.join(process.cwd(), "src", "components");

/** Does a route exist for this href? Handles static segments and dynamic ones
 *  ([id], [path], …), which is how a link to /clinician/clinical/<uuid>
 *  resolves. */
function routeExists(href: string): boolean {
  const clean = href.split(/[?#]/)[0];
  const segs = clean.split("/").filter(Boolean);
  let dir = APP;
  for (const seg of segs) {
    const direct = path.join(dir, seg);
    if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) {
      dir = direct;
      continue;
    }
    const dynamic = fs.existsSync(dir)
      ? fs.readdirSync(dir).find((n) => n.startsWith("[") && fs.statSync(path.join(dir, n)).isDirectory())
      : undefined;
    if (!dynamic) return false;
    dir = path.join(dir, dynamic);
  }
  return fs.existsSync(path.join(dir, "page.tsx"));
}

function read(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

function hrefsIn(src: string): string[] {
  return [...src.matchAll(/href=(?:"|\{")(\/[^"']*)(?:"|"\})/g)]
    .map((m) => m[1])
    .filter((h) => !h.startsWith("//"));
}

// ---------------------------------------------------------------------------
// Every navigation destination resolves
// ---------------------------------------------------------------------------

test("every clinician nav destination exists", () => {
  const src = read(path.join(COMPONENTS, "clinical", "ClinicianNav.tsx"));
  assert.ok(src.length > 0, "ClinicianNav.tsx is missing");
  const broken = hrefsIn(src).filter((h) => !routeExists(h));
  assert.deepEqual(broken, [], `the clinician nav points at routes that do not exist: ${broken.join(", ")}`);
});

test("every member nav destination exists", () => {
  const src = read(path.join(COMPONENTS, "member", "MemberNav.tsx"));
  assert.ok(src.length > 0, "MemberNav.tsx is missing");
  const broken = hrefsIn(src).filter((h) => !routeExists(h));
  assert.deepEqual(broken, [], `the member nav points at routes that do not exist: ${broken.join(", ")}`);
});

test("every guided review destination exists", async () => {
  // The review paths' focus lists are now links rather than a reading list. A
  // broken one strands a reviewer mid-session, which is the exact situation
  // the guide was built to prevent.
  const { REVIEW_PATHS } = await import("../src/lib/site/review-access");
  const broken: string[] = [];
  for (const p of REVIEW_PATHS) {
    assert.ok(p.focus.length > 0, `review path "${p.id}" guides nobody anywhere`);
    for (const f of p.focus) {
      assert.ok(f.label.length > 0, `a focus item in "${p.id}" has no label`);
      if (!routeExists(f.href)) broken.push(`${p.id} → ${f.href}`);
    }
  }
  assert.deepEqual(broken, [], `the review guide points at routes that do not exist:\n  ${broken.join("\n  ")}`);
});

// ---------------------------------------------------------------------------
// No member surface is a dead end
// ---------------------------------------------------------------------------

test("every member surface carries the nav", () => {
  // /learn and /practices previously had zero internal links. A screen with no
  // way out is not a page, it is a trap — and the member most likely to hit it
  // is the one least able to work around it.
  const ROUTES = [
    "dashboard", "paths", "ground", "learn", "practices", "companion",
    "measures", "check-in",
  ];
  const missing = ROUTES.filter((r) => !/MemberNav/.test(read(path.join(APP, r, "page.tsx"))));
  assert.deepEqual(missing, [],
    `these member surfaces have no navigation: ${missing.join(", ")}. ` +
    "A screen a member cannot leave is a dead end.");
});

test("the clinician console has one nav rather than per-page back links", () => {
  // The console had eight hand-rolled "← back" links pointing at four
  // different places. One nav that says where everything is replaces all of
  // them; leaving both means two competing answers to "where am I".
  const layout = read(path.join(APP, "clinician", "layout.tsx"));
  assert.match(layout, /ClinicianNav/, "the clinician layout does not render the nav");

  const stragglers: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "page.tsx" && /←\s*(Specialist dashboard|Back to queue)/.test(read(p))) {
        stragglers.push(path.relative(APP, p));
      }
    }
  };
  walk(path.join(APP, "clinician"));
  assert.deepEqual(stragglers, [],
    `these console pages still carry their own back-link: ${stragglers.join(", ")}`);
});

// ---------------------------------------------------------------------------
// The nav must not become a scoreboard
// ---------------------------------------------------------------------------

test("the member nav carries no counts, badges, or notifications", () => {
  // A count on a nav item is a notification, and a notification is a demand.
  // Opening an app to three demands is how someone decides not to come back —
  // and a count of anything is also the streak problem in a smaller box.
  const src = read(path.join(COMPONENTS, "member", "MemberNav.tsx"));
  const prose = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  for (const banned of ["count", "badge", "unread", "notification", "streak", "due"]) {
    assert.ok(
      !new RegExp(`\\b${banned}\\b`, "i").test(prose),
      `the member nav references "${banned}" — nav items carry names, not demands`
    );
  }
});

test("crisis is a fixed affordance, not a nav item", () => {
  // §6: reachable from every screen at a fixed position, "a safety requirement,
  // not a layout preference: it must be findable without reading." One of five
  // nav items is findable only by reading them.
  const nav = read(path.join(COMPONENTS, "member", "MemberNav.tsx"));
  assert.doesNotMatch(nav, /href="\/crisis"/,
    "crisis is in the nav row, where it is one option among five");
  const layout = read(path.join(APP, "layout.tsx"));
  assert.match(layout, /SosMount/, "the fixed crisis affordance is not mounted globally");
});
