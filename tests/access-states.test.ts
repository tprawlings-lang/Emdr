// The shared access states (§26, "Shared access states — 8 screens").
//
// These are the screens nobody looks at until they are the only screen a
// person can see. Each of the rules below is one this product would otherwise
// break by omission rather than by decision, so each fails the build.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const APP = path.join(ROOT, "src", "app");

function read(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

/** Comments discuss these rules at length; the checks are about code. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/** §26's eight, by the file that actually serves each one. /404 is Next's
 *  not-found convention rather than a route, which is why it is listed by
 *  file: a page at src/app/404 would never be reached. */
const STATES: Array<{ label: string; file: string }> = [
  { label: "Sign in", file: "login/page.tsx" },
  { label: "Verification", file: "verify/page.tsx" },
  { label: "Password reset", file: "reset/page.tsx" },
  { label: "Accept invitation", file: "invite/[token]/page.tsx" },
  { label: "No access", file: "403/page.tsx" },
  { label: "Session expired", file: "session-expired/page.tsx" },
  { label: "Degraded service", file: "status/degraded/page.tsx" },
  { label: "Not found", file: "not-found.tsx" },
];

test("all eight shared access states exist", () => {
  const missing = STATES.filter((s) => !fs.existsSync(path.join(APP, s.file)))
    .map((s) => `${s.label} (${s.file})`);
  assert.deepEqual(missing, [], "these access states do not exist:\n  " + missing.join("\n  "));
});

test("every access state keeps a route to crisis support", () => {
  // §6: crisis is reachable from every screen, and §1 requires it to survive a
  // write, subscription, sync or service failure. An error state is exactly
  // when that matters, and exactly when it is easiest to forget — the built-in
  // 404 these replaced had no route anywhere except the global footer.
  //
  // The shell provides it for the pages that use it, so the check resolves one
  // hop.
  const shell = read(path.join(ROOT, "src", "components", "site", "AccessPage.tsx"));
  assert.match(shell, /href="\/crisis"/, "AccessPage has no crisis route");

  const missing = STATES.filter((s) => {
    const src = read(path.join(APP, s.file));
    return !/\/crisis/.test(src) && !/<AccessPage/.test(src);
  }).map((s) => s.label);
  assert.deepEqual(missing, [],
    "these access states offer no route to crisis support: " + missing.join(", "));
});

test("the not-found and no-access screens never echo what was asked for", () => {
  // The rule these protect is §26's "denied and missing pages do not reveal
  // protected existence". A page that prints the path back, or that reads a
  // record to decide which message to show, lets a visitor tell "no such
  // thing" from "a thing you may not see" — which is how a system is
  // enumerated from the outside.
  for (const file of ["not-found.tsx", "403/page.tsx"]) {
    const src = code(read(path.join(APP, file)));
    assert.doesNotMatch(src, /usePathname|headers\(\)|searchParams|params/,
      `${file} reads the request — a missing page must not know what was asked for`);
    assert.doesNotMatch(src, /\bawait data\(\)|SELECT /i,
      `${file} queries the database — deciding the message from a lookup is the leak`);
  }
});

test("the invitation screen never reads, echoes or looks up its token", () => {
  // A token is a bearer credential. Rendering it back puts it in browser
  // history, server logs and any screenshot; looking it up lets whoever is
  // guessing tell a wrong token from an expired one.
  const src = code(read(path.join(APP, "invite", "[token]", "page.tsx")));
  // The check is about USE, not about the word: the page's own copy tells a
  // reader it deliberately does not read the token, which is the point.
  assert.doesNotMatch(src, /\bparams\b/, "the invite screen reads its route params");
  assert.doesNotMatch(src, /\{\s*token\s*\}|params\.token/, "the invite screen destructures the token");
});

test("no unbuilt auth flow renders a control that would imply it works", () => {
  // Security theatre is the one kind of unfinished work that makes a system
  // less safe rather than merely less complete: a six-digit box that accepts
  // any six digits teaches a reviewer the control exists, and teaches a member
  // to stop reading the screen meant to make them pause.
  for (const file of ["verify/page.tsx", "reset/page.tsx", "invite/[token]/page.tsx"]) {
    const src = code(read(path.join(APP, file)));
    assert.doesNotMatch(src, /<input|<form|<button/,
      `${file} renders a control for a flow that is not implemented`);
  }
});

test("session expiry is distinguishable from never having signed in", () => {
  const auth = read(path.join(ROOT, "src", "lib", "auth.ts"));
  assert.match(auth, /session-expired/,
    "requireUser sends an expired session to the sign-in page, so a member is never told " +
    "that their session ended or that unsaved text was deliberately not kept");
  assert.match(auth, /store\.get\(COOKIE\) \? "\/session-expired" : "\/login"/,
    "the two cases are not separated by the presence of a session cookie");
});

test("the status page measures rather than asserts, and never reports crisis as down", async () => {
  const mod = await import("../src/lib/site/service-status");
  const status = await mod.readServiceStatus();

  const always = status.functions.filter((f) => f.alwaysAvailable);
  assert.equal(always.length, 2, "grounding and crisis are not both marked always-available");
  for (const f of always) {
    assert.equal(f.state, "available", `${f.name} can be reported as unavailable`);
  }

  // Every row carries a next step. A status row with no detail is a colour.
  for (const f of status.functions) {
    assert.ok(f.detail.length > 20, `${f.name} has no usable detail`);
  }

  // The source must actually probe something rather than return a literal.
  const src = read(path.join(ROOT, "src", "lib", "site", "service-status.ts"));
  assert.match(src, /await c\.get\(/, "the status page does not probe the database");
});

test("the status page encodes state with more than colour", () => {
  const src = read(path.join(APP, "status", "degraded", "page.tsx"));
  assert.match(src, /glyph/, "state is carried by colour alone");
  assert.match(src, /label/, "state has no text label");
});
