process.env.EMDR_DATA_DIR = `/tmp/steady-caregate-${process.pid}-${Date.now()}`;

// The member care gate, as one definition (handoff 06 §30.6 step 4).
//
// WHAT THIS EXISTS FOR. Five member pages ran five different PREFIXES of the
// same four-step chain, and nineteen more ran none of it. `/app/today` checked
// subscription, consent, screening and profile; `/app/check-in` the first
// three; `/app/paths` the first; and `/app/progress`, `/app/plan`,
// `/app/settings` and `/app/learn` checked only that somebody was signed in. A
// member whose consent had been revoked could still read their plan.
//
// Found by the access inventory rather than by anybody noticing: nineteen
// member routes owed the consent step and showed no evidence of it. The member
// tree was the one console without a layout.
//
// TWO EXCEPTIONS, AND BOTH ARE EASY TO GET WRONG IN OPPOSITE DIRECTIONS.
//
//   A GATE DESTINATION CANNOT RUN THE GATE. `/app/onboarding` is where a member
//   with no consent is sent; checking consent there is an infinite redirect,
//   which the review console's own layout carries a scar about.
//
//   AN ACCOUNT SURFACE CANNOT RUN IT EITHER, and that one took a walk through
//   the signed-in routes to notice. The first version of this layout locked a
//   member who revoked consent out of the page showing what they revoked, out
//   of signing out everywhere, and out of closing their account.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  treatmentFor, redirectFor, firstFailure, GATE_ORDER, GATE_REDIRECT,
  GATE_DESTINATIONS, ACCOUNT_ROUTES, ALWAYS_OPEN,
} from "../src/lib/member/care-gate";
import { ROUTE_REGISTER } from "../src/lib/app/route-register";

const ROOT = path.join(__dirname, "..");
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

const memberFiles = () => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "page.tsx") out.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, "src/app/app"));
  return out.sort();
};

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

test("the chain is ordered, and the order is load-bearing", () => {
  // A member with no subscription is not asked for consent, and somebody who
  // has not consented is not asked to complete a screening. Each step also has
  // somewhere to send them.
  assert.deepEqual(GATE_ORDER, ["subscription", "consent", "screening", "profile"]);
  for (const step of GATE_ORDER) {
    assert.ok(GATE_REDIRECT[step]?.startsWith("/"), `${step} has nowhere to send anybody`);
  }
});

test("the first failure decides, not the last", () => {
  assert.equal(firstFailure({ subscription: false, consent: false }), "subscription");
  assert.equal(redirectFor({ subscription: false, consent: false }), "/subscribe");
  assert.equal(redirectFor({ subscription: true, consent: false }), "/app/onboarding");
  assert.equal(redirectFor({ subscription: true, consent: true, screening: false }), "/app/screening");
  assert.equal(
    redirectFor({ subscription: true, consent: true, screening: true, profile: false }),
    "/app/onboarding/profile"
  );
  assert.equal(redirectFor({ subscription: true, consent: true, screening: true, profile: true }), null);
});

test("a step nobody answered does not fail the gate", () => {
  // The layout stops querying at the first failure, so the later steps are
  // genuinely unknown rather than false. Treating unknown as failed would send
  // a member to a screen they had already finished.
  assert.equal(firstFailure({ subscription: true }), null);
  assert.equal(redirectFor({}), null);
});

// ---------------------------------------------------------------------------
// The two exceptions
// ---------------------------------------------------------------------------

test("a gate destination runs authentication and nothing else", () => {
  // Or it sends a member without consent to itself, forever.
  for (const p of GATE_DESTINATIONS) {
    assert.equal(treatmentFor(p), "authenticate_only", `${p} runs the gate that sends people to it`);
    assert.equal(treatmentFor(`${p}/profile`), "authenticate_only", `${p}/… runs the gate`);
  }
});

