// Reading back the sign-off a reviewer already gave.
//
// `resolveEvidence` returned `unavailable` for all three attested gates
// unconditionally, with a summary saying the attestation was "recorded with a
// reference to the evidence". IT WAS. `signOffGate` requires a reviewer,
// computes the gate's fingerprint, refuses a sign-off made against a stale
// one, records the decision with its evidence reference, and audits it. The
// form has been on the release console the whole time. Nothing read it back,
// so a reviewer could sign a gate and the gate would go on saying nobody had.
//
// THE THIRD INSTANCE OF ONE DEFECT IN A WEEK — a write with no reader, after
// `requestUnlock`/`decideUnlock` and after `assignWork` — and the one that
// mattered most, because these gates decide whether a deployment may hold real
// people.
//
// A FIRST ATTEMPT BUILT A SECOND TABLE for this, with every column
// `review_decisions` already had. It was deleted: a store for something that
// exists is the failure the work register was written to catch.

process.env.EMDR_DATA_DIR = `/tmp/steady-attest-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "0";
process.env.EMDR_SESSION_SECRET = "attest-test-secret-at-least-32-characters";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "attest-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb } from "../src/lib/db";
import { data } from "../src/lib/data";
import {
  allAttestations, attestationState, ATTESTED_GATES, currentFingerprint, isAttestedGate,
} from "../src/lib/governance/attestation";
import { resolveEvidence, RELEASE_GATES } from "../src/lib/review/gates";

const db = getDb();
const REVIEWER = "u-attest-reviewer";
db.prepare(
  "INSERT OR IGNORE INTO users (id, email, name, role, password_hash) VALUES (?, ?, 'Dr Ellis Nakamura', 'reviewer', 'x')"
).run(REVIEWER, "attest-reviewer@example.test");

/** A decision recorded exactly the way `signOffGate` records one. */
async function signOff(gateId: string, opts: {
  decision?: "approved" | "blocked" | "changes_requested";
  fingerprint?: string;
  evidenceRef?: string | null;
  rationale?: string | null;
  at?: string;
} = {}) {
  const c = await data();
  const fp = opts.fingerprint ?? currentFingerprint(gateId);
  await c.run(
    `INSERT INTO review_decisions
       (id, subject_kind, subject_id, subject_version, decision, rationale, evidence_json,
        actor_id, actor_role, created_at)
     VALUES (?, 'release_gate', ?, ?, ?, ?, ?, ?, 'reviewer', ?)`,
    [
      `d-${gateId}-${Math.random().toString(36).slice(2)}`, gateId, fp,
      opts.decision ?? "approved", opts.rationale ?? null,
      // `??` WOULD SWALLOW AN EXPLICIT NULL, collapsing "the caller said
      // nothing" into "the caller said there is no reference" — which is the
      // exact distinction the test below is about.
      JSON.stringify({
        fingerprint: fp, evidenceClass: "attested",
        evidenceRef: "evidenceRef" in opts ? opts.evidenceRef : "docs/approvals/a11y.md",
      }),
      REVIEWER, opts.at ?? "2026-09-19 09:00:00",
    ]
  );
}

async function clearDecisions() {
  const c = await data();
  await c.run("DELETE FROM review_decisions WHERE subject_kind = 'release_gate'", []);
}

test("with nothing signed, an attested gate is unavailable rather than passing", async () => {
  await clearDecisions();
  const ev = resolveEvidence(db, { attestations: await allAttestations() });
  for (const id of ATTESTED_GATES) {
    assert.equal(ev.get(id)?.status, "unavailable", `${id} passed with nobody having signed it`);
  }
});

test("omitting the sign-offs entirely does not pass a gate", async () => {
  // THE DEFAULT HAS TO BE UNSIGNED. A caller that forgets to supply them is the
  // likeliest way this goes wrong, and it must fail toward unavailable.
  const ev = resolveEvidence(db);
  for (const id of ATTESTED_GATES) {
    assert.equal(ev.get(id)?.status, "unavailable", `${id} passed because a caller omitted a map`);
  }
});

test("a gate a reviewer approved passes, and says who and where the evidence is", async () => {
  await clearDecisions();
  await signOff("accessibility", { evidenceRef: "docs/approvals/a11y-2026-09-19.md" });

  assert.equal((await attestationState("accessibility")).status, "current");
  const ev = resolveEvidence(db, { attestations: await allAttestations() });
  const a11y = ev.get("accessibility")!;
  assert.equal(a11y.status, "pass", "a signed gate still reads as unsigned");
  assert.match(a11y.summary, /reviewer/, "the summary does not say who signed it");
  assert.match(a11y.summary, /a11y-2026-09-19/, "the summary does not say where the evidence is");
  // AND ONLY THAT GATE. Signing one must never carry the others.
  assert.equal(ev.get("authorization")?.status, "unavailable");
  assert.equal(ev.get("analytics_integrity")?.status, "unavailable");
});

test("a sign-off expires when what it was signed against moves", async () => {
  // THE WHOLE POINT. A sign-off that stays green after the thing it was about
  // changes is worse than no sign-off, because somebody trusts it. Nobody has
  // to remember to revoke anything: the decision carries the fingerprint it was
  // made against, and `decisionsAt` only returns decisions made against what is
  // true now.
  await clearDecisions();
  await signOff("authorization", { fingerprint: "a-fingerprint-from-last-month" });
  assert.equal(
    (await attestationState("authorization")).status, "unsigned",
    "a sign-off against versions that have since moved still counted",
  );
  const ev = resolveEvidence(db, { attestations: await allAttestations() });
  // NOT `fail`. An expired approval and a broken check are different facts, and
  // a reviewer taught that red means "somebody bumped a version" stops reading
  // red at all.
  assert.equal(ev.get("authorization")?.status, "unavailable");
});

test("a reviewer who refused is not the same as nobody having looked", async () => {
  // Opposite facts that rendered as the same grey cell until the record was
  // read back.
  await clearDecisions();
  await signOff("analytics_integrity", {
    decision: "blocked", rationale: "Denominators are not stated on two screens.",
  });
  const state = await attestationState("analytics_integrity");
  assert.equal(state.status, "refused");
  const ev = resolveEvidence(db, { attestations: await allAttestations() });
  const g = ev.get("analytics_integrity")!;
  assert.equal(g.status, "unavailable");
  assert.match(g.summary, /blocked/i, "a blocked gate reads as though nobody had reviewed it");
  assert.match(g.summary, /Denominators/, "the reviewer's reason is not shown");
});

test("the newest decision against the current versions is the one in force", async () => {
  await clearDecisions();
  await signOff("accessibility", { decision: "blocked", at: "2026-09-01 09:00:00" });
  await signOff("accessibility", { decision: "approved", at: "2026-09-10 09:00:00" });
  assert.equal(
    (await attestationState("accessibility")).status, "current",
    "an older refusal outranked a newer approval",
  );
});

test("an approval with no evidence reference says so rather than implying one", async () => {
  // The gate's own summary promises "a reference to the evidence". An approval
  // recorded without one still passes — the reviewer approved it — but the
  // screen must not read as though evidence was cited.
  await clearDecisions();
  await signOff("accessibility", { evidenceRef: null });
  const ev = resolveEvidence(db, { attestations: await allAttestations() });
  assert.equal(ev.get("accessibility")?.status, "pass");
  assert.match(ev.get("accessibility")!.summary, /no evidence reference was given/i);
});

test("only the three unmeasurable gates are attestable", () => {
  // A signature must never be able to override a measurement. `safety_regression`
  // is replayed by the system; treating it as attestable would let a name beat
  // the replay.
  for (const g of RELEASE_GATES) {
    const expected = ["authorization", "accessibility", "analytics_integrity"].includes(g.id);
    assert.equal(isAttestedGate(g.id), expected, `${g.id} is attestable: ${!expected}`);
    if (expected) assert.equal(g.evidenceClass, "attested", `${g.id} is attestable and not declared so`);
    else assert.notEqual(g.evidenceClass, "attested", `${g.id} is declared attested and not attestable`);
  }
});

test("no second store was built for this", () => {
  // A first attempt added a `gate_attestations` table with every column
  // `review_decisions` already had, including the fingerprint binding. Two
  // records of one fact disagree the first time either moves, and this codebase
  // has a register whose whole subject is claims nobody re-read.
  const schema = getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>;
  assert.ok(
    !schema.some((t) => t.name === "gate_attestations"),
    "a second attestation store exists alongside review_decisions",
  );
});
