process.env.EMDR_DATA_DIR = `/tmp/steady-version-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "0";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "version-test-key";
process.env.EMDR_SESSION_SECRET = process.env.EMDR_SESSION_SECRET ?? "version-test-secret-not-real";

// Which build is answering.
//
// The endpoint exists because the question was unanswerable from outside, and
// the properties below are what keep it answerable honestly rather than
// confidently:
//
//   1. An unknown commit reads as null with a reason, never as a guess.
//   2. The platform's answer beats the baked one, and the report says which.
//   3. It carries no secret — not the enrollment code, not the session secret,
//      not the data key — and no member data.
//   4. It is never cached, because a cached answer to "what is running now"
//      describes the previous deployment with total confidence.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { versionReport } from "../src/lib/version";

const KEYS = ["RENDER_GIT_COMMIT", "RENDER_GIT_BRANCH", "EMDR_BUILD_COMMIT",
              "EMDR_BUILD_BRANCH", "EMDR_BUILD_TIME", "EMDR_ENROLLMENT_CODE"] as const;

/** Run with exactly this environment for the keys above. */
function withEnv<T>(env: Partial<Record<(typeof KEYS)[number], string>>, fn: () => T): T {
  const saved = KEYS.map((k) => [k, process.env[k]] as const);
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try { return fn(); } finally {
    for (const k of KEYS) delete process.env[k];
    for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
  }
}

test("an unknown commit is null with a reason, never a guess", () => {
  const r = withEnv({}, versionReport);
  assert.equal(r.commit, null);
  assert.equal(r.commitShort, null);
  assert.equal(r.source, "none");
  assert.match(r.detail, /cannot be identified/i, "the null is not explained");
  // The fallback signal still has to work, or "I don't know" is all it says.
  assert.ok(Date.parse(r.startedAt) > 0, "startedAt is unusable, so a redeploy cannot be told from a restart");
});

test("the platform's commit beats the baked one, and the report says which", () => {
  const both = withEnv(
    { RENDER_GIT_COMMIT: "a".repeat(40), EMDR_BUILD_COMMIT: "b".repeat(40) },
    versionReport,
  );
  assert.equal(both.commit, "a".repeat(40));
  assert.equal(both.source, "platform");

  const bakedOnly = withEnv({ EMDR_BUILD_COMMIT: "b".repeat(40) }, versionReport);
  assert.equal(bakedOnly.commit, "b".repeat(40));
  assert.equal(bakedOnly.source, "build");
  assert.match(bakedOnly.detail, /did not report/i);
});

test("the short commit is the long one, not a separately derived value", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const r = withEnv({ RENDER_GIT_COMMIT: sha }, versionReport);
  assert.equal(r.commitShort, sha.slice(0, 7));
  assert.ok(r.commit!.startsWith(r.commitShort!), "the two commit fields can disagree");
});

test("enrollment is reported as a boolean and the code never appears", () => {
  const secret = "super-secret-enrollment-code";
  const r = withEnv({ EMDR_ENROLLMENT_CODE: secret }, versionReport);
  assert.equal(r.environment.enrollmentOpen, true);
  assert.equal(JSON.stringify(r).includes(secret), false, "the enrollment code is in the version report");

  assert.equal(withEnv({}, versionReport).environment.enrollmentOpen, false);
});

test("no secret-shaped value reaches the report, whatever the environment holds", () => {
  // A GUARD AGAINST THE NEXT FIELD, not this one. The report is a tempting
  // place to add "just one more" operational value, and the one that gets
  // added carelessly is a key.
  const canaries: Record<string, string> = {
    EMDR_SESSION_SECRET: "canary-session-secret",
    EMDR_DATA_KEY: "canary-data-key",
    ANTHROPIC_API_KEY: "canary-api-key",
    DATABASE_URL: "postgres://canary:canary@host/db",
    R2_SECRET_ACCESS_KEY: "canary-r2-secret",
  };
  const saved = Object.keys(canaries).map((k) => [k, process.env[k]] as const);
  Object.assign(process.env, canaries);
  try {
    const json = JSON.stringify(withEnv({ RENDER_GIT_COMMIT: "c".repeat(40) }, versionReport));
    for (const [name, value] of Object.entries(canaries)) {
      assert.equal(json.includes(value), false, `${name} is exposed by /api/version`);
    }
  } finally {
    for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("the route is public, force-dynamic, and never cached", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src/app/api/version/route.ts"), "utf8");
  // PUBLIC ON PURPOSE. If a guard is ever added, the endpoint stops answering
  // the only question it exists for — what is deployed, asked from outside,
  // by someone who cannot sign in.
  assert.doesNotMatch(src, /requireUser|requireMember|requireClinician|requireDemoAdmin/,
    "the version endpoint became authenticated, so it can no longer answer from outside");
  assert.match(src, /force-dynamic/, "the route may be statically rendered at build time");
  assert.match(src, /no-store/, "a cached version report describes the previous deployment");
});