test("an account surface is reachable whatever the gate says", () => {
  // THE TRAP THE FIRST VERSION OF THIS SET. These are where somebody goes to
  // inspect or change the very things the gate checks — what they agreed to,
  // who can see their record, and how to close the account. Gating them behind
  // those answers locks a member out of the only controls that act on the gate.
  for (const p of ACCOUNT_ROUTES) {
    assert.equal(treatmentFor(p), "authenticate_only", `${p} is gated behind the thing it changes`);
  }
  assert.equal(treatmentFor("/app/settings/account"), "authenticate_only");
  assert.equal(treatmentFor("/app/settings/billing"), "authenticate_only");
  // And nothing under them re-imposes the consent check one level down.
  for (const rel of memberFiles()) {
    const isAccount = ACCOUNT_ROUTES.some((p) => rel.startsWith(`src/app${p}/`) || rel === `src/app${p}/page.tsx`);
    if (!isAccount) continue;
    assert.ok(
      !/hasConsent\(/.test(code(rel)),
      `${rel} is an account surface and still redirects on consent, which is the same trap one level down`
    );
  }
});

test("grounding needs no account at all", () => {
  // There is no condition in which support is withdrawn. A layout calling
  // `requireMember` here would send a signed-out person in distress to the
  // login page, which is the one thing this route exists not to do.
  assert.deepEqual([...ALWAYS_OPEN], ["/app/ground"]);
  assert.equal(treatmentFor("/app/ground"), "open");
  const layout = code("src/app/app/layout.tsx");
  const open = layout.indexOf('treatment === "open"');
  const auth = layout.indexOf("requireMember(");
  assert.ok(open > 0 && open < auth, "the layout authenticates before it lets the open routes through");
});

test("an ordinary care route runs the whole chain", () => {
  for (const p of ["/app/today", "/app/progress", "/app/plan", "/app/learn", "/app/companion", "/app/check-in"]) {
    assert.equal(treatmentFor(p), "full_chain", `${p} is not gated`);
  }
});

// ---------------------------------------------------------------------------
// One definition
// ---------------------------------------------------------------------------

test("no care page runs its own prefix of the chain", () => {
  // The defect itself: five prefixes of one chain, drifting. A page that keeps
  // its own copy is a page that can fall behind the layout.
  const offenders: string[] = [];
  for (const rel of memberFiles()) {
    const route = "/" + path.relative("src/app", path.dirname(rel));
    if (treatmentFor(route) !== "full_chain") continue;
    const src = code(rel);
    for (const marker of ["subscriptionActive(", "hasConsent(", "screeningComplete(", "profileComplete("]) {
      if (src.includes(marker)) offenders.push(`${rel} — ${marker}`);
    }
  }
  assert.deepEqual(offenders, [], `these gated pages keep their own copy of the chain:\n  ${offenders.join("\n  ")}`);
});

test("the layout is the only place the chain is assembled", () => {
  const layout = code("src/app/app/layout.tsx");
  for (const marker of ["subscriptionActive(", "hasConsent(", "screeningComplete(", "profileComplete("]) {
    assert.ok(layout.includes(marker), `the layout no longer checks ${marker}`);
  }
  assert.match(layout, /x-pathname/, "the layout cannot tell which route it is wrapping");
  assert.match(layout, /treatmentFor\(/);
  assert.match(layout, /redirectFor\(/);
});

test("the gate stops querying at the first failure", () => {
  // Four sequential awaits on every member render is four queries where one
  // answer would do, and asking somebody with no subscription about their
  // consent is also the wrong reading of the chain.
  const layout = code("src/app/app/layout.tsx");
  assert.match(layout, /for \(const step of GATE_ORDER\)/);
  assert.match(layout, /break;/, "the layout runs every step regardless of the first answer");
});

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

test("every member route in the register gets a treatment", () => {
  // A route that matched nothing would fall through to the full chain, which is
  // the safe default — but a route that should have been an account surface and
  // silently became a gated one is a member locked out.
  const members = ROUTE_REGISTER.filter((r) => r.audience === "member" && r.path.startsWith("/app"));
  assert.ok(members.length >= 30, `only ${members.length} member routes in the register`);
  const treatments = new Set(members.map((r) => treatmentFor(r.path)));
  for (const t of ["open", "authenticate_only", "full_chain"] as const) {
    assert.ok(treatments.has(t), `no member route is treated as ${t}, so that branch is untested by the register`);
  }
});
