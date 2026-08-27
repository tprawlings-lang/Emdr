// Account-creation gates (compliance packet 4A.7).
//
// These were covered only by an end-to-end spec that drove the public signup
// form. That form is now closed (Redesign handoff §12), so the coverage moved
// here rather than disappearing with the front door. The rule still runs — the
// server action is reachable by any future controlled-enrollment path — and a
// safety gate that loses its tests because the UI changed is how a safety gate
// quietly stops working.
//
// Unit coverage is also stricter than the browser test was: exact boundaries
// are checkable here, and a fixed `now` removes the date flake.

import { strict as assert } from "node:assert";
import test from "node:test";
import { checkAgeEligibility } from "../src/lib/age-gate";

const NOW = Date.parse("2026-08-27T12:00:00Z");
const yearsAgo = (y: number, extraDays = 0) =>
  new Date(NOW - (y * 365.25 + extraDays) * 86400000).toISOString().slice(0, 10);

test("minors are refused", () => {
  assert.equal(checkAgeEligibility(yearsAgo(10), NOW), "age");
  assert.equal(checkAgeEligibility(yearsAgo(17), NOW), "age");
});

test("the boundary is at 18, not near it", () => {
  // A day short of 18 is refused; a day past it is accepted. A gate that is
  // approximately right about a minor is not right.
  assert.equal(checkAgeEligibility(yearsAgo(18, -2), NOW), "age", "just under 18 was accepted");
  assert.equal(checkAgeEligibility(yearsAgo(18, 2), NOW), "ok", "just over 18 was refused");
});

test("adults are accepted", () => {
  assert.equal(checkAgeEligibility(yearsAgo(30), NOW), "ok");
  assert.equal(checkAgeEligibility(yearsAgo(80), NOW), "ok");
});

test("a missing or unparseable date of birth is refused, not defaulted", () => {
  assert.equal(checkAgeEligibility("", NOW), "dob");
  assert.equal(checkAgeEligibility("not-a-date", NOW), "dob");
  assert.equal(checkAgeEligibility("31/02/1990", NOW), "dob");
});

test("an implausible age is refused rather than trusted", () => {
  assert.equal(checkAgeEligibility(yearsAgo(130), NOW), "dob");
  // A future date of birth must not compute as a negative age that passes.
  assert.equal(checkAgeEligibility("2099-01-01", NOW), "age");
});
