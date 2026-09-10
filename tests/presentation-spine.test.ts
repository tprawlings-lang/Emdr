// The presentation spine (Web GUI handoff §30.8, §30.4, §15.1, §20.2).
//
// Wave 1's contract. Three properties, each of which this codebase has already
// got wrong once at some level:
//
//   1. Empty and failed must not be the same state. A page that maps over an
//      array renders a blank box for both. The first is good news; the second
//      is a user working from nothing while believing they are current, and it
//      fails silently.
//   2. A high-impact action cannot report success without proof it committed.
//      §15.1 forbids optimistic completion; the notification-truth defect was
//      the same mistake in a different place — a claim derived from an
//      attempted write.
//   3. Today carries one primary action and at most two alternatives. §3.4
//      found the old Home was a content catalog, and a catalog is reached one
//      reasonable addition at a time.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  ready, empty, stale, partial, permissionDenied, projectionFailed,
  policyUnavailable, auditUnavailable, hasData, decisionAllowed, supportReachable,
  EnvelopeError, type ProjectionMeta, type PresentationState,
} from "../src/lib/presentation/envelope";
import {
  committed, isHighImpact, idempotencyKey, HIGH_IMPACT,
  ActionContractError, type ActionResult,
} from "../src/lib/presentation/action";
import { assertTodayShape, MemberTodayError, type MemberToday } from "../src/lib/member/today";

const META: ProjectionMeta = {
  schemaVersion: "test.v1", projectionVersion: "test.v1+p", generatedAt: "2026-08-28 10:00:00",
  tenantId: "t1", sourceWatermark: null, policyVersion: "p1",
};

// ---------------------------------------------------------------------------
// §30.8 — the eight states
// ---------------------------------------------------------------------------

test("all eight §30.8 states are constructible and distinct", () => {
  const states: PresentationState[] = [
    ready(META, 1).state, empty<number>(META, "none yet").state,
    stale(META, 1, "2026-08-27 09:00:00", "feed behind").state,
    partial(META, 1, [{ source: "measures", reason: "feed lagging" }]).state,
    permissionDenied<number>(META).state, projectionFailed<number>(META, "abc").state,
    policyUnavailable<number>(META).state, auditUnavailable<number>(META).state,
  ];
  assert.equal(new Set(states).size, 8, `states collapsed: ${states.join(", ")}`);
});

test("empty and failed are different states and only one carries data", () => {
  const e = empty<number>(META, "no open work today");
  const f = projectionFailed<number>(META, "corr-1");
  assert.notEqual(e.state, f.state);
  assert.equal(hasData(e), false);
  assert.equal(hasData(f), false);
  // The failed envelope must not carry anything that could be rendered as
  // content — §30.8 forbids a fallback to raw domain tables, and data on a
  // failed envelope is how that fallback gets written.
  assert.equal(f.data, undefined, "a failed projection carries data a page could render");
  assert.ok(e.reason && /no open work/i.test(e.reason));
});

test("an empty projection must say what is absent", () => {
  assert.throws(() => empty<number>(META, "  "), EnvelopeError);
});

test("stale data must say when it was last current", () => {
  assert.throws(() => stale(META, 1, "", "feed behind"), EnvelopeError);
  const s = stale(META, 1, "2026-08-27 09:00:00", "feed behind");
  assert.equal(hasData(s), true, "stale still carries its last good value (§30.8)");
  assert.equal(decisionAllowed(s), false, "stale must block decisions that need current data");
});

test("a partial projection with nothing missing is a contradiction", () => {
  assert.throws(() => partial(META, 1, []), EnvelopeError);
  const p = partial(META, 1, [{ source: "claims", reason: "feed lagging" }]);
  assert.equal(hasData(p), true);
  assert.equal(p.missing?.length, 1, "§30.8 requires the missing sources be listed");
});

test("a denial leaks no subject and no reason detail", () => {
  const d = permissionDenied<number>(META);
  // §26: "Denied and missing pages do not reveal protected existence." The
  // constructor takes no subject, so there is nothing to leak by accident.
  assert.doesNotMatch(d.reason ?? "", /exist|found|record|person|member/i);
});

