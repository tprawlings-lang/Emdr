// Clinician thoughts — the read and write model (§14's command surface).
//
// Everything here goes through `repo(ctx)`, per §6.2 and §24: "New feature
// repositories must require TenantContext even while older call sites still use
// direct queries." That is not a style preference. A thought is a clinician's
// private judgement about a patient, and a forgotten WHERE clause on this table
// is the worst disclosure in the product — so the scope lives beneath the call
// site rather than at it.
//
// TWO CONSEQUENCES OF THAT, VISIBLE IN THE SIGNATURES.
//
//   NOTHING TAKES A tenantId. Every function takes a TenantContext, which the
//   caller obtained from the authenticated session. §6.2: "Do not accept
//   tenant_id from a browser payload. Resolve it from authenticated context."
//   A parameter would be a place for a request body to end up.
//
//   A FOREIGN THOUGHT IS NOT FOUND, NOT FORBIDDEN. `getThought` on another
//   tenant's id returns null, identical to an id that never existed, so
//   enumeration reveals nothing. §19's tenancy row asks for exactly this:
//   "foreign tenant person ID returns not-found".
//
// THE CLINICIAN IS RESOLVED, NEVER SUPPLIED. §6.2: "The clinician identity is
// the authenticated clinician person/account context, not a caller-supplied
// string." So `clinicianPersonId` comes from the context, and a caller cannot
// record a thought under somebody else's name.

import { repo, type TenantContext } from "../repository";
import { ulid } from "../ids";
import { encryptField, decryptField } from "../crypto";
import { hashTranscript } from "./transcription";
import {
  nextStatus, isReviewable, recordThoughtCaptured, recordThoughtTranscribed,
  recordThoughtDiscarded, type ThoughtStatus, type ThoughtEvent,
} from "./thoughts";
import { DEFAULT_AUDIO_RETENTION, type AudioRetention } from "./thoughts-flags";

export interface Thought {
  id: string;
  personId: string;
  clinicianPersonId: string;
  status: ThoughtStatus;
  audioStorageKey: string | null;
  audioRetentionPolicy: AudioRetention;
  audioDeletedAt: string | null;
  currentTranscriptId: string | null;
  sourceSessionId: string | null;
  recordedAt: string;
  savedAt: string | null;
  createdAt: string;
}

export interface Transcript {
  id: string;
  thoughtId: string;
  version: number;
  /** Decrypted. Stored encrypted, per §18. */
  text: string;
  hash: string;
  provider: string | null;
  providerModel: string | null;
  language: string | null;
  createdBy: "transcription_service" | "clinician";
  createdAt: string;
}

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function toThought(r: Row): Thought {
  return {
    id: String(r.id),
    personId: String(r.person_id),
    clinicianPersonId: String(r.clinician_person_id),
    status: String(r.status) as ThoughtStatus,
    audioStorageKey: str(r.audio_storage_key),
    audioRetentionPolicy: String(r.audio_retention_policy) as AudioRetention,
    audioDeletedAt: str(r.audio_deleted_at),
    currentTranscriptId: str(r.current_transcript_id),
    sourceSessionId: str(r.source_session_id),
    recordedAt: String(r.recorded_at),
    savedAt: str(r.saved_at),
    createdAt: String(r.created_at),
  };
}

function toTranscript(r: Row): Transcript {
  return {
    id: String(r.id),
    thoughtId: String(r.thought_id),
    version: Number(r.version),
    text: decryptField(String(r.transcript_text)),
    hash: String(r.transcript_hash),
    provider: str(r.provider),
    providerModel: str(r.provider_model),
    language: str(r.language),
    createdBy: String(r.created_by) as Transcript["createdBy"],
    createdAt: String(r.created_at),
  };
}

/** The clinician on whose behalf this context is acting.
 *
 *  Required rather than optional: every write in this module records who made
 *  it, and a context without a person is a context that cannot answer that. */
