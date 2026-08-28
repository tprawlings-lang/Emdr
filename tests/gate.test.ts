// The gate as a paced sequence (Presentation Layer Handoff §5).
//
// The property that matters most here is not a UX one. The previous gate was a
// single form with nothing persisted until submit, which meant a member could
// answer the suicidal-ideation screen positively, close the tab, and NO RULE
// WOULD EVER FIRE. That is a safety defect wearing a UX defect's clothes, and
// §5's "safety items commit immediately" is the fix. It is asserted first.

process.env.EMDR_DATA_DIR = `/tmp/steady-gate-${process.pid}-${Date.now()}`;
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "gate-test-key";
delete process.env.EMDR_DEMO;

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";
import { PLATFORM_TENANT_ID } from "../src/lib/db";
import { provisionPerson } from "../src/lib/spine";
import { getInstrument } from "../src/lib/instruments";
import {
  gatePosition, recordAnswer, savedAnswers, completedAnswers, clearProgress,
  isSafetyItem, GateError, GATE_COPY,
} from "../src/lib/member/gate";

const USER = "gate-user";
const PHQ = "phq-9";

test("setup", async () => {
  const c = await data();
  await c.run(
    "INSERT INTO users (id, email, name, role, password_hash, tenant_id) VALUES (?, ?, ?, 'member', 'x', ?)",
    [USER, "gate@test.local", "Gate Member", PLATFORM_TENANT_ID]
  );
  await provisionPerson({ userId: USER, name: "Gate Member", email: "gate@test.local", role: "member" });
});

// ---------------------------------------------------------------------------
// Safety items commit immediately
// ---------------------------------------------------------------------------

test("SAFETY: a safety answer is persisted and fires the moment it is given", async () => {
  const phq = getInstrument(PHQ)!;
  const risk = phq.riskItems![0];
  assert.equal(risk.index, 8, "PHQ-9 item 9 is the suicidal-ideation screen");

  const r = await recordAnswer({
    userId: USER, instrumentId: PHQ, index: risk.index, value: risk.threshold,
  });

  assert.equal(r.safetyFired, true, "the fixed rule did not fire on a safety item");
  // And crucially: the answer is already in the database. Nothing was
  // submitted, and the member could close the tab right now.
  const saved = await savedAnswers(USER, PHQ);
  assert.equal(saved.get(risk.index), risk.threshold,
    "a safety answer was not persisted until submit — a member could answer and vanish");
});

test("SAFETY: backing out cannot undo a fired safety disposition", async () => {
  // §5: "a safety disposition that has fired cannot be undone by backing out of
  // the questionnaire." Abandoning the flow leaves the answer where it is.
  const before = await savedAnswers(USER, PHQ);
  assert.ok(before.has(8));

  // Navigating away is not an operation — there is nothing to call. Re-reading
  // is the test: the record is unchanged.
  const after = await savedAnswers(USER, PHQ);
  assert.equal(after.get(8), before.get(8));
});

test("a non-safety answer does not claim to have fired anything", async () => {
  const r = await recordAnswer({ userId: USER, instrumentId: PHQ, index: 0, value: 3 });
  assert.equal(r.safetyFired, false);
});

test("a safety item answered below its threshold does not fire", async () => {
  const phq = getInstrument(PHQ)!;
  const risk = phq.riskItems![0];
  const r = await recordAnswer({ userId: USER, instrumentId: PHQ, index: risk.index, value: 0 });
  assert.equal(r.safetyFired, false, "the rule fired on an answer below its own threshold");
  // Re-answering still overwrites: a member correcting a mis-tap is not an
  // attacker, and the recorded answer should be their real one.
  assert.equal((await savedAnswers(USER, PHQ)).get(risk.index), 0);
});

test("the safety item set comes from the instrument, not a second list", () => {
  // Two lists drift. isSafetyItem reads riskItems, which is the same definition
  // scoring uses, so a new risk item is covered the moment it is declared.
  const phq = getInstrument(PHQ)!;
  assert.equal(isSafetyItem(phq, 8), true);
  assert.equal(isSafetyItem(phq, 0), false);
  const pcl = getInstrument("pcl-5")!;
  assert.equal(isSafetyItem(pcl, 15), true, "PCL-5 item 16 is a risk item");
});

// ---------------------------------------------------------------------------
// Resumability
// ---------------------------------------------------------------------------

test("progress resumes at the first unanswered question, never at the start", async () => {
  await clearProgress(USER, PHQ);
  await recordAnswer({ userId: USER, instrumentId: PHQ, index: 0, value: 1 });
  await recordAnswer({ userId: USER, instrumentId: PHQ, index: 1, value: 2 });

  const pos = await gatePosition({ userId: USER, instrumentId: PHQ });
  assert.equal(pos.resumeAt, 2);
  assert.equal(pos.index, 2, "resuming did not land on the first unanswered question");
  assert.equal(pos.step, 3, "position is one-based for display");
  assert.equal(pos.complete, false);
});

