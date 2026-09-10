// Reading the permission sequence out of the source (handoff 06 §30.6, §31.5).
//
// For every protected route in the register, this finds the file that serves it
// and reports which of the steps it owes have evidence in the code that runs.
//
// HOW FAR IT LOOKS, and why not further. A route file rarely calls a guard
// inline all the way down: it calls `loadPersonHeader`, which does the
// tenant-scoped lookup. So evidence is taken from the route's own source AND
// from the body of any symbol the route IMPORTS AND CALLS. It stops there,
// deliberately. A transitive walk through src/lib reaches `audit(` from almost
// anywhere within two hops, and an inventory where every route is green because
// everything imports everything is worse than no inventory — it is a wall that
// reads as a result.
//
// WHAT A MISSING CELL MEANS. Not "insecure". It means the evidence for that
// step is not visible at the depth this looks, which is either a real gap or a
// mechanism further down than one call. Both are worth a reviewer's attention
// and neither is a verdict, so the screen reports them as "not shown here" and
// names what would settle it.

import fs from "fs";
import path from "path";

import { ROUTE_REGISTER, type RouteEntry } from "../app/route-register";
import {
  ACCESS_STEPS, isProtected, stepsFor, exemption, type AccessStep,
} from "./access-sequence";

const SRC = path.join(process.cwd(), "src");

export interface RouteEvidence {
  path: string;
  audience: string;
  /** The file that serves this route, relative to src/. Null when the register
   *  names a route with no file — which is itself a finding. */
  file: string | null;
  owed: number[];
  /** Step number -> the markers found for it. Empty array = owed, not shown. */
  found: Record<number, string[]>;
  missing: number[];
  /** Steps this route declares it does not owe, with the reason on the screen. */
  exempt: number[];
}

export interface AccessInventory {
  routes: RouteEvidence[];
  protectedCount: number;
  /** Routes with no gap at all, in the steps they owe that can be shown. */
  complete: number;
  /** Step number -> how many routes owe it and cannot show it. */
  gapsByStep: Record<number, number>;
  unresolved: string[];
}

/** Strip comments. A guard named in the prose explaining the rule is not the
 *  rule being enforced — the same trap every source-reading guard in this
 *  codebase has fallen into at least once. */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

/** The file that serves a route path, or null. */
export function fileForRoute(routePath: string): string | null {
  const segments = routePath === "/" ? [] : routePath.replace(/^\//, "").split("/");
  const dir = path.join(SRC, "app", ...segments);
  for (const leaf of ["page.tsx", "page.ts", "route.ts"]) {
    const p = path.join(dir, leaf);
    if (fs.existsSync(p)) return path.relative(SRC, p);
  }
  return null;
}

/** Local imports of a file: the module specifier and the named symbols. */
function localImports(src: string, fromRel: string): Array<{ file: string; names: string[] }> {
  const out: Array<{ file: string; names: string[] }> = [];
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const spec = m[2];
    if (!spec.startsWith("@/") && !spec.startsWith(".")) continue;
    const names = m[1]
      .split(",")
      .map((n) => n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    const base = spec.startsWith("@/")
      ? path.join(SRC, spec.slice(2))
      : path.resolve(path.join(SRC, path.dirname(fromRel)), spec);
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      if (fs.existsSync(base + ext)) { out.push({ file: base + ext, names }); break; }
    }
  }
  return out;
}