function actingClinician(ctx: TenantContext): string {
  if (!ctx.personId) {
    throw new Error("A clinician thought requires an authenticated clinician in the context.");
  }
  return ctx.personId;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getThought(ctx: TenantContext, id: string): Promise<Thought | null> {
  const row = await repo(ctx).findOne<Row>("clinician_thoughts", "id = ?", [id]);
  return row ? toThought(row) : null;
}

/** One patient's thoughts, newest first — the Thoughts history view (§17.2). */
export async function listThoughts(
  ctx: TenantContext, personId: string, limit = 50
): Promise<Thought[]> {
  const rows = await repo(ctx).findMany<Row>(
    "clinician_thoughts", "person_id = ?", [personId],
    { orderBy: "recorded_at DESC", limit }
  );
  return rows.map(toThought);
}

export async function getTranscript(ctx: TenantContext, id: string): Promise<Transcript | null> {
  const row = await repo(ctx).findOne<Row>("clinician_thought_transcripts", "id = ?", [id]);
  return row ? toTranscript(row) : null;
}

/** Every version, oldest first. §16: a correction adds a version and the
 *  original stays readable. */
export async function transcriptVersions(
  ctx: TenantContext, thoughtId: string
): Promise<Transcript[]> {
  const rows = await repo(ctx).findMany<Row>(
    "clinician_thought_transcripts", "thought_id = ?", [thoughtId], { orderBy: "version ASC" }
  );
  return rows.map(toTranscript);
}

export async function currentTranscript(
  ctx: TenantContext, thought: Thought
): Promise<Transcript | null> {
  if (!thought.currentTranscriptId) return null;
  return getTranscript(ctx, thought.currentTranscriptId);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Open a capture. The clinician has pressed Record; nothing exists yet. */
export async function beginThought(
  ctx: TenantContext,
  args: { personId: string; sourceSessionId?: string | null; now?: Date }
): Promise<Thought> {
  const clinician = actingClinician(ctx);
  const now = args.now ?? new Date();
  const id = ulid(now.getTime());
  const recordedAt = now.toISOString().replace("T", " ").slice(0, 19);
  await repo(ctx).insert("clinician_thoughts", {
    id,
    person_id: args.personId,
    clinician_person_id: clinician,
    status: "capturing" satisfies ThoughtStatus,
    audio_retention_policy: DEFAULT_AUDIO_RETENTION,
    source_session_id: args.sourceSessionId ?? null,
    recorded_at: recordedAt,
  });
  return (await getThought(ctx, id))!;
}

export class InvalidTransitionError extends Error {}

/** Move a thought, refusing a transition the machine does not allow.
 *
 *  Returns the thought unchanged when the event does not apply — a duplicate
 *  webhook or a double-clicked button is ordinary, and `nextStatus` already
 *  answers null for those. It THROWS only when the thought does not exist in
 *  this tenant, which is a different thing entirely. */
export async function transitionThought(
  ctx: TenantContext, id: string, event: ThoughtEvent, patch: Record<string, unknown> = {}
): Promise<Thought> {
  const thought = await getThought(ctx, id);
  if (!thought) throw new InvalidTransitionError(`No such thought: ${id}`);
  const to = nextStatus(thought.status, event);
  if (!to) return thought;
  await repo(ctx).update(
    "clinician_thoughts",
    { ...patch, status: to, updated_at: new Date().toISOString().replace("T", " ").slice(0, 19) },
    "id = ?", [id]
  );
  return (await getThought(ctx, id))!;
}

/** Capture finished.
 *
 *  `audioStorageKey` is NULLABLE, and the null case is a typed thought rather
 *  than a failure: a clinician who wrote their note instead of speaking it has
 *  captured nothing to store. The column has always been nullable; this
 *  signature was narrower than the schema, which meant the typed path could not
 *  be expressed without either lying about a key or bypassing the state
 *  machine. */
export async function finalizeCapture(
  ctx: TenantContext,
  args: { thoughtId: string; audioStorageKey: string | null; durationMs: number }
): Promise<Thought> {
  const clinician = actingClinician(ctx);
  const thought = await transitionThought(ctx, args.thoughtId, "done", {
    audio_storage_key: args.audioStorageKey,
  });
  await recordThoughtCaptured({
    thoughtId: thought.id,
    tenantId: repo(ctx).tenantId,
    personId: thought.personId,
    clinicianPersonId: clinician,
    durationMs: args.durationMs,
    sourceSessionId: thought.sourceSessionId,
    recordedAt: thought.recordedAt,
  });
  return thought;
}

/** Store a transcript version and point the thought at it.
 *
 *  VERSIONS ARE NEVER OVERWRITTEN. §16: "Before save, transcript edits create a
 *  new transcript version. Extraction reruns against the latest version." The
 *  version number is derived from what is already there rather than passed in,
 *  so two writers cannot both claim to be version 2 — the UNIQUE(thought_id,
 *  version) index turns that race into a failed insert instead of a lost
 *  correction. */
export async function addTranscript(
  ctx: TenantContext,
  args: {
    thoughtId: string;
    text: string;
    provider?: string | null;
    providerModel?: string | null;
    language?: string | null;
    createdBy: "transcription_service" | "clinician";
  }
): Promise<Transcript> {
  const thought = await getThought(ctx, args.thoughtId);
  if (!thought) throw new InvalidTransitionError(`No such thought: ${args.thoughtId}`);

  const existing = await transcriptVersions(ctx, args.thoughtId);
  const version = existing.length + 1;
  const id = ulid();
  const hash = hashTranscript(args.text);

  await repo(ctx).insert("clinician_thought_transcripts", {
    id,
    person_id: thought.personId,
    thought_id: args.thoughtId,
    version,
    // Encrypted at rest, like every other protected clinical field (§18).
    transcript_text: encryptField(args.text),
    transcript_hash: hash,
    provider: args.provider ?? null,
    provider_model: args.providerModel ?? null,
    language: args.language ?? null,
    created_by: args.createdBy,
  });
  await repo(ctx).update(
    "clinician_thoughts", { current_transcript_id: id }, "id = ?", [args.thoughtId]
  );

  await recordThoughtTranscribed({
    thoughtId: args.thoughtId,
    transcriptId: id,
    tenantId: repo(ctx).tenantId,
    personId: thought.personId,
    // The service acts as nobody. Naming a clinician on a transcript they did
    // not write would make the ledger say they authored the machine's version.
    actorId: args.createdBy === "clinician" ? actingClinician(ctx) : null,
    version,
    transcriptHash: hash,
    provider: args.provider ?? null,
    providerModel: args.providerModel ?? null,
    createdBy: args.createdBy,
  });

  return (await getTranscript(ctx, id))!;
}

export class StaleTranscriptError extends Error {}

/** The clinician's own correction, before save (§14.1's conflict rule).
 *
 *  `expectedHash` is the version the browser was showing. If the transcript has
 *  moved on — another tab, another session, a retry that landed — this refuses
 *  rather than writing, because the alternative is a clinician silently
 *  overwriting a correction they never saw. §17.4 has the copy: "This
 *  transcript changed in another tab or session. Reload the latest version
 *  before saving." */
export async function correctTranscript(
  ctx: TenantContext,
  args: { thoughtId: string; text: string; expectedHash: string }
): Promise<Transcript> {
  const thought = await getThought(ctx, args.thoughtId);
  if (!thought) throw new InvalidTransitionError(`No such thought: ${args.thoughtId}`);
  const current = await currentTranscript(ctx, thought);
  if (!current) throw new InvalidTransitionError("There is no transcript to correct.");
  if (current.hash !== args.expectedHash) {
    throw new StaleTranscriptError(
      "This transcript changed in another tab or session. Reload the latest version before saving."
    );
  }
  return addTranscript(ctx, {
    thoughtId: args.thoughtId,
    text: args.text,
    provider: current.provider,
    providerModel: current.providerModel,
    language: current.language,
    createdBy: "clinician",
  });
}

/** The clinician approved. Phase 1 saves the source thought; Phase 2 adds the
 *  items. Idempotent by way of the state machine: a second Save on a saved
 *  thought is a no-op rather than a second saved_at. */
export async function saveThought(ctx: TenantContext, id: string): Promise<Thought> {
  const before = await getThought(ctx, id);
  if (!before) throw new InvalidTransitionError(`No such thought: ${id}`);
  if (!isReviewable(before.status)) return before;
  return transitionThought(ctx, id, "save", {
    saved_at: new Date().toISOString().replace("T", " ").slice(0, 19),
  });
}

export async function discardThought(ctx: TenantContext, id: string): Promise<Thought> {
  const clinician = actingClinician(ctx);
  const before = await getThought(ctx, id);
  if (!before) throw new InvalidTransitionError(`No such thought: ${id}`);
  const after = await transitionThought(ctx, id, before.status === "capturing" ? "cancel" : "discard");
  if (after.status === "discarded" && before.status !== "discarded") {
    await recordThoughtDiscarded({
      thoughtId: id,
      tenantId: repo(ctx).tenantId,
      personId: before.personId,
      clinicianPersonId: clinician,
      fromStatus: before.status,
      hadTranscript: before.currentTranscriptId !== null,
    });
  }
  return after;
}
