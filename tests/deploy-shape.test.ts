process.env.EMDR_DATA_DIR = `/tmp/steady-deployshape-${process.pid}-${Date.now()}`;

// What the deploy image can actually install (Dockerfile, render.yaml).
//
// THE FAILURE THIS EXISTS FOR took a merge to main, a failed production
// deploy, and a dashboard log to find — and every gate in this repository was
// green the whole time. `npm ci`, the full suite, the build and the e2e run all
// passed here, because THIS container has Python and a C++ toolchain. The
// deploy image is `node:22-slim`, which has neither.
//
// `better-sqlite3` 12 -> 13 was the trigger, and the mechanism is a packaging
// regression rather than anything about the code:
//
//   v12.11.1  "install": "prebuild-install || node-gyp rebuild --release"
//   v13.0.3   (no install script at all)
//
// A package with a `binding.gyp` and no install script makes npm run
// `node-gyp rebuild` itself, every time, on every machine. v12 downloads a
// prebuilt binary and only compiles as a fallback; v13 always compiles. On a
// machine with a toolchain that is invisible. On `node:22-slim` it is
//
//   gyp ERR! find Python — Could not find any Python installation to use
//
// and the deploy dies at `RUN npm ci`, before anything else runs.
//
// SO THE RULE IS ABOUT THE IMAGE, NOT THE LIBRARY. Any dependency that has to
// compile at install time is a dependency this image cannot install. The check
// below is deliberately narrow — it does not try to detect every native
// package, which would need a real install to know — it pins the one that
// caused the outage and states the constraint for the next person.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const pkg = JSON.parse(read("package.json")) as {
  dependencies: Record<string, string>;
};

test("the deploy image has no toolchain, so nothing may compile at install time", () => {
  // Stated from the Dockerfile rather than assumed. If somebody adds python3
  // and build-essential to the deps stage this constraint genuinely changes,
  // and this test should be the thing that makes them think about it.
  const dockerfile = read("Dockerfile");
  assert.match(dockerfile, /FROM node:\d+-slim AS deps/, "the deps stage is no longer a slim image");
  assert.ok(
    !/apt-get install[^\n]*(python|build-essential|g\+\+)/.test(dockerfile),
    "the deps stage now installs a toolchain — if that is deliberate, this rule is obsolete " +
    "and the reasoning at the top of this file needs rewriting rather than the test deleting"
  );
});

test("better-sqlite3 stays on a version that ships a prebuilt binary", () => {
  // v13 removed the install script that prefers a prebuild, so npm falls back
  // to its own `node-gyp rebuild` and the slim image has nothing to build
  // with. Reverted to v12 until upstream ships a v13 that does not compile on
  // every install; at the time of writing 13.0.3 is the newest and none do.
  const range = pkg.dependencies["better-sqlite3"];
  assert.ok(range, "better-sqlite3 is not a dependency");
  const major = Number(range.replace(/^[^\d]*/, "").split(".")[0]);
  assert.equal(
    major, 12,
    `better-sqlite3 is on v${major}. v13 has no install script, so npm runs node-gyp ` +
    "rebuild on every install and the deploy image cannot compile it — the production " +
    "deploy fails at `RUN npm ci` with \"gyp ERR! find Python\". Before moving to 13, " +
    "check that its package.json has an install script that prefers a prebuild."
  );
});

test("the installed package really does prefer a prebuild over compiling", () => {
  // The version range is a claim about the lockfile; this is the installed
  // reality. A guard on the range alone would pass against a v12 that had
  // changed its packaging.
  const installed = JSON.parse(
    read("node_modules/better-sqlite3/package.json")
  ) as { version: string; scripts?: Record<string, string> };
  const install = installed.scripts?.install ?? "";
  assert.match(
    install, /prebuild-install/,
    `better-sqlite3@${installed.version} does not run prebuild-install on install, so npm ` +
    "will compile it from source — which the deploy image cannot do"
  );
  // And the fallback is still there, so a platform with no prebuild is not
  // simply broken — it compiles, where it can.
  assert.match(install, /node-gyp rebuild/, "there is no compile fallback at all");
});

test("render.yaml deploys the trunk, not whatever branch was current", () => {
  // The service spent this project's life deploying a feature branch while
  // this file said `main`. That is a dashboard setting rather than a file, so
  // this cannot enforce it — but the file should at least say the right thing,
  // and a mismatch between them is worth finding here rather than by noticing
  // that a merge changed nothing.
  assert.match(read("render.yaml"), /branch:\s*main/, "render.yaml no longer targets main");
});