test("the two safety states fail closed", () => {
  for (const e of [policyUnavailable<number>(META), auditUnavailable<number>(META)]) {
    assert.equal(decisionAllowed(e), false, `${e.state} allowed a decision`);
    assert.equal(hasData(e), false);
  }
  // Policy unavailable must not read as "nothing available today" — that is a
  // different and false statement to a member.
  assert.match(policyUnavailable<number>(META).reason ?? "", /paused/i);
  assert.match(policyUnavailable<number>(META).reason ?? "", /grounding|support/i);
});

test("support is reachable in every state", () => {
  // §1: grounding and crisis survive "a write, subscription, sync, or service
  // failure" — which is exactly when they are needed.
  for (const e of [
    ready(META, 1), empty<number>(META, "x"), stale(META, 1, "t", "r"),
    partial(META, 1, [{ source: "s", reason: "r" }]), permissionDenied<number>(META),
    projectionFailed<number>(META, "c"), policyUnavailable<number>(META), auditUnavailable<number>(META),
  ]) {
    assert.equal(supportReachable(e), true);
  }
});

test("the renderer handles all eight states", () => {
  // A page that handles six and leaves two as a blank screen is the defect.
  const src = fs.readFileSync(path.join(process.cwd(), "src/components/presentation/EnvelopeView.tsx"), "utf8");
  const block = /const STYLE:[\s\S]*?\n};/.exec(src);
  assert.ok(block, "no state style map in EnvelopeView");
  for (const s of ["loading","ready","empty","stale","partial","permission_denied",
                   "projection_failed","policy_unavailable","audit_unavailable"]) {
    assert.match(block![0], new RegExp(`\\b${s}\\s*:`), `EnvelopeView does not render "${s}"`);
    // Colour never carries meaning alone (§12.2).
    }
  const lines = block![0].split("\n").filter((l) => /cls:/.test(l));
  for (const l of lines) {
    assert.match(l, /glyph:/, `a state carries colour with no glyph: ${l.trim()}`);
    assert.match(l, /label:/, `a state carries colour with no label: ${l.trim()}`);
  }
});

test("support paths render in every non-ready state, for the reader who might need one", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/components/presentation/EnvelopeView.tsx"), "utf8");

  // The original rule was "not conditional on anything but the state". That
  // was right about the thing it was protecting — the way out must never
  // narrow because something failed — and wrong about one case: an
  // organization capacity screen rendering `partial` offered its operations
  // analyst grounding and crisis support. There is no person on that screen.
  //
  // So the rule is now narrower and more exact. Support is UNCONDITIONAL on
  // state, and conditional ONLY on audience, which defaults to "person" so a
  // surface that forgets keeps the links. Both halves are checked, because
  // dropping either is how this becomes a gate on failure again.
  assert.match(src, /state !== "ready" && audience === "person" && <SupportPaths/,
    "support is conditional on something other than 'not ready' and the audience");
  assert.match(src, /audience = "person"/,
    "audience does not default to person — a surface that forgets must keep the way out");
  assert.match(src, /\/crisis/, "the crisis path is not in the state notice");

  // And it must not become conditional on the state again by another route.
  assert.doesNotMatch(src, /state === "(stale|partial|empty)"[^\n]*SupportPaths/,
    "support is being narrowed to particular failure states");
});

// ---------------------------------------------------------------------------
// §30.4 / §15.1 — action responses
// ---------------------------------------------------------------------------

const RESULT: ActionResult = {
  action: "review", committedEventId: "e1", auditEventId: "a1",
  projectionVersion: "v1", effectiveAt: "2026-08-28 10:00:00",
  resultingState: "reviewed", followUp: [], failedDeliveries: [],
};

test("a result cannot claim success without the ids that prove it committed", () => {
  assert.doesNotThrow(() => committed(RESULT));
  for (const k of ["committedEventId", "auditEventId", "projectionVersion", "effectiveAt"] as const) {
    assert.throws(() => committed({ ...RESULT, [k]: "" }), ActionContractError, `${k} was not required`);
    assert.throws(() => committed({ ...RESULT, [k]: "   " }), ActionContractError, `${k} accepted whitespace`);
  }
});