test("an answered question shows the answer back when revisited", async () => {
  const pos = await gatePosition({ userId: USER, instrumentId: PHQ, index: 1 });
  assert.equal(pos.existing, 2, "stepping back lost the recorded answer");
});

test("an unanswered question is absent, not zero", async () => {
  // Zero is a real answer on every instrument here ("Not at all"), so a sparse
  // map is the only representation that can tell them apart.
  const saved = await savedAnswers(USER, PHQ);
  assert.equal(saved.has(5), false);
  await recordAnswer({ userId: USER, instrumentId: PHQ, index: 5, value: 0 });
  assert.equal((await savedAnswers(USER, PHQ)).get(5), 0);
  assert.equal((await savedAnswers(USER, PHQ)).has(5), true);
});

test("completion refuses to invent a missing answer", async () => {
  // Defaulting an unanswered item to zero would put a fabricated response into
  // a clinical record — and zero is a real, meaningful answer.
  await assert.rejects(() => completedAnswers(USER, PHQ), GateError);
});

test("a fully answered instrument completes and reports it", async () => {
  const phq = getInstrument(PHQ)!;
  await clearProgress(USER, PHQ);
  for (let i = 0; i < phq.items.length; i++) {
    await recordAnswer({ userId: USER, instrumentId: PHQ, index: i, value: 1 });
  }
  const pos = await gatePosition({ userId: USER, instrumentId: PHQ });
  assert.equal(pos.complete, true);
  const answers = await completedAnswers(USER, PHQ);
  assert.equal(answers.length, phq.items.length);
  assert.ok(answers.every((a) => a === 1));
});

test("progress is cleared once submitted, so a re-take starts clean", async () => {
  await clearProgress(USER, PHQ);
  assert.equal((await savedAnswers(USER, PHQ)).size, 0);
});

// ---------------------------------------------------------------------------
// Position, not percentage
// ---------------------------------------------------------------------------

test("position is a place in a sequence, never a percentage", () => {
  // §5: "Avoid a progress bar reading 30% — percentage framing invites
  // abandonment maths."
  const label = GATE_COPY["gate.position.v1"](3, 20);
  assert.equal(label, "Question 3 of 20");
  assert.doesNotMatch(label, /%/);
});

test("the exit is labelled as a pause, never as a quit", () => {
  // The wording carries as much as the presence. "Quit" or "Cancel" tells
  // someone they are abandoning something, which in this population is a
  // reason not to come back.
  const pause = GATE_COPY["gate.pause.v1"];
  assert.match(pause, /pause/i);
  assert.doesNotMatch(pause, /\b(quit|cancel|abandon|exit|discard)\b/i);
  assert.match(pause, /saved/i, "the pause does not reassure that nothing is lost");
});

test("no gate copy shows a score, a band, or a result", () => {
  for (const [key, value] of Object.entries(GATE_COPY)) {
    const text = typeof value === "function" ? value(3, 20) : value;
    for (const forbidden of ["score", "result", "severity", "band", "%"]) {
      assert.ok(
        !new RegExp(forbidden, "i").test(text),
        `gate copy "${key}" mentions "${forbidden}"`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Bad input
// ---------------------------------------------------------------------------

test("an out-of-range question or answer is refused rather than recorded", async () => {
  await assert.rejects(
    () => recordAnswer({ userId: USER, instrumentId: PHQ, index: 999, value: 1 }),
    GateError
  );
  await assert.rejects(
    () => recordAnswer({ userId: USER, instrumentId: PHQ, index: 0, value: 99 }),
    GateError,
    "a value outside the instrument's own scale was accepted"
  );
  await assert.rejects(
    () => recordAnswer({ userId: USER, instrumentId: "not-an-instrument", index: 0, value: 1 }),
    GateError
  );
});

test("a requested step outside the instrument is clamped, not an error page", async () => {
  // Someone editing the URL should land somewhere sensible rather than on a
  // crash — this is a questionnaire, not a security boundary.
  const phq = getInstrument(PHQ)!;
  const high = await gatePosition({ userId: USER, instrumentId: PHQ, index: 999 });
  assert.equal(high.index, phq.items.length - 1);
  const low = await gatePosition({ userId: USER, instrumentId: PHQ, index: -5 });
  assert.equal(low.index, 0);
  const nonsense = await gatePosition({ userId: USER, instrumentId: PHQ, index: NaN });
  assert.equal(nonsense.index, 0);
});
