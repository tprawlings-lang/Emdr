// The review console has something to review (§26 p44, §31.6 p99).
//
// A screen that is correct and empty demonstrates nothing. The four deciding
// screens are honest with no data — an empty queue, eight undecided gates —
// and that is a true picture of a deployment nobody has reviewed and shows
// none of the behaviour the screens exist for. This checks that the demo
// carries every state a reviewer needs to SEE, not merely that rows exist.
//
// The state that matters most is the reopened gate: a sign-off recorded
// against evidence that has since moved. It is the entire argument for binding
// a decision to a version, it cannot be produced by clicking through a fresh
// console, and without it seeded the demo shows approvals that look permanent.

process.env.EMDR_DATA_DIR = `/tmp/steady-revseed-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb } from "../src/lib/db";
import { RELEASE_GATES, resolveEvidence, fingerprint } from "../src/lib/review/gates";
import { decisionsAt, decisionHistory } from "../src/lib/review/decisions";
import { reviewableSurfaces, copyVersion } from "../src/lib/review/clinical-copy";
import { listAccessRequests } from "../src/lib/review/access";

async function gateStates() {
  const db = getDb();
  const surfaces = reviewableSurfaces();
  const cd = await decisionsAt("clinical_language", copyVersion());
  const tally = {
    total: surfaces.length,
    approved: surfaces.filter((s) => cd.get(s.id)?.decision === "approved").length,
    blocked: surfaces.filter((s) => cd.get(s.id)?.decision === "blocked").length,
    changesRequested: surfaces.filter((s) => cd.get(s.id)?.decision === "changes_requested").length,
  };
  const ev = resolveEvidence(db, { clinicalLanguage: tally });
  const out = new Map<string, string>();
  for (const g of RELEASE_GATES) {
    const fp = fingerprint(ev.get(g.id)!.facts);
    const inForce = (await decisionsAt("release_gate", fp)).get(g.id);
    const hist = await decisionHistory("release_gate", g.id);
    out.set(g.id, inForce ? inForce.decision : hist.length ? "reopened" : "undecided");
  }
  return { states: out, tally };
}

test("a gate signed off against evidence that has since moved reads as reopened", async () => {
  const { states } = await gateStates();
  const reopened = [...states].filter(([, v]) => v === "reopened").map(([k]) => k);
  assert.ok(
    reopened.length >= 1,
    "the demo must show at least one gate whose evidence changed after sign-off — it is the behaviour the whole design is for, and a reviewer cannot produce it by clicking"
  );
  // And it must be distinguishable from never-reviewed, or the demo makes the
  // opposite point: that an approval quietly persists.
  const history = await decisionHistory("release_gate", reopened[0]);
  assert.ok(history.length >= 1, "a reopened gate must still carry the sign-off it is reopened from");
  assert.equal(history[history.length - 1].decision, "approved");
});

test("the demo shows a gate approved at the evidence currently on screen", async () => {
  const { states } = await gateStates();
  const approved = [...states].filter(([, v]) => v === "approved");
  assert.ok(approved.length >= 1, "a console with no current approval cannot show what one looks like");
});

test("the demo shows undecided gates, and they do not resemble the decided ones", async () => {
  const { states } = await gateStates();
  const undecided = [...states].filter(([, v]) => v === "undecided");
  assert.ok(undecided.length >= 1, "some gates must be untouched, or 'not yet reviewed' has no on-screen meaning");
});

test("an attested gate carries a pointer to where its evidence lives", async () => {
  // Approving an attestation with nothing behind it is refused by the action;
  // the demo has to show the version that satisfies it, or the requirement is
  // invisible.
  const attested = RELEASE_GATES.filter((g) => g.evidenceClass === "attested").map((g) => g.id);
  let found = false;
  for (const id of attested) {
    const hist = await decisionHistory("release_gate", id);
    for (const d of hist) {
      if (d.decision === "approved" && typeof d.evidence.evidenceRef === "string" && d.evidence.evidenceRef.length > 0) found = true;
    }
  }
  assert.ok(found, "the demo must include one attested gate approved WITH its evidence reference");
});

test("clinical copy is mostly approved with the safety stop still under change", async () => {
  const { tally } = await gateStates();
  assert.equal(tally.total, 6, "the six gate states are the reviewable surfaces");
  assert.ok(tally.approved >= 4, "most copy approved, so the screen is not a wall of red");
  assert.equal(tally.changesRequested, 1, "one surface still moving, so the screen is not a wall of green either");

  const cd = await decisionsAt("clinical_language", copyVersion());
  const stop = cd.get("gate.safety_stop");
  assert.equal(stop?.decision, "changes_requested", "the sentence a member reads at the hardest moment is the realistic one to still be under review");
  assert.ok(stop?.rationale && stop.rationale.length > 0, "a change request carries the reason the action requires");
});

test("the clinical language gate does not pass while a surface is outstanding", async () => {
  const { states } = await gateStates();
  assert.notEqual(
    states.get("clinical_language"),
    "approved",
    "one surface under change request must keep the gate from reading as cleared — the gate reads the other screen so the two cannot disagree"
  );
});

test("access requests cover every state the screen can render", async () => {
  const rows = await listAccessRequests();
  assert.ok(rows.length >= 4, "expected the seeded requests");

  const pending = rows.filter((r) => !r.decision);
  const active = rows.filter((r) => r.decision?.decision === "approved" && !r.expired);
  const expired = rows.filter((r) => r.decision?.decision === "approved" && r.expired);
  const denied = rows.filter((r) => r.decision?.decision === "blocked");

  assert.ok(pending.length >= 1, "something must be awaiting a decision, or the queue is decorative");
  assert.ok(active.length >= 1, "an active grant");
  // The one most likely to be left out, and the one that teaches the most:
  // an approval whose window has closed is not access.
  assert.ok(expired.length >= 1, "an APPROVED BUT EXPIRED grant — approved and active must not look alike");
  assert.ok(denied.length >= 1, "a denial, which stays listed rather than vanishing");
  assert.ok(denied[0].decision?.rationale, "a denial carries its reason");
});

test("no seeded request is decided by the person who raised it", async () => {
  const rows = await listAccessRequests();
  for (const r of rows) {
    if (!r.decision) continue;
    assert.notEqual(
      r.decision.actorId,
      r.requestedBy,
      `${r.id} was decided by its own requester — the demo must not model the failure the screen refuses`
    );
  }
});