/** The body of a named exported function, brace-matched. */
function bodyOf(src: string, name: string): string | null {
  const decl = new RegExp(`(?:export\\s+)?(?:async\\s+)?(?:function|const)\\s+${name}\\b`);
  const m = decl.exec(src);
  if (!m) return null;
  // The body opens at the first brace after the parameter list closes. Taking
  // the first brace outright finds a default value like `= {}` and returns an
  // empty body that matches nothing.
  //
  // A BODY CAN OPEN INSIDE A CALL'S PARENTHESES, which the depth rule alone
  // gets wrong. `const f = cache(async (a) => { … })` — a real form in this
  // codebase, and the shape React's request-scoped memoisation takes — has its
  // body brace at paren depth 1, so a depth-0 rule scans past it to the
  // trailing `;` and reports the function as having no body at all. When that
  // happened to `recordAggregateAccess`, twenty aggregate routes went from
  // audited to unaudited in the inventory without one line of their own
  // changing. A brace immediately after `=>` opens a body at whatever depth it
  // sits at.
  let parens = 0;
  let open = -1;
  for (let i = m.index; i < src.length; i++) {
    if (src[i] === "(") parens += 1;
    else if (src[i] === ")") parens -= 1;
    else if (src[i] === "{" && (parens === 0 || arrowPrecedes(src, i))) { open = i; break; }
    else if (src[i] === ";" && parens === 0) return null;
  }
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

/** Whether the token immediately before position `i` is a `=>`. */
function arrowPrecedes(src: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j -= 1;
  return j >= 1 && src[j] === ">" && src[j - 1] === "=";
}

/**
 * The layouts that wrap a route, outermost first.
 *
 * A GUARD IN A LAYOUT PROTECTS ITS WHOLE SUBTREE, and this is how four of the
 * five consoles in this app are actually protected: `src/app/clinician/layout.tsx`
 * calls `requireClinician` once, and no page beneath it repeats the call. A
 * scan that reads only page.tsx reports every one of those pages as unguarded,
 * which is not a finding, it is the scan being wrong about Next.js — and the
 * first run of this inventory said exactly that about twenty-nine routes.
 */
export function layoutsFor(routePath: string): string[] {
  const segments = routePath === "/" ? [] : routePath.replace(/^\//, "").split("/");
  const out: string[] = [];
  for (let i = 0; i <= segments.length; i++) {
    const p = path.join(SRC, "app", ...segments.slice(0, i), "layout.tsx");
    if (fs.existsSync(p)) out.push(path.relative(SRC, p));
  }
  return out;
}

/** The source a route's guards can be found in: its own and its layouts', plus
 *  the bodies of the symbols each imports AND calls.
 *
 *  EXPORTED FOR THE CALIBRATION TEST rather than for a caller. The inventory's
 *  worth depends on this walk being BOUNDED, and once every protected route
 *  shows every step it owes, "some route still has a gap" stops being able to
 *  tell a well-guarded codebase from a walk that reaches everything. What can
 *  still tell them apart is a negative control: a marker that lives three hops
 *  away must not turn up here. */
export function reachableSource(rel: string, routePath: string): string {
  const abs = path.join(SRC, rel);
  if (!fs.existsSync(abs)) return "";
  let own = code(fs.readFileSync(abs, "utf8"));
  for (const layout of layoutsFor(routePath)) {
    own += "\n" + code(fs.readFileSync(path.join(SRC, layout), "utf8"));
  }
  let combined = own;
  for (const imp of localImports(own, rel)) {
    let impSrc: string | null = null;
    for (const name of imp.names) {
      // Only a symbol the route actually USES. An import that is never used is
      // not a guard that ran — the distinction this codebase has had to relearn
      // in four separate guards.
      //
      // A COMPONENT IS USED IN JSX, NOT CALLED. `<Figure …/>` never matches
      // `Figure(`, and the aggregate consoles apply small-cell suppression
      // inside exactly such components — so at call-detection only, nineteen
      // organization and payer routes reported no suppression while rendering
      // it on every figure they draw.
      //
      // A SERVER ACTION IS HANDED OVER, NOT CALLED EITHER. `action={requestOrgExport}`
      // is the most consequential code a page runs — the one write path that
      // produces a governed export — and the walk was blind to it in both of
      // the earlier forms. A route that hands a function to a component causes
      // that function to run as surely as one that calls it.
      if (!new RegExp(`\\b${name}\\s*\\(|<${name}[\\s/>]|[A-Za-z]=\\{${name}\\}`).test(own)) continue;
      impSrc ??= code(fs.readFileSync(imp.file, "utf8"));
      const body = bodyOf(impSrc, name);
      if (body) combined += "\n" + body + "\n" + sameFileHelpers(impSrc, body);
    }
  }
  return combined;
}

/**
 * The bodies of helpers the imported symbol calls, from ITS OWN MODULE.
 *
 * One more hop, and confined to one file on purpose. The organization console
 * calls `buildOrgOverview`, and the small-cell threshold is applied by a median
 * helper inside that module rather than in the exported function's own body —
 * so at one hop the inventory reported twenty-one aggregate routes as having no
 * suppression, which was the walk being shallow rather than the routes being
 * wrong.
 *
 * Same file only. Following the calls wherever they lead reaches `audit(` from
 * almost anywhere in two more hops, and an inventory where everything is green
 * because everything imports everything is a wall that reads as a result.
 */
function sameFileHelpers(moduleSrc: string, body: string): string {
  let out = "";
  const called = new Set(
    [...body.matchAll(/\b([a-z][A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1])
  );
  for (const name of called) {
    const helper = bodyOf(moduleSrc, name);
    if (helper && helper !== body) out += "\n" + helper;
  }
  return out;
}

function evidenceIn(src: string, s: AccessStep): string[] {
  return s.evidence.filter((marker) => src.includes(marker));
}

export function inventory(): AccessInventory {
  const routes: RouteEvidence[] = [];
  const unresolved: string[] = [];
  const gapsByStep: Record<number, number> = {};
  for (const s of ACCESS_STEPS) gapsByStep[s.n] = 0;

  for (const entry of ROUTE_REGISTER as RouteEntry[]) {
    if (!isProtected(entry)) continue;
    const file = fileForRoute(entry.path);
    if (!file) {
      unresolved.push(entry.path);
      continue;
    }
    const src = reachableSource(file, entry.path);
    const owed = stepsFor(entry);
    const found: Record<number, string[]> = {};
    const missing: number[] = [];
    const exempt: number[] = [];
    for (const n of owed) {
      const s = ACCESS_STEPS.find((x) => x.n === n)!;
      // A behaviourally-proven step is never counted as a static gap: there is
      // no marker for it, so an empty cell would report the absence of a thing
      // that was never claimed.
      if (s.proof === "behaviourally") { found[n] = []; continue; }

      // AN EXEMPTION IS CHECKED FIRST, and that ordering is a correction.
      //
      // It used to run only when no evidence was found, which made it a
      // fallback rather than a statement. Then the member tree got a layout —
      // and because a layout's source is part of every route beneath it, the
      // walk started finding `requireMember(` and `hasConsent(` on
      // `/app/ground`, which takes the layout's OPEN branch and calls neither.
      // The inventory reported grounding as authenticated. That is FALSE
      // COVERAGE, which is worse than a false gap: a reviewer reads a guard
      // that does not run.
      //
      // A static walk cannot see which branch a layout takes. What it can do is
      // treat a declared exemption as what it says it is — a statement that the
      // route does not owe the step — so the answer comes from the decision
      // somebody wrote down rather than from an import the route never reaches.
      if (exemption(entry.path, n)) { exempt.push(n); found[n] = []; continue; }

      const hits = evidenceIn(src, s);
      found[n] = hits;
      if (hits.length > 0) continue;
      missing.push(n);
      gapsByStep[n] += 1;
    }
    routes.push({ path: entry.path, audience: entry.audience, file, owed, found, missing, exempt });
  }

  return {
    routes,
    protectedCount: routes.length,
    complete: routes.filter((r) => r.missing.length === 0).length,
    gapsByStep,
    unresolved,
  };
}
