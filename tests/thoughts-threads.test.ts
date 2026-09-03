// Clinician Thoughts Phase 3 — threads, matching and the Connect decision.
//
// Phase 3's definition of done is three lines and two of them are about what
// the system must not do on its own:
//
//   No auto-link in v1.
//   Rejected links remain rejected unless a clinician deliberately revisits.
//   Thread evidence always opens source.
//
// The second is the one most easily lost by accident. Nobody writes "re-suggest
// the thing they refused"; it happens because the matcher runs again next week
// over the same data and nothing remembers the answer.

process.env.EMDR_DATA_DIR = `/tmp/steady-threads-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "threads-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "threads-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb } from "../src/lib/db";
import type { TenantContext } from "../src/lib/repository";
import {
  createThread, proposeMembership, acceptMembership, rejectMembership,
  revisitMembership, membershipsFor, threadTimeline,
  DuplicateMembershipError, NotProposedError,
} from "../src/lib/clinical/thread-store";
import { matchItemToThreads, scoreThread } from "../src/lib/clinical/thread-match";
import {
  combine, sourceReliability,
  PROPOSE_THRESHOLD, MAX_PROPOSALS_PER_ITEM, RETRIEVAL_POLICY_VERSION, AVAILABLE, WEIGHTS,
} from "../src/lib/clinical/retrieval-policy";
import { getItem } from "../src/lib/clinical/memory-store";
import { getTask } from "../src/lib/ai-gateway/registry";
import type { MemoryItem } from "../src/lib/clinical/memory-store";

const db = getDb();
const T = { tenant: "tenant-thr", clinician: "clin-thr", patient: "pat-thr" };
db.prepare("INSERT OR IGNORE INTO tenants (id, kind, name) VALUES (?, 'organization', ?)").run(T.tenant, T.tenant);
for (const id of [T.clinician, T.patient]) {
  db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'X', 'fabricated')")
    .run(id, T.tenant);
}
const ctx: TenantContext = { tenantId: T.tenant, personId: T.clinician };
const NOW = Date.parse("2026-09-03T12:00:00Z");

/** A memory item shaped for the matcher, without going through a whole thought. */
function anItem(over: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: `item-${Math.random().toString(36).slice(2, 10)}`,
    personId: T.patient,
    sourceThoughtId: "th1",
    sourceTranscriptId: "tr1",
    itemType: "symptom",
    statementClass: "clinician_observation",
    normalizedLabel: "sleep",
    displayText: "Sleep remains poor — around four hours.",
    status: "approved",
    approvedBy: T.clinician,
    approvedAt: new Date(NOW).toISOString(),
    supersedesId: null,
    span: { start: 0, end: 10 },
    numericFacts: [],
    createdAt: new Date(NOW).toISOString(),
    ...over,
  };
}

/** Persist an item so a membership's foreign key holds. */
function storeItem(i: MemoryItem) {
  db.prepare(
    `INSERT INTO clinical_memory_items
       (id, tenant_id, person_id, source_thought_id, source_transcript_id, source_span_json,
        item_type, statement_class, normalized_label, display_text, status, approved_by, approved_at, created_at)
     VALUES (?, ?, ?, NULL, NULL, '{}', ?, ?, NULL, ?, ?, ?, ?, ?)`
  ).run(i.id, T.tenant, i.personId, i.itemType, i.statementClass, i.displayText, i.status,
        i.approvedBy, i.approvedAt, i.createdAt);
  return i;
}

// ---------------------------------------------------------------------------
// No auto-link in v1
// ---------------------------------------------------------------------------

test("the matcher proposes and never connects", async () => {
  const thread = await createThread(ctx, {
    personId: T.patient, threadType: "theme", canonicalLabel: "sleep",
    createdBy: "clinician", firstSeenAt: new Date(NOW - 86_400_000).toISOString(),
  });
  const item = storeItem(anItem());

  const result = await matchItemToThreads(ctx, item, NOW);
  assert.ok(result.proposed.length >= 1, "an exact label match should be offered");
  for (const m of result.proposed) {
    assert.equal(m.status, "proposed", "the matcher must never write an accepted membership");
    assert.equal(m.proposedBy, "system");
    assert.equal(m.decidedBy, null);
  }
  assert.equal((await membershipsFor(ctx, thread.id, "accepted")).length, 0);
});

test("proposeMembership has no way to express acceptance", () => {
  // The guarantee is a property of the signature, not of callers remembering.
  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/clinical/thread-store.ts"), "utf8");
  const start = src.indexOf("export async function proposeMembership");
  assert.ok(start > 0);
  // Anchored on the next EXPORTED declaration after it rather than on a name
  // prefix: "async function decide" also matches "decidedPairs", which is
  // defined earlier, and the slice came out backwards.
  const rest = src.slice(start + 1);
  const end = start + 1 + rest.indexOf("\nasync function decide(");
  const fn = src.slice(start, end);
  assert.ok(fn.length > 100, "the slice must actually contain the function");
  assert.ok(fn.includes('status: "proposed"'), "the status is hard-coded");
  assert.ok(!/status:\s*args\./.test(fn), "no caller may choose the status");
});

test("accepting requires an authenticated clinician", async () => {
  const thread = await createThread(ctx, {
    personId: T.patient, threadType: "theme", canonicalLabel: "the accident", createdBy: "clinician",
  });
  const item = storeItem(anItem({ normalizedLabel: null, displayText: "Did not want to discuss the accident." }));
  const m = await proposeMembership(ctx, {
    personId: T.patient, threadId: thread.id, memoryItemId: item.id, proposedBy: "system",
  });
  const anonymous: TenantContext = { tenantId: T.tenant };
  await assert.rejects(
    () => acceptMembership(anonymous, m.id, new Date(NOW).toISOString()),
    /authenticated clinician/,
    "a background job must not be able to make a connection look like a clinician's"
  );
});

test("an unapproved item is never matched", async () => {
  const candidate = storeItem(anItem({ status: "candidate", approvedBy: null, approvedAt: null }));
  const result = await matchItemToThreads(ctx, candidate, NOW);
  assert.equal(result.proposed.length, 0, "a candidate nobody kept has no business joining a pattern");
});

// ---------------------------------------------------------------------------
// Rejected links remain rejected
// ---------------------------------------------------------------------------

test("a rejected connection is not proposed again by a later run", async () => {
  const thread = await createThread(ctx, {
    personId: T.patient, threadType: "theme", canonicalLabel: "work situation",
    createdBy: "clinician", firstSeenAt: new Date(NOW).toISOString(),
  });
  const item = storeItem(anItem({ normalizedLabel: "work situation", displayText: "Check the work situation." }));

  const first = await matchItemToThreads(ctx, item, NOW);
  const m = first.proposed.find((p) => p.threadId === thread.id);
  assert.ok(m, "the exact label match should be proposed the first time");
  await rejectMembership(ctx, m.id, new Date(NOW).toISOString());

  // The matcher runs again next week over the same data. This is how a refusal
  // gets quietly undone, and it is the failure this test exists for.
  const second = await matchItemToThreads(ctx, item, NOW + 7 * 86_400_000);
  assert.equal(
    second.proposed.filter((p) => p.threadId === thread.id).length, 0,
    "the clinician's no must survive the matcher running again"
  );
  assert.ok(second.alreadyDecided >= 1, "and the skip is reported rather than silent");
});

test("re-proposing a decided pair is refused outright", async () => {
  const thread = await createThread(ctx, {
    personId: T.patient, threadType: "theme", canonicalLabel: "her sister", createdBy: "clinician",
  });
  const item = storeItem(anItem({ normalizedLabel: "her sister" }));
  const m = await proposeMembership(ctx, {
    personId: T.patient, threadId: thread.id, memoryItemId: item.id, proposedBy: "system",
  });
  await rejectMembership(ctx, m.id, new Date(NOW).toISOString());
  await assert.rejects(
    () => proposeMembership(ctx, {
      personId: T.patient, threadId: thread.id, memoryItemId: item.id, proposedBy: "system",
    }),
    DuplicateMembershipError
  );
});

test("a clinician can deliberately revisit a rejection, and only a rejection", async () => {
  const thread = await createThread(ctx, {
    personId: T.patient, threadType: "theme", canonicalLabel: "grounding", createdBy: "clinician",
  });
  const item = storeItem(anItem({ normalizedLabel: "grounding" }));
  const m = await proposeMembership(ctx, {
    personId: T.patient, threadId: thread.id, memoryItemId: item.id, proposedBy: "system",
  });
  await rejectMembership(ctx, m.id, new Date(NOW).toISOString());

  const reopened = await revisitMembership(ctx, m.id);
  assert.equal(reopened.status, "proposed");
  // Re-attributed: the clinician is now the one asking, not the model whose
  // suggestion they refused.
  assert.equal(reopened.proposedBy, "clinician");
  assert.equal(reopened.decidedBy, null);

  await acceptMembership(ctx, m.id, new Date(NOW).toISOString());
  await assert.rejects(
    () => revisitMembership(ctx, m.id), NotProposedError,
    "an accepted connection is already connected; revisit is the path back from a refusal"
  );
});

// ---------------------------------------------------------------------------
// Thread evidence opens source
// ---------------------------------------------------------------------------

test("the timeline carries items, oldest first, not a summary", async () => {
  const thread = await createThread(ctx, {
    personId: T.patient, threadType: "theme", canonicalLabel: "timeline test", createdBy: "clinician",
  });
  const older = storeItem(anItem({ createdAt: "2026-06-01T09:00:00.000Z", displayText: "Earlier observation." }));
  const newer = storeItem(anItem({ createdAt: "2026-08-01T09:00:00.000Z", displayText: "Later observation." }));
  for (const it of [newer, older]) {
    const m = await proposeMembership(ctx, {
      personId: T.patient, threadId: thread.id, memoryItemId: it.id, proposedBy: "clinician",
    });
    await acceptMembership(ctx, m.id, new Date(NOW).toISOString());
  }

  const loadItems = async (ids: string[]) =>
    (await Promise.all(ids.map((id) => getItem(ctx, id)))).filter((x): x is MemoryItem => !!x);
  const tl = await threadTimeline(ctx, thread.id, loadItems);
  assert.ok(tl);
  assert.equal(tl.entries.length, 2);
  assert.ok(tl.entries[0].item.createdAt < tl.entries[1].item.createdAt, "oldest first — a pattern has a direction");
  // Every entry can reach its source. Without this a thread is an assertion.
  for (const e of tl.entries) {
    assert.ok(e.item.id, "each entry carries the item, so the drill-down exists");
    assert.equal(typeof e.item.statementClass, "string", "and its epistemic class travels with it");
  }
});

test("only accepted memberships appear on the timeline", async () => {
  const thread = await createThread(ctx, {
    personId: T.patient, threadType: "theme", canonicalLabel: "accepted only", createdBy: "clinician",
  });
  const kept = storeItem(anItem({ displayText: "Accepted item." }));
  const refused = storeItem(anItem({ displayText: "Refused item." }));
  const a = await proposeMembership(ctx, { personId: T.patient, threadId: thread.id, memoryItemId: kept.id, proposedBy: "system" });
  await acceptMembership(ctx, a.id, new Date(NOW).toISOString());
  const b = await proposeMembership(ctx, { personId: T.patient, threadId: thread.id, memoryItemId: refused.id, proposedBy: "system" });
  await rejectMembership(ctx, b.id, new Date(NOW).toISOString());

  const loadItems = async (ids: string[]) =>
    (await Promise.all(ids.map((id) => getItem(ctx, id)))).filter((x): x is MemoryItem => !!x);
  const tl = await threadTimeline(ctx, thread.id, loadItems);
  assert.equal(tl!.entries.length, 1);
  assert.equal(tl!.entries[0].item.displayText, "Accepted item.");
});

// ---------------------------------------------------------------------------
// The retrieval policy
// ---------------------------------------------------------------------------

test("semantic similarity is absent and is not faked", () => {
  assert.ok(!AVAILABLE.includes("semantic_similarity"),
    "there is no embedding index; claiming the component would report a capability that does not exist");
  // And its absence must not silently cap every score at 0.65.
  const perfect = combine({
    lexical_match: 1, structured_concept_match: 1, recency_signal: 1, source_reliability_weight: 1,
  });
  assert.equal(Math.round(perfect.score * 1000) / 1000, 1,
    "the available components renormalize, so a perfect match scores 1 rather than 0.65");
  assert.equal(perfect.contributed.length, 4);
});

test("a score says which components produced it", () => {
  const partial = combine({ structured_concept_match: 1 });
  assert.deepEqual(partial.contributed, ["structured_concept_match"]);
  assert.equal(partial.score, 1);
  // Comparable only against another score built the same way — which is why the
  // component list travels with the number.
  assert.equal(partial.policyVersion, RETRIEVAL_POLICY_VERSION);
});

test("the weights are §10's, and the policy is versioned", () => {
  assert.equal(WEIGHTS.semantic_similarity, 0.35);
  assert.equal(WEIGHTS.lexical_match, 0.25);
  assert.equal(WEIGHTS.structured_concept_match, 0.20);
  assert.equal(WEIGHTS.recency_signal, 0.10);
  assert.equal(WEIGHTS.source_reliability_weight, 0.10);
  assert.match(RETRIEVAL_POLICY_VERSION, /^retrieval-policy\.\d+\.\d+\.\d+$/,
    "§10: put the weights behind a versioned policy so a tuning change is attributable");
});

test("speculation joins threads less eagerly than observation", () => {
  // It does not change what the item IS — the statement class is untouched — it
  // changes how readily Steady offers to file it under a theme.
  assert.ok(sourceReliability("clinician_observation") > sourceReliability("clinician_hypothesis"));
  assert.ok(sourceReliability("clinician_hypothesis") > sourceReliability("clinician_uncertainty") - 0.001);
});

test("an exact label match beats a merely recent thread", () => {
  const item = anItem({ normalizedLabel: "sleep", displayText: "Sleep remains poor." });
  const onLabel = scoreThread(item, {
    id: "t1", personId: T.patient, threadType: "theme", canonicalLabel: "sleep",
    status: "active", createdBy: "clinician", firstSeenAt: null,
    lastSeenAt: new Date(NOW - 60 * 86_400_000).toISOString(), createdAt: "",
  }, NOW);
  const merelyRecent = scoreThread(item, {
    id: "t2", personId: T.patient, threadType: "theme", canonicalLabel: "the commute",
    status: "active", createdBy: "clinician", firstSeenAt: null,
    lastSeenAt: new Date(NOW).toISOString(), createdAt: "",
  }, NOW);
  assert.ok(onLabel.breakdown.score > merelyRecent.breakdown.score);
  assert.match(onLabel.because, /labelled/, "the reason names a signal the clinician can check, not a number");
});

test("weak candidates are not proposed to fill a page", async () => {
  const item = anItem({ normalizedLabel: "nothing-in-common", displayText: "Zzz qqq." });
  const weak = scoreThread(item, {
    id: "t3", personId: T.patient, threadType: "theme", canonicalLabel: "unrelated topic",
    status: "active", createdBy: "clinician", firstSeenAt: null,
    lastSeenAt: new Date(NOW - 200 * 86_400_000).toISOString(), createdAt: "",
  }, NOW);
  assert.ok(weak.breakdown.score < PROPOSE_THRESHOLD,
    "five weak suggestions because five is the page size is how a queue teaches people to click through it");
});

test("one item cannot flood the queue", async () => {
  for (let i = 0; i < 6; i++) {
    await createThread(ctx, {
      personId: T.patient, threadType: "theme", canonicalLabel: "flood topic",
      createdBy: "clinician", firstSeenAt: new Date(NOW).toISOString(),
    });
  }
  const item = storeItem(anItem({ normalizedLabel: "flood topic", displayText: "Flood topic again." }));
  const r = await matchItemToThreads(ctx, item, NOW);
  assert.ok(r.proposed.length <= MAX_PROPOSALS_PER_ITEM,
    "an item touching six threads has a label that is too broad; six weak links is not the fix");
});

// ---------------------------------------------------------------------------
// The gateway task
// ---------------------------------------------------------------------------

test("the thread-match task is registered with a deterministic fallback", () => {
  const task = getTask("clinician.thread.match");
  assert.ok(task, "§9 registers this task");
  // The deterministic matcher IS what runs here, so an unreachable model must
  // not stop a clinician seeing suggestions.
  assert.equal(task.fallback, "deterministic");
});

// ---------------------------------------------------------------------------
// Approved follow-ups become work
// ---------------------------------------------------------------------------

test("only APPROVED follow-ups reach the queue", async () => {
  const { openFollowUps } = await import("../src/lib/clinical/followups");
  storeItem(anItem({
    itemType: "follow_up", displayText: "Follow up on sleep next session.", status: "approved",
    approvedAt: new Date(NOW).toISOString(),
  }));
  storeItem(anItem({
    itemType: "follow_up", displayText: "Candidate follow-up nobody kept.", status: "candidate",
    approvedBy: null, approvedAt: null as unknown as string,
  }));

  const open = await openFollowUps(ctx, { personId: T.patient, now: new Date(NOW) });
  const texts = open.map((f) => f.text);
  assert.ok(texts.includes("Follow up on sleep next session."));
  assert.ok(
    !texts.includes("Candidate follow-up nobody kept."),
    "a candidate is a suggestion nobody accepted; putting it on a clinician's day inverts the human gate"
  );
});

test("only follow-ups reach the queue, not every approved item", async () => {
  const { openFollowUps } = await import("../src/lib/clinical/followups");
  storeItem(anItem({
    itemType: "observation", displayText: "An approved observation.", status: "approved",
    approvedAt: new Date(NOW).toISOString(),
  }));
  const open = await openFollowUps(ctx, { personId: T.patient, now: new Date(NOW) });
  assert.ok(!open.some((f) => f.text === "An approved observation."));
});

test("follow-ups age out of the queue", async () => {
  const { openFollowUps, FOLLOWUP_WINDOW_DAYS } = await import("../src/lib/clinical/followups");
  storeItem(anItem({
    itemType: "follow_up", displayText: "An old follow-up.", status: "approved",
    approvedAt: new Date(NOW - (FOLLOWUP_WINDOW_DAYS + 5) * 86_400_000).toISOString(),
  }));
  const open = await openFollowUps(ctx, { personId: T.patient, now: new Date(NOW) });
  assert.ok(
    !open.some((f) => f.text === "An old follow-up."),
    "there is no way to mark a follow-up done, so a list that never ages out grows until people stop reading it"
  );
});
