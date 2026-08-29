// Navigation integrity.
//
// Before this work the product had NO navigation component at all. Every
// clinician page carried its own ad-hoc back-link pointing somewhere different,
// `/app/learn` and `/app/activities` had zero internal links — you landed there and the
// browser's back button was the only way out — and the member trajectory sat
// four hops deep with nothing signposting the route. A reviewer who did not
// already know the URL could not find it, which reads as a missing feature
// rather than a missing signpost.
//
// The first thing adding a nav did was point at a page that did not exist
// (`/app/activities` had four children and no index). That is the failure mode this
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
 *  ([id], [path], …), which is how a link to /clinician/caseload/<uuid>
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

// The nav components are gone. Navigation is the app shell's rail, and where
// each of its five layers points per role is one file, so that file is what
// these check.
const RAILS = path.join(process.cwd(), "src", "lib", "app", "rails.ts");

function railDestinations(): string[] {
  return [...read(RAILS).matchAll(/"(\/[^"]+)"/g)].map((m) => m[1]);
}

test("every rail destination exists", () => {
  const dests = railDestinations();
  assert.ok(dests.length > 6, `only ${dests.length} rail destinations found; rails.ts moved`);
  const broken = dests.filter((h) => !routeExists(h.replace(/\$\{[^}]*\}/g, "x")));
  assert.deepEqual(broken, [], `the rail points at routes that do not exist: ${broken.join(", ")}`);
});

test("every console layer nav destination exists", () => {
  // The screens within a layer, listed under the title. Same promise as the
  // rail: an unkept one reads as a missing feature rather than a missing link.
  const src = read(path.join(COMPONENTS, "clinical", "ClinicianPage.tsx"));
  assert.ok(src.length > 0, "ClinicianPage.tsx is missing");
  const broken = hrefsIn(src).filter((h) => !routeExists(h));
  assert.deepEqual(broken, [], `the console layer nav points at routes that do not exist: ${broken.join(", ")}`);
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
  // /app/learn and /app/activities previously had zero internal links. A screen
  // with no way out is not a page, it is a trap — and the member most likely to
  // hit it is the one least able to work around it.
  //
  // This walks the whole /app tree rather than a hand-kept list, because the
  // list is what goes stale: the two screens that had no nav were the two
  // nobody had thought to add to it.
  //
  // Navigation now arrives through the app shell (§28's frame), usually via
  // MemberPage, so the check resolves one hop through a component: a page
  // counts if it renders AppShell, or renders something that does.
  const shellsThatCarryNav = new Set<string>();
  for (const dir of ["app", "member", "clinical", "presentation"]) {
    const d = path.join(COMPONENTS, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((n) => n.endsWith(".tsx"))) {
      if (/AppShell/.test(read(path.join(d, f)))) {
        shellsThatCarryNav.add(f.replace(/\.tsx$/, ""));
      }
    }
  }
  assert.ok(shellsThatCarryNav.has("AppShell"), "AppShell.tsx is missing");

  const pages: string[] = [];
  (function walk(dir: string, rel: string) {
    for (const n of fs.readdirSync(dir)) {
      const full = path.join(dir, n);
      if (fs.statSync(full).isDirectory()) walk(full, `${rel}/${n}`);
      else if (n === "page.tsx") pages.push(rel.replace(/^\//, ""));
    }
  })(path.join(APP, "app"), "");

  assert.ok(pages.length > 20, `only ${pages.length} member pages found; the walk is wrong`);

  // An activity or session in progress is deliberately chrome-free: §26 and
  // Vol 1 B-6 both ask for minimal reading during activation, and a nav rail
  // beside a running session is an invitation to leave it half-finished. These
  // screens end in an explicit "done" action instead.
  const IMMERSIVE = new Set([
    "activities/breathe", "activities/meditate", "activities/move", "activities/sleep",
    "session/[moduleId]", "session/resourcing",
  ]);

  const missing = pages.filter((r) => {
    if (IMMERSIVE.has(r)) return false;
    const src = read(path.join(APP, "app", ...r.split("/"), "page.tsx"));
    if (/AppShell/.test(src)) return false;
    return ![...shellsThatCarryNav].some((c) => new RegExp(`<${c}[\\s>]`).test(src));
  });
  assert.deepEqual(missing, [],
    `these member surfaces have no navigation: ${missing.join(", ")}. ` +
    "A screen a member cannot leave is a dead end.");
});

test("the clinician console has one nav rather than per-page back links", () => {
  // The console had eight hand-rolled "← back" links pointing at four
  // different places. One nav that says where everything is replaces all of
  // them; leaving both means two competing answers to "where am I".
  const layout = read(path.join(APP, "clinician", "layout.tsx"));
  assert.doesNotMatch(layout, /<\w*Nav\b/,
    "the clinician layout renders a nav bar above the shell's rail — that is two " +
    "competing answers to 'where am I', which is the defect the nav was added to fix");

  // Every console page reaches the shell, so none of them is the page that
  // quietly kept its own chrome.
  const unshelled: string[] = [];
  const walkShell = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walkShell(p);
      else if (e.name === "page.tsx") {
        const src = read(p);
        // The index is a redirect and renders nothing.
        if (/\bredirect\(/.test(src) && !/return \(/.test(src)) continue;
        if (!/<(ClinicianPage|PersonShell)\b/.test(src)) unshelled.push(path.relative(APP, p));
      }
    }
  };
  walkShell(path.join(APP, "clinician"));
  assert.deepEqual(unshelled, [],
    `these console pages do not render the shell: ${unshelled.join(", ")}`);

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

test("the rail carries no counts, badges, or notifications", () => {
  // A count on a nav item is a notification, and a notification is a demand.
  // Opening an app to three demands is how someone decides not to come back —
  // and a count of anything is also the streak problem in a smaller box.
  const src = read(path.join(COMPONENTS, "app", "AppShell.tsx")) + read(RAILS);
  const prose = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  for (const banned of ["count", "badge", "unread", "notification", "streak", "due"]) {
    assert.ok(
      !new RegExp(`\\b${banned}\\b`, "i").test(prose),
      `the rail references "${banned}" — layer names carry names, not demands`
    );
  }
});

test("crisis is a fixed affordance, not a nav item", () => {
  // §6: reachable from every screen at a fixed position, "a safety requirement,
  // not a layout preference: it must be findable without reading." One of five
  // nav items is findable only by reading them.
  const nav = read(path.join(COMPONENTS, "app", "AppShell.tsx")) + read(RAILS);
  assert.doesNotMatch(nav, /"\/crisis"/,
    "crisis is in the rail, where it is one option among five");
  const layout = read(path.join(APP, "layout.tsx"));
  assert.match(layout, /SosMount/, "the fixed crisis affordance is not mounted globally");
});
