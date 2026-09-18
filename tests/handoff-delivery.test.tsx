// UX 007: "Handoff workflow says it does not notify the recipient. Display
// delivery status honestly and surface pending work. Acceptance: proposal,
// delivery, receipt, and acceptance cannot be confused."
//
// The screen was honest and unreadable in the same sentence — "nobody has been
// notified, there is no delivery path in this build, so tell them" — which
// answered four questions at once. Has it been recorded? Has anything been
// sent? Have they seen it? Have they decided? A reader supplies whichever of
// the four they were expecting, and the two that matter most to somebody
// waiting on a transfer are the two that sentence did not distinguish.
//
// And the workflow then relied on the receiver opening a screen they had no
// reason to open, which is the same gap with a disclaimer in front of it.

process.env.EMDR_DATA_DIR = `/tmp/steady-handoffd-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "handoff-delivery-secret-at-least-32-chars";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "handoff-delivery-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { getDb, newId } from "../src/lib/db";
import { PLATFORM_TENANT_ID } from "../src/lib/tenancy";
import {
  proposeHandoff, resolveHandoff, handoffProgress, handoffsFor,
  HANDOFF_CHANNEL_CONFIGURED, type Handoff,
} from "../src/lib/clinical/handoff";
import { HandoffProgress } from "../src/components/clinical/HandoffProgress";
import { buildWorkQueue } from "../src/lib/clinical/work-queue";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ")
   .replace(/^\s*\/\/.*$/gm, " ");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const db = getDb();
function user(role: string, name: string): string {
  const id = newId();
  db.prepare(
    "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated')"
  ).run(id, PLATFORM_TENANT_ID, name);
  db.prepare(
    "INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', ?, ?)"
  ).run(id, PLATFORM_TENANT_ID, `${id}@handoffd.test`, role, name);
  return id;
}

const alice = user("clinician", "Alice");
const bob = user("clinician", "Bob");
const member = user("member", "Nadia");
const REASON = "On leave from the 14th and she has a session booked that week";

const handoff = (over: Partial<Handoff> = {}): Handoff => ({
  id: "h1", personId: member, personName: "Nadia",
  fromClinicianId: alice, fromName: "Alice",
  toClinicianId: bob, toName: "Bob",
  reason: REASON, dueAt: null, state: "proposed",
  createdAt: "2026-09-18 09:00:00", decidedAt: null, decidedNote: null,
  ...over,
});

// ---------------------------------------------------------------------------
// Four answers, not one
// ---------------------------------------------------------------------------

test("the four steps are four different answers", () => {
  const steps = handoffProgress(handoff());
  assert.deepEqual(steps.map((s) => s.step), ["proposal", "delivery", "receipt", "decision"]);

  const states = steps.map((s) => s.state);
  assert.equal(states[0], "done", "the proposal itself is not reported as recorded");
  assert.equal(states[1], "not_possible", "delivery reads as something that might yet happen");
  assert.equal(states[2], "not_recorded", "the product claims to know whether it was read");
  assert.equal(states[3], "pending");

  // The sentences differ too. Four steps sharing one sentence would be the
  // defect with more rows.
  assert.equal(new Set(steps.map((s) => s.said)).size, 4, "two steps say the same thing");
});

test("nothing claims a send, and nothing claims a read", () => {
  assert.equal(HANDOFF_CHANNEL_CONFIGURED, false,
    "a delivery channel is configured; if that is true it must be able to produce a receipt");

  for (const h of [handoff(), handoff({ state: "accepted", decidedAt: "2026-09-19 08:00:00" })]) {
    const [, delivery, receipt] = handoffProgress(h);
    assert.equal(delivery.at, null, "a delivery step carries a time with no receipt behind it");
    assert.equal(receipt.at, null, "a receipt step carries a time nothing recorded");
    assert.doesNotMatch(delivery.said, /\bsent to\b|\bnotified\b|\bdelivered to\b/i,
      `the delivery step implies a message reached somebody: "${delivery.said}"`);
    assert.match(receipt.said, /unknown|does not record/i,
      "the receipt step does not say that nothing records a read");
  }
});

test("an unanswered proposal is never evidence that the receiver knows", () => {
  const [, , receipt] = handoffProgress(handoff());
  assert.match(receipt.said, /not evidence/i,
    "the screen leaves 'they have not answered' to be read as 'they have seen it and are thinking'");
});

test("the decision step distinguishes accepted, declined and withdrawn", () => {
  const states = (["accepted", "declined", "withdrawn"] as const).map(
    (state) => handoffProgress(handoff({ state, decidedAt: "2026-09-19 08:00:00" }))[3]
  );
  assert.deepEqual(states.map((s) => s.state), ["done", "refused", "refused"]);
  assert.equal(new Set(states.map((s) => s.said)).size, 3,
    "declined and withdrawn read the same, and they are opposite halves of the transfer");
  for (const s of states) assert.equal(s.at, "2026-09-19 08:00:00");
});

// ---------------------------------------------------------------------------
// Rendered
// ---------------------------------------------------------------------------

test("each step's state is in words, never a glyph alone", () => {
  const body = text(renderToStaticMarkup(<HandoffProgress h={handoff()} />));
  for (const word of ["done", "not possible", "not known", "waiting"]) {
    assert.ok(body.includes(word), `the rendered steps do not say "${word}" anywhere`);
  }
  for (const label of ["Proposed", "Delivered", "Seen by the receiver", "Decision"]) {
    assert.ok(body.includes(label), `the step "${label}" is not rendered`);
  }
});

test("the screen reads the steps rather than writing its own sentence", () => {
  const page = code(read("src/app/clinician/handoffs/page.tsx"));
  assert.match(page, /<HandoffProgress/, "the handoffs screen no longer shows the steps");
  assert.ok(!/has not been told/.test(page),
    "the one sentence that answered four questions is back on the screen");
});

// ---------------------------------------------------------------------------
// Pending work is surfaced (the other half of UX 007)
// ---------------------------------------------------------------------------

test("a proposal reaches the receiver's queue, because nothing else will reach them", async () => {
  const proposed = await proposeHandoff({
    personId: member, fromClinicianId: alice, toClinicianId: bob,
    tenantId: PLATFORM_TENANT_ID, reason: REASON,
  });
  assert.equal(proposed.ok, true);

  const bobs = await buildWorkQueue({ clinicianId: bob, tenantId: PLATFORM_TENANT_ID });
  const row = bobs.items.find((i) => i.id.startsWith("handoff:"));
  assert.ok(row, "a transfer proposed to Bob is nowhere in Bob's day, so he learns of it by chance");
  assert.equal(row.group, "needs_action", "a decision Bob owes is not in the group he acts from");
  assert.equal(row.actionable, true,
    "Bob cannot answer a transfer addressed to him — the person is not on his caseload yet, " +
    "which is the whole reason for the transfer");
  assert.equal(row.safetyAuthority, false, "a transfer is carrying safety authority");
  assert.equal(row.ownerId, alice,
    "the queue reads the destination of an unanswered proposal as the owner, which is the " +
    "inference the handoff model exists to refuse");

  const alices = await buildWorkQueue({ clinicianId: alice, tenantId: PLATFORM_TENANT_ID });
  const mine = alices.items.find((i) => i.id.startsWith("handoff:"));
  assert.ok(mine, "Alice's own outstanding proposal is invisible to her");
  assert.equal(mine.group, "waiting_staff", "waiting on a colleague is filed as Alice's own action");
  assert.equal(mine.actionable, false);
  assert.match(mine.blockedReason ?? "", /Nobody has been notified/,
    "Alice is not told that her proposal is still sitting there unsent");
});

test("an answered transfer stops being work", async () => {
  const open = handoffsFor({ clinicianId: bob, tenantId: PLATFORM_TENANT_ID })
    .find((h) => h.state === "proposed");
  assert.ok(open, "no open transfer to answer");

  await resolveHandoff({
    handoffId: open.id, actorId: bob, tenantId: PLATFORM_TENANT_ID, outcome: "accepted",
  });

  for (const who of [alice, bob]) {
    const q = await buildWorkQueue({ clinicianId: who, tenantId: PLATFORM_TENANT_ID });
    assert.equal(q.items.filter((i) => i.id.startsWith("handoff:")).length, 0,
      "an answered transfer is still asking somebody to answer it");
  }
});
