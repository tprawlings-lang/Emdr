import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newResourcing, begin, advancePrep, completeSet, answerBetween, groundMe,
  completeClosure, canRunSet, RESOURCING_PREP_COUNT,
} from "../src/lib/safety/resourcing-session.ts";
import { BLS_RESOURCING, SESSION } from "../src/lib/safety/config.ts";

function afterPrep() {
  let s = begin(newResourcing());
  for (let i = 0; i < RESOURCING_PREP_COUNT; i++) s = advancePrep(s);
  return s; // now at first set
}

test("resourcing session: prep runs then reaches the first set", () => {
  const s = afterPrep();
  assert.equal(s.phase, "set");
  assert.equal(canRunSet(s), true);
});

test("resourcing session: a set goes to the between-set check (never auto-continues)", () => {
  const s = completeSet(afterPrep());
  assert.equal(s.phase, "between");
});

test("resourcing session: an unpleasant resource stops to closure (never pushed)", () => {
  const s = answerBetween(completeSet(afterPrep()), false);
  assert.equal(s.phase, "closure");
  assert.equal(s.stopped, true);
  assert.equal(s.reason, "resource_unpleasant");
});

test("resourcing session: closes after the max number of short sets", () => {
  let s = afterPrep();
  for (let i = 0; i < BLS_RESOURCING.maxSets; i++) {
    s = answerBetween(completeSet(s), true);
  }
  assert.equal(s.phase, "closure");
  assert.equal(s.setsCompleted, BLS_RESOURCING.maxSets);
});

test("resourcing session: Ground-Me halts straight to closure, no return", () => {
  const s = groundMe(afterPrep());
  assert.equal(s.phase, "closure");
  assert.equal(s.stopped, true);
  assert.equal(canRunSet(s), false);
});

test("resourcing session: closure enforces the mandatory minimum duration", () => {
  const closing = { ...afterPrep(), phase: "closure" as const };
  assert.equal(completeClosure(closing, SESSION.closureMinSeconds - 1).phase, "closure");
  assert.equal(completeClosure(closing, SESSION.closureMinSeconds).phase, "completed");
});
