// Phase 1's third definition of done: "Cross-tenant access tests pass."
// §19's tenancy row spells out what that means: "Foreign tenant person ID
// returns not-found, foreign write refused, search and retrieval cannot
// enumerate another tenant."
//
// This file builds two real tenants in a real database and tries to reach
// across, because a tenancy test against mocks proves that the mocks are
// scoped. Everything here runs through the same functions the routes call.
//
// The subtlety worth stating: the required outcome is NOT-FOUND, not
// forbidden. A "403 you may not see this patient" confirms the patient exists,
// which is the thing a clinician at another organization must not be able to
// learn by trying ids. So the assertions below check that a foreign row is
// indistinguishable from one that was never written.

process.env.EMDR_DATA_DIR = `/tmp/steady-thoughts-tenancy-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "tenancy-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "tenancy-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import { getDb } from "../src/lib/db";
import type { TenantContext } from "../src/lib/repository";
import {
  beginThought, finalizeCapture, addTranscript, correctTranscript, getThought,
  listThoughts, transcriptVersions, currentTranscript, saveThought, discardThought,
  StaleTranscriptError, InvalidTransitionError,
} from "../src/lib/clinical/thought-store";

const db = getDb();

// Two organizations that must never see each other.
const A = { tenant: "tenant-north", clinician: "clin-north", patient: "pat-north" };
const B = { tenant: "tenant-south", clinician: "clin-south", patient: "pat-south" };

function seedTenant(t: { tenant: string; clinician: string; patient: string }) {
  db.prepare("INSERT OR IGNORE INTO tenants (id, kind, name) VALUES (?, 'organization', ?)")
    .run(t.tenant, t.tenant);
  for (const [id, name] of [[t.clinician, "Clinician"], [t.patient, "Patient"]] as const) {
    db.prepare(
      `INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance)
       VALUES (?, ?, ?, 'fabricated')`
    ).run(id, t.tenant, name);
  }
}
seedTenant(A);
seedTenant(B);

const ctxA: TenantContext = { tenantId: A.tenant, personId: A.clinician };
const ctxB: TenantContext = { tenantId: B.tenant, personId: B.clinician };

async function aThoughtIn(
  t: { patient: string }, ctx: TenantContext, text = "She seemed steadier today."
) {
  const thought = await beginThought(ctx, { personId: t.patient });
  await finalizeCapture(ctx, { thoughtId: thought.id, audioStorageKey: "a".repeat(32), durationMs: 58_000 });
  await addTranscript(ctx, { thoughtId: thought.id, text, provider: "fixture", createdBy: "transcription_service" });
  return thought.id;
}

test("a foreign thought is not found, not forbidden", async () => {
  const id = await aThoughtIn(A, ctxA);
  assert.ok(await getThought(ctxA, id), "the owning tenant cannot read its own thought");
  assert.equal(await getThought(ctxB, id), null,
    "another tenant read a thought by id");
  // Indistinguishable from an id that was never written: knowing the shape of
  // an id must tell an attacker nothing about whether it exists.
  assert.equal(await getThought(ctxB, "01JZZZZZZZZZZZZZZZZZZZZZZZ"), null);
});

test("a foreign write is refused rather than applied elsewhere", async () => {
  const id = await aThoughtIn(A, ctxA);
  const before = (await getThought(ctxA, id))!;

  // Every write path, from the other tenant.
  await assert.rejects(() => addTranscript(ctxB, {
    thoughtId: id, text: "injected", createdBy: "clinician",
  }), InvalidTransitionError);
  await assert.rejects(() => saveThought(ctxB, id), InvalidTransitionError);
  await assert.rejects(() => discardThought(ctxB, id), InvalidTransitionError);
  await assert.rejects(() => correctTranscript(ctxB, {
    thoughtId: id, text: "injected", expectedHash: "whatever",
  }), InvalidTransitionError);

  // And nothing moved.
  const after = (await getThought(ctxA, id))!;
  assert.deepEqual(after, before, "a foreign write changed the record");
  assert.equal((await transcriptVersions(ctxA, id)).length, 1,
    "a foreign write added a transcript version");
});

test("a listing cannot enumerate another tenant", async () => {
  await aThoughtIn(A, ctxA);
  await aThoughtIn(B, ctxB, "Different patient entirely.");

  const seenByA = await listThoughts(ctxA, A.patient);
  const seenByB = await listThoughts(ctxB, B.patient);
  assert.ok(seenByA.length > 0);
  assert.ok(seenByB.length > 0);

  // Asking for the OTHER tenant's patient by id returns nothing, rather than
  // that patient's thoughts.
  assert.deepEqual(await listThoughts(ctxB, A.patient), [],
    "one tenant listed another's patient by person id");
  assert.deepEqual(await listThoughts(ctxA, B.patient), []);

  // No id from one tenant appears in the other's results.
  const idsA = new Set(seenByA.map((t) => t.id));
  for (const t of seenByB) {
    assert.ok(!idsA.has(t.id), `thought ${t.id} appears in both tenants`);
  }
});

test("transcript versions are scoped too", async () => {
  // A tenant check on the parent row is not a tenant check on the children: a
  // transcript carries its own tenant_id precisely so reading one directly
  // cannot be a way around the thought's scope.
  const id = await aThoughtIn(A, ctxA);
  assert.equal((await transcriptVersions(ctxA, id)).length, 1);
  assert.deepEqual(await transcriptVersions(ctxB, id), [],
    "another tenant read transcript versions by thought id");
});

test("a clinician identity is never taken from the caller", async () => {
  // §6.2: the clinician is the authenticated context, not a supplied string.
  // A context with no person cannot write at all — there would be nobody to
  // record as the author.
  const anonymous: TenantContext = { tenantId: A.tenant };
  await assert.rejects(() => beginThought(anonymous, { personId: A.patient }),
    /authenticated clinician/);

  const id = await aThoughtIn(A, ctxA);
  const thought = (await getThought(ctxA, id))!;
  assert.equal(thought.clinicianPersonId, A.clinician);
});

// ── The workflow itself (Phase 1 DoD 1) ─────────────────────────────────────

test("record, transcribe, correct, save", async () => {
  // "Clinician records, receives transcript, corrects transcript, and saves
  // source thought." End to end, through the same functions the routes use.
  const thought = await beginThought(ctxA, { personId: A.patient });
  assert.equal(thought.status, "capturing");

  const captured = await finalizeCapture(ctxA, {
    thoughtId: thought.id, audioStorageKey: "b".repeat(32), durationMs: 58_000,
  });
  assert.equal(captured.status, "processing");
  assert.equal(captured.audioStorageKey, "b".repeat(32));

  const v1 = await addTranscript(ctxA, {
    thoughtId: thought.id, text: "She semed steadier today.",
    provider: "fixture", createdBy: "transcription_service",
  });
  assert.equal(v1.version, 1);

  // The clinician fixes a mis-heard word.
  const v2 = await correctTranscript(ctxA, {
    thoughtId: thought.id, text: "She seemed steadier today.", expectedHash: v1.hash,
  });
  assert.equal(v2.version, 2);
  assert.equal(v2.createdBy, "clinician");

  // §16: the original stays readable. A correction adds; it does not replace.
  const versions = await transcriptVersions(ctxA, thought.id);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].text, "She semed steadier today.");
  assert.equal((await currentTranscript(ctxA, (await getThought(ctxA, thought.id))!))!.text,
    "She seemed steadier today.");

  const reviewing = await import("../src/lib/clinical/thought-store")
    .then((m) => m.transitionThought(ctxA, thought.id, "extraction_ready"));
  assert.equal(reviewing.status, "review");

  const saved = await saveThought(ctxA, thought.id);
  assert.equal(saved.status, "saved");
  assert.ok(saved.savedAt, "a saved thought has no saved_at");

  // Saving twice is a no-op, not a second save.
  const again = await saveThought(ctxA, thought.id);
  assert.equal(again.savedAt, saved.savedAt);
});

test("a correction against a stale version is refused", async () => {
  // §14.1: "A stale browser submission must return a conflict rather than
  // writing against an older transcript." The alternative is one clinician
  // silently overwriting a correction they never saw.
  const thought = await beginThought(ctxA, { personId: A.patient });
  await finalizeCapture(ctxA, { thoughtId: thought.id, audioStorageKey: "c".repeat(32), durationMs: 1000 });
  const v1 = await addTranscript(ctxA, {
    thoughtId: thought.id, text: "First.", createdBy: "transcription_service",
  });
  await correctTranscript(ctxA, { thoughtId: thought.id, text: "Second.", expectedHash: v1.hash });

  // A second tab still holding v1 tries to save.
  await assert.rejects(
    () => correctTranscript(ctxA, { thoughtId: thought.id, text: "Third.", expectedHash: v1.hash }),
    StaleTranscriptError
  );
  assert.equal((await transcriptVersions(ctxA, thought.id)).length, 2,
    "the stale write landed anyway");
});

test("transcript text is encrypted at rest", async () => {
  // §18: protected clinical text uses the same key management as everything
  // else. Checked against the raw row rather than the accessor, because the
  // accessor decrypts and would pass either way.
  const id = await aThoughtIn(A, ctxA, "A sentence nobody should find in the file.");
  const raw = db.prepare(
    "SELECT transcript_text FROM clinician_thought_transcripts WHERE thought_id = ?"
  ).get(id) as { transcript_text: string };
  assert.ok(!raw.transcript_text.includes("nobody should find"),
    "the transcript is stored in the clear");
  const { isEncrypted } = await import("../src/lib/crypto");
  assert.ok(isEncrypted(raw.transcript_text), "the transcript is not enveloped");
  // And it round-trips, so the encryption is not merely mangling it.
  const back = await currentTranscript(ctxA, (await getThought(ctxA, id))!);
  assert.equal(back!.text, "A sentence nobody should find in the file.");
});
