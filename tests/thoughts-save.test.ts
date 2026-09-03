// Save Thoughts — the atomic command (§8.1, §14.1, Phase 2).
//
// Phase 2's second and third lines of done live here: no candidate becomes
// approved without a clinician save, and replay reproduces the approved memory
// state. Both are properties of this command rather than of any screen, which
// is why they are tested against the command.

process.env.EMDR_DATA_DIR = `/tmp/steady-thoughts-save-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "save-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "save-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import { getDb } from "../src/lib/db";
import type { TenantContext } from "../src/lib/repository";
import {
  beginThought, finalizeCapture, addTranscript, correctTranscript, getThought, currentTranscript,
} from "../src/lib/clinical/thought-store";
import { runExtraction } from "../src/lib/clinical/extraction";
import {
  listItemsForThought, approvedMemory, supersedeItem, approveItem, getItem,
  NotACandidateError,
} from "../src/lib/clinical/memory-store";
import { saveThoughts, StaleSubmissionError, UndecidedCandidatesError } from "../src/lib/clinical/save-thoughts";
import { FIXTURE_MARKER } from "../src/lib/clinical/transcription-fixture";
import { readEvents } from "../src/lib/events";

const db = getDb();

const T = { tenant: "tenant-save", clinician: "clin-save", other: "clin-other", patient: "pat-save" };
db.prepare("INSERT OR IGNORE INTO tenants (id, kind, name) VALUES (?, 'organization', ?)").run(T.tenant, T.tenant);
for (const [id, name] of [[T.clinician, "Clinician"], [T.other, "Other"], [T.patient, "Patient"]] as const) {
  db.prepare(
    "INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated')"
  ).run(id, T.tenant, name);
}
const ctx: TenantContext = { tenantId: T.tenant, personId: T.clinician };

const TEXT =
  "She semed steadier today. Not calm exactly, but she stayed in the room with it, "
  + "which she has not managed before. She said \"I keep waiting for it to go wrong\" — "
  + "her words, not mine. I think this might connect to the thing with her sister, but I "
  + "am not sure yet and I do not want to lead her there. Sleep is still poor, maybe four "
  + "hours. Follow up on the sleap next session."
  + `\n\n${FIXTURE_MARKER}`;

// A FRESH PATIENT PER TEST. `approvedMemory` is scoped to a person, so tests
// sharing one accumulate each other's approvals and every count assertion
// becomes a running total. The first version of this file shared a patient and
// three tests failed for that reason alone — which is the kind of failure that
// gets "fixed" by loosening the assertion until it passes.
let patientSeq = 0;
function freshPatient(): string {
  const id = `pat-save-${++patientSeq}`;
  db.prepare(
    "INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated')"
  ).run(id, T.tenant, "Patient");
  return id;
}

async function aThoughtWithCandidates(text = TEXT) {
  const personId = freshPatient();
  const thought = await beginThought(ctx, { personId });
  await finalizeCapture(ctx, { thoughtId: thought.id, audioStorageKey: "a".repeat(32), durationMs: 58_000 });
  await addTranscript(ctx, { thoughtId: thought.id, text, provider: "fixture", createdBy: "transcription_service" });
  const result = await runExtraction(ctx, thought.id);
  return { thoughtId: thought.id, personId, result };
}

// ---------------------------------------------------------------------------
// No candidate becomes approved without a clinician save
// ---------------------------------------------------------------------------

test("extraction produces candidates and approves nothing", async () => {
  const { thoughtId, personId, result } = await aThoughtWithCandidates();
  assert.equal(result.outcome, "organized");
  assert.ok(result.items.length >= 5);

  const items = await listItemsForThought(ctx, thoughtId);
  assert.ok(items.length > 0);
  assert.ok(items.every((i) => i.status === "candidate"), "extraction must never write an approved item");
  assert.equal((await approvedMemory(ctx, personId)).length, 0, "nothing is in the record until a clinician saves");
});

test("a save approves only what the clinician approved", async () => {
  const { thoughtId, personId } = await aThoughtWithCandidates();
  const candidates = await listItemsForThought(ctx, thoughtId);
  // Keep the first two, throw the rest away.
  const decisions = candidates.map((c, i) => ({
    candidateId: c.id,
    decision: (i < 2 ? "approve" : "reject") as "approve" | "reject",
  }));
  const saved = await saveThoughts(ctx, {
    thoughtId, transcriptVersion: 1, idempotencyKey: "key-1", decisions,
  });
  assert.equal(saved.approved.length, 2);
  assert.equal(saved.rejected.length, candidates.length - 2);
  assert.equal(saved.replayed, false);

  const memory = await approvedMemory(ctx, personId);
  assert.equal(memory.length, 2, "only the approved two reach the record");
});

test("an approved item keeps the statement class it was proposed with", async () => {
  const { thoughtId } = await aThoughtWithCandidates();
  const candidates = await listItemsForThought(ctx, thoughtId);
  const hedge = candidates.find((c) => c.statementClass === "clinician_hypothesis");
  assert.ok(hedge, "the fixture proposes a hypothesis");

  await saveThoughts(ctx, {
    thoughtId, transcriptVersion: 1, idempotencyKey: "key-class",
    decisions: candidates.map((c) => ({
      candidateId: c.id,
      decision: (c.id === hedge.id ? "approve" : "reject") as "approve" | "reject",
    })),
  });
  const after = await getItem(ctx, hedge.id);
  assert.equal(after?.status, "approved");
  // Approving is agreeing the clinician said it, not upgrading what kind of
  // claim it is. §4: a hypothesis that becomes an observation on approval is
  // the exact defect this column exists to prevent.
  assert.equal(after?.statementClass, "clinician_hypothesis");
});

test("a candidate cannot be approved outside a save without a clinician", async () => {
  const { thoughtId } = await aThoughtWithCandidates();
  const [first] = await listItemsForThought(ctx, thoughtId);
  const anonymous: TenantContext = { tenantId: T.tenant };
  await assert.rejects(
    () => approveItem(anonymous, first.id, new Date().toISOString()),
    /authenticated clinician/,
    "approval must name the clinician who made it"
  );
});

test("every candidate must be decided", async () => {
  const { thoughtId, personId } = await aThoughtWithCandidates();
  const candidates = await listItemsForThought(ctx, thoughtId);
  await assert.rejects(
    () => saveThoughts(ctx, {
      thoughtId, transcriptVersion: 1, idempotencyKey: "key-partial",
      decisions: [{ candidateId: candidates[0].id, decision: "approve" }],
    }),
    UndecidedCandidatesError,
    "a half-reviewed set must not save as though it were complete"
  );
  assert.equal((await approvedMemory(ctx, personId)).length, 0, "and nothing is written");
});

// ---------------------------------------------------------------------------
// Atomic, idempotent, and conflicting on stale input
// ---------------------------------------------------------------------------

test("replaying the same idempotency key does not duplicate approvals", async () => {
  const { thoughtId, personId } = await aThoughtWithCandidates();
  const candidates = await listItemsForThought(ctx, thoughtId);
  const decisions = candidates.map((c) => ({ candidateId: c.id, decision: "approve" as const }));

  const first = await saveThoughts(ctx, { thoughtId, transcriptVersion: 1, idempotencyKey: "same", decisions });
  const again = await saveThoughts(ctx, { thoughtId, transcriptVersion: 1, idempotencyKey: "same", decisions });

  assert.equal(first.replayed, false);
  assert.equal(again.replayed, true, "a retry reports success — one that reported failure teaches people to retry again");
  assert.equal(again.approved.length, first.approved.length);
  const memory = await approvedMemory(ctx, personId);
  assert.equal(memory.length, candidates.length, "the retry wrote nothing a second time");
});

test("a stale transcript version is a conflict, not a write", async () => {
  const { thoughtId } = await aThoughtWithCandidates();
  const candidates = await listItemsForThought(ctx, thoughtId);
  // The clinician corrected the transcript in another tab.
  const current = await currentTranscript(ctx, (await getThought(ctx, thoughtId))!);
  await correctTranscript(ctx, {
    thoughtId, text: TEXT.replace("semed", "seemed"), expectedHash: current!.hash,
  });

  await assert.rejects(
    () => saveThoughts(ctx, {
      thoughtId, transcriptVersion: 1, idempotencyKey: "stale-key",
      decisions: candidates.map((c) => ({ candidateId: c.id, decision: "approve" as const })),
    }),
    StaleSubmissionError,
    "approving items that cite text which no longer exists must be refused"
  );
});

test("a decision naming an unknown candidate is a conflict", async () => {
  const { thoughtId } = await aThoughtWithCandidates();
  const candidates = await listItemsForThought(ctx, thoughtId);
  await assert.rejects(
    () => saveThoughts(ctx, {
      thoughtId, transcriptVersion: 1, idempotencyKey: "ghost",
      decisions: [
        ...candidates.map((c) => ({ candidateId: c.id, decision: "approve" as const })),
        { candidateId: "01JGHOSTGHOSTGHOSTGHOSTGH", decision: "approve" as const },
      ],
    }),
    StaleSubmissionError
  );
});

test("a clinician edit is stored, and the record carries their wording", async () => {
  const { thoughtId } = await aThoughtWithCandidates();
  const candidates = await listItemsForThought(ctx, thoughtId);
  const target = candidates[0];
  await saveThoughts(ctx, {
    thoughtId, transcriptVersion: 1, idempotencyKey: "edit-key",
    decisions: candidates.map((c) => ({
      candidateId: c.id,
      decision: (c.id === target.id ? "approve" : "reject") as "approve" | "reject",
      ...(c.id === target.id ? { displayText: "Stayed with the material longer than before." } : {}),
    })),
  });
  const after = await getItem(ctx, target.id);
  assert.equal(after?.displayText, "Stayed with the material longer than before.");
  assert.equal(after?.status, "approved");
});

// ---------------------------------------------------------------------------
// Supersession
// ---------------------------------------------------------------------------

test("correcting an approved item appends and leaves the original readable", async () => {
  const { thoughtId, personId } = await aThoughtWithCandidates();
  const candidates = await listItemsForThought(ctx, thoughtId);
  await saveThoughts(ctx, {
    thoughtId, transcriptVersion: 1, idempotencyKey: "sup-key",
    decisions: candidates.map((c, i) => ({
      candidateId: c.id, decision: (i === 0 ? "approve" : "reject") as "approve" | "reject",
    })),
  });
  const original = candidates[0];

  const { prior, replacement } = await supersedeItem(ctx, {
    priorItemId: original.id,
    displayText: "Stayed present with the material throughout.",
    at: new Date().toISOString(),
  });

  assert.equal(prior.status, "superseded", "the original is marked, not deleted");
  assert.equal(replacement.supersedesId, original.id);
  assert.equal(replacement.statementClass, prior.statementClass, "a wording correction does not change what kind of claim it is");

  // An audit reader asking what the clinician believed at the time must get the
  // answer they actually held.
  const stillThere = await getItem(ctx, original.id);
  assert.ok(stillThere, "the superseded item is still readable");

  const memory = await approvedMemory(ctx, personId);
  assert.ok(memory.some((m) => m.id === replacement.id), "the correction is current");
  assert.ok(!memory.some((m) => m.id === original.id), "the superseded one is not");
});

test("a candidate cannot be superseded — only an approved item can", async () => {
  const { thoughtId } = await aThoughtWithCandidates();
  const [cand] = await listItemsForThought(ctx, thoughtId);
  await assert.rejects(
    () => supersedeItem(ctx, { priorItemId: cand.id, displayText: "x", at: new Date().toISOString() }),
    NotACandidateError,
    "a chain of corrections to something never in the record is not a correction"
  );
});

// ---------------------------------------------------------------------------
// Replay reproduces approved memory state
// ---------------------------------------------------------------------------

test("the ledger records every approval and rejection with its class", async () => {
  const { thoughtId, personId } = await aThoughtWithCandidates();
  const candidates = await listItemsForThought(ctx, thoughtId);
  const approvedIds = candidates.slice(0, 2).map((c) => c.id);
  await saveThoughts(ctx, {
    thoughtId, transcriptVersion: 1, idempotencyKey: "ledger-key",
    decisions: candidates.map((c) => ({
      candidateId: c.id,
      decision: (approvedIds.includes(c.id) ? "approve" : "reject") as "approve" | "reject",
    })),
  });

  const events = await readEvents({ personId, tenantId: T.tenant });
  const approvals = events.filter((e) => e.event_type === "clinical_memory.item_approved");
  const rejections = events.filter((e) => e.event_type === "clinical_memory.item_rejected");
  const extractions = events.filter((e) => e.event_type === "clinician_thought.extraction_completed");

  assert.ok(extractions.length >= 1, "the candidate set is a recorded event");
  assert.ok(approvals.length >= 2);
  assert.ok(rejections.length >= 1);

  // The class travels on the event, so a replay rebuilds the approved memory
  // state without having to look anything up.
  for (const e of approvals) {
    const payload = e.payload as Record<string, unknown>;
    assert.ok(typeof payload.statementClass === "string" && payload.statementClass.length > 0,
      "an approval event without its statement class cannot reproduce the record");
    assert.ok(typeof payload.memoryItemId === "string");
  }
});

test("no event carries the transcript or item text", async () => {
  const { thoughtId, personId } = await aThoughtWithCandidates();
  const candidates = await listItemsForThought(ctx, thoughtId);
  await saveThoughts(ctx, {
    thoughtId, transcriptVersion: 1, idempotencyKey: "text-key",
    decisions: candidates.map((c) => ({ candidateId: c.id, decision: "approve" as const })),
  });
  const events = await readEvents({ personId, tenantId: T.tenant });
  const blob = JSON.stringify(events);
  // §18: raw protected content stays out of the ledger. The events point at
  // rows a scoped reader can open; they do not copy a clinician's private
  // judgement into an append-only store retention can never reach.
  assert.ok(!blob.includes("I keep waiting for it to go wrong"), "a patient quote reached the ledger");
  assert.ok(!blob.includes("Stayed present with the material"), "item display text reached the ledger");
});

test("a thought whose extraction ran is in review, and saving moves it to saved", async () => {
  const { thoughtId } = await aThoughtWithCandidates();
  assert.equal((await getThought(ctx, thoughtId))?.status, "review");
  const candidates = await listItemsForThought(ctx, thoughtId);
  await saveThoughts(ctx, {
    thoughtId, transcriptVersion: 1, idempotencyKey: "state-key",
    decisions: candidates.map((c) => ({ candidateId: c.id, decision: "reject" as const })),
  });
  assert.equal((await getThought(ctx, thoughtId))?.status, "saved");
});