test("every clinical action that changes a record is high-impact", () => {
  // §15.1's list. An action missing from here may complete optimistically,
  // which on a safety response is the difference between a documented response
  // and an undocumented one.
  for (const a of ["review","assign","handoff","correct","approve_model_text",
                   "document_safety_response","export"] as const) {
    assert.equal(isHighImpact(a), true, `${a} is not marked high-impact`);
  }
  assert.equal(isHighImpact("acknowledge"), false);
});

test("no action type can clear a safety stop", () => {
  // §27.5: "Safety stops have no ordinary override action. Re-entry is a new
  // fixed-rule evaluation, not a clinician button that clears history."
  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/presentation/action.ts"), "utf8");
  const block = /export type ActionType[\s\S]*?;/.exec(src);
  assert.ok(block);
  assert.doesNotMatch(block![0], /override|clear|reopen|reset/i,
    "an action type looks like it could clear a fixed gate");
  assert.ok(!HIGH_IMPACT.some((a) => /override/i.test(a)));
});

test("idempotency keys distinguish actor, subject and action", () => {
  const base = { actorId: "c1", subjectId: "p1", action: "review" as const, nonce: "n" };
  const k = idempotencyKey(base);
  assert.notEqual(k, idempotencyKey({ ...base, actorId: "c2" }));
  assert.notEqual(k, idempotencyKey({ ...base, subjectId: "p2" }));
  assert.notEqual(k, idempotencyKey({ ...base, action: "assign" }));
  assert.equal(k, idempotencyKey(base), "the same action does not resolve to one key");
});

// ---------------------------------------------------------------------------
// §20.2 — the member Today cap
// ---------------------------------------------------------------------------

const TODAY: MemberToday = {
  shape: "open", messageKey: "day.open",
  primary: { id: "a", label: "A", href: "/app/session/a", minutes: 5, why: "because" },
  alternatives: [], support: { label: "Get support", href: "/crisis" },
  companion: { label: "Talk it through with the companion", href: "/app/companion" },
  checkinDue: false,
};

test("Today allows one primary and at most two alternatives", () => {
  assert.doesNotThrow(() => assertTodayShape(TODAY));
  assert.doesNotThrow(() => assertTodayShape({ ...TODAY, alternatives: [
    { id: "b", label: "B", href: "/x", minutes: 2, why: "w" },
    { id: "c", label: "C", href: "/y", minutes: 2, why: "w" },
  ]}));
  assert.throws(() => assertTodayShape({ ...TODAY, alternatives: [
    { id: "b", label: "B", href: "/x", minutes: 2, why: "w" },
    { id: "c", label: "C", href: "/y", minutes: 2, why: "w" },
    { id: "d", label: "D", href: "/z", minutes: 2, why: "w" },
  ]}), MemberTodayError, "a third alternative was accepted; that is the catalog returning");
});

test("Today never repeats its primary action as an alternative", () => {
  assert.throws(() => assertTodayShape({ ...TODAY, alternatives: [
    { id: "a", label: "A again", href: "/x", minutes: 5, why: "w" },
  ]}), MemberTodayError);
});

test("Today always carries a support path", () => {
  assert.throws(
    () => assertTodayShape({ ...TODAY, support: undefined as never }),
    MemberTodayError
  );
});

test("the member projection carries no score-bearing field", () => {
  // The boundary still holds through the new projection: member_today composes
  // buildMemberDay and re-runs assertNoScores rather than reaching around it.
  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/member/today.ts"), "utf8");
  assert.match(src, /assertNoScores/, "member_today bypasses the member boundary");
  const shape = /export interface MemberToday \{[\s\S]*?\n\}/.exec(src);
  assert.ok(shape);
  for (const forbidden of ["score", "band", "track", "severity", "readiness", "percent"]) {
    assert.doesNotMatch(shape![0], new RegExp(`\\b\\w*${forbidden}\\w*\\s*[?]?:`, "i"),
      `MemberToday exposes a ${forbidden}-bearing field`);
  }
});
