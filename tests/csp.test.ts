// The Content-Security-Policy (ADR 0003 → ADR 0008), and its one development
// relaxation.
//
// React's development build calls eval() and Next's dev server opens a hot-
// reload websocket. Under the production policy both are blocked with no
// visible error: the page renders, hydration never completes, and every client
// component on the site is inert. So development adds 'unsafe-eval' and the
// websocket, and nothing else.
//
// A relaxation that follows the build out the door is worse than the problem it
// solved, and it would look identical in every screenshot — so the production
// string is asserted here rather than trusted to a flag nobody rechecks.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";

import { contentSecurityPolicy } from "../src/proxy";

const NONCE = "dGVzdC1ub25jZQ==";

test("the production policy allows no eval and no websocket", () => {
  const csp = contentSecurityPolicy(NONCE, false);
  assert.ok(!csp.includes("unsafe-eval"), "production must never permit eval");
  assert.ok(!csp.includes("ws:"), "production needs no dev websocket");
  assert.ok(csp.includes(`script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`));
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(csp.includes("base-uri 'self'"));
  assert.ok(csp.includes("form-action 'self'"));
});

test("development adds exactly two things and moves nothing else", () => {
  const prod = contentSecurityPolicy(NONCE, false).split("; ").sort();
  const dev = contentSecurityPolicy(NONCE, true).split("; ").sort();
  assert.equal(dev.length, prod.length, "no directive is added or removed");

  const changed = dev.filter((d, i) => d !== prod[i]);
  assert.deepEqual(
    changed.map((d) => d.split(" ")[0]).sort(),
    ["connect-src", "script-src"],
    "only script-src and connect-src differ between the two"
  );
  assert.ok(contentSecurityPolicy(NONCE, true).includes("'unsafe-eval'"));
  assert.ok(contentSecurityPolicy(NONCE, true).includes("ws: wss:"));
});

// The switch has to be the build's own signal. A bespoke flag is a flag someone
// sets in the wrong environment; `next build` sets NODE_ENV to "production" and
// cannot be talked out of it.
test("the switch is NODE_ENV, and the default is the strict policy", () => {
  const src = fs.readFileSync("src/proxy.ts", "utf8");
  assert.ok(
    /const isDev = process\.env\.NODE_ENV !== "production"/.test(src),
    "development is the exception, defined against production"
  );
  assert.ok(
    !/EMDR_[A-Z_]*CSP|DISABLE_CSP|CSP_OFF/.test(src),
    "no environment variable may weaken the policy"
  );
  // Nothing but the two directives above may be conditional on it.
  const conditional = [...src.matchAll(/dev \? "([^"]*)"/g)].map((m) => m[1].trim());
  assert.deepEqual(conditional.sort(), ["'unsafe-eval'", "ws: wss:"].sort());
});

test("the nonce is per-response and reaches the script directive", () => {
  const a = contentSecurityPolicy("nonce-one");
  const b = contentSecurityPolicy("nonce-two");
  assert.ok(a.includes("'nonce-nonce-one'"));
  assert.ok(b.includes("'nonce-nonce-two'"));
  assert.notEqual(a, b);
});
