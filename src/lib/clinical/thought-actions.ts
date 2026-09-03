"use server";

// Server actions for clinician thought capture (§14's command surface).
//
// Thin, like the console's other actions: authenticate, resolve the acting
// clinician's tenant from their own record, delegate to the service layer,
// revalidate. No clinical logic here and no state-machine reasoning — both live
// in thoughts.ts and thought-store.ts, where they are tested, and a second
// untested copy in a form handler is how the two come to disagree.
//
// THE TENANT IS READ, NEVER ACCEPTED. §6.2: "Do not accept tenant_id from a
// browser payload. Resolve it from authenticated context." A tenant supplied by
// the caller is a tenant an attacker can choose.
//
// EVERY ACTION IS BEHIND THE CAPTURE FLAG. §22: a disabled surface must not be
// reachable just because its data exists. Checked here as well as in the
// component, because a form post does not go through the component that decided
// whether to render the form.

import { revalidatePath } from "next/cache";
import { requireClinician } from "../auth";
import { data } from "../data";
import { PLATFORM_TENANT_ID } from "../db";
import { audit } from "../audit";
import type { TenantContext } from "../repository";
import { thoughtsSurfaceAvailable } from "./thoughts-flags";
import {
  assertStorableAudio, thoughtStorage, AudioTooLargeError, UnsupportedAudioTypeError,
} from "./thought-storage";
import { transcriptionService } from "./transcription";
import {
  beginThought, finalizeCapture, addTranscript, correctTranscript, saveThought,
  discardThought, transitionThought, getThought,
  StaleTranscriptError, InvalidTransitionError,
} from "./thought-store";

export interface ActionResult {
  ok: boolean;
  /** Present on success where the caller needs it. */
  thoughtId?: string;
  /** User-facing, already in §17.4's voice. Never a stack trace. */
  error?: string;
  /** True when trying again could work: a provider timeout, not a bad format. */
  retryable?: boolean;
}

async function clinicianContext(): Promise<{ ctx: TenantContext; clinicianId: string }> {
  const clinician = await requireClinician();
  const c = await data();
  const row = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  return {
    ctx: { tenantId: row?.tenant_id ?? PLATFORM_TENANT_ID, personId: clinician.id },
    clinicianId: clinician.id,
  };
}

function unavailable(): ActionResult {
  return { ok: false, error: "Recording thoughts is not enabled in this environment." };
}

/** Start a capture. Called when the clinician presses Record, before any audio
 *  exists, so the recorder has an id to upload against. */
export async function startThoughtAction(personId: string): Promise<ActionResult> {
  if (!thoughtsSurfaceAvailable("CLINICIAN_THOUGHTS_CAPTURE")) return unavailable();
  const { ctx, clinicianId } = await clinicianContext();
  const thought = await beginThought(ctx, { personId });
  await audit({
    actorId: clinicianId, actorRole: "clinician", family: "clinical",
    type: "clinician_thought_started", target: thought.id,
    detail: { personId, thoughtId: thought.id },
  });
  return { ok: true, thoughtId: thought.id };
}

/** Upload the recording and transcribe it.
 *
 *  THE ORDER HERE IS THE PHASE'S DEFINITION OF DONE. Audio is stored FIRST and
 *  the thought moves to `processing` before transcription is attempted, so a
 *  transcription failure leaves a recording that can be retried rather than a
 *  thought with nothing behind it. Transcription failing is then a separate,
 *  recoverable outcome — never a reason to discard what the clinician said. */
export async function finalizeThoughtAction(formData: FormData): Promise<ActionResult> {
  if (!thoughtsSurfaceAvailable("CLINICIAN_THOUGHTS_CAPTURE")) return unavailable();
  const { ctx, clinicianId } = await clinicianContext();

  const thoughtId = String(formData.get("thoughtId") ?? "");
  const durationMs = Number(formData.get("durationMs") ?? 0);
  const file = formData.get("audio");
  if (!(file instanceof Blob)) {
    return { ok: false, error: "No recording was received. Nothing has been saved." };
  }

  const thought = await getThought(ctx, thoughtId);
  if (!thought) return { ok: false, error: "That recording is no longer available." };

  const buffer = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || "audio/webm";
  try {
    assertStorableAudio({ bytes: buffer.byteLength, contentType });
  } catch (e) {
    if (e instanceof AudioTooLargeError || e instanceof UnsupportedAudioTypeError) {
      return { ok: false, error: e.message };
    }
    throw e;
  }

  const stored = await thoughtStorage().put({ data: buffer, contentType });
  await finalizeCapture(ctx, { thoughtId, audioStorageKey: stored.key, durationMs });
  await audit({
    actorId: clinicianId, actorRole: "clinician", family: "clinical",
    type: "clinician_thought_captured", target: thoughtId,
    // Bytes and duration, never content. §18: no transcript text in logs.
    detail: { personId: thought.personId, bytes: stored.bytes, durationMs },
  });

  const result = await transcriptionService().transcribe({ audio: buffer, contentType });
  if (!result.ok) {
    // The audio stays. §13: "If provider fails, keep audio and mark retryable."
    // The thought stays in `processing` rather than moving to `failed`, because
    // a retry is still possible and the recording still exists.
    revalidatePath(`/clinician/member/${thought.personId}/thoughts`);
    return {
      ok: false,
      thoughtId,
      retryable: result.retryable,
      error: result.retryable
        ? "Your recording is safe. Steady could not create a transcript yet — you can try again."
        : "Your recording is safe, but it could not be transcribed.",
    };
  }

  await addTranscript(ctx, {
    thoughtId, text: result.text, provider: result.provider,
    providerModel: result.model, language: result.language,
    createdBy: "transcription_service",
  });
  // Phase 1 stops at the transcript. Extraction is Phase 2, and until it exists
  // every transcript lands in the reduced review — which is the honest state:
  // there IS no organized set yet, and pretending otherwise would put an empty
  // list in front of the clinician and call it a result.
  await transitionThought(ctx, thoughtId, "extraction_failed");
  revalidatePath(`/clinician/member/${thought.personId}/thoughts`);
  return { ok: true, thoughtId };
}

/** The clinician's correction, before save. */
export async function correctTranscriptAction(formData: FormData): Promise<ActionResult> {
  if (!thoughtsSurfaceAvailable("CLINICIAN_THOUGHTS_CAPTURE")) return unavailable();
  const { ctx, clinicianId } = await clinicianContext();
  const thoughtId = String(formData.get("thoughtId") ?? "");
  const text = String(formData.get("text") ?? "").slice(0, 20_000);
  const expectedHash = String(formData.get("expectedHash") ?? "");

  try {
    await correctTranscript(ctx, { thoughtId, text, expectedHash });
  } catch (e) {
    if (e instanceof StaleTranscriptError) {
      return { ok: false, error: e.message };
    }
    if (e instanceof InvalidTransitionError) {
      return { ok: false, error: "That recording is no longer available." };
    }
    throw e;
  }
  const thought = await getThought(ctx, thoughtId);
  await audit({
    actorId: clinicianId, actorRole: "clinician", family: "clinical",
    type: "clinician_transcript_corrected", target: thoughtId,
    // §18: the correction is recorded, the corrected words are not.
    detail: { personId: thought?.personId, chars: text.length },
  });
  if (thought) revalidatePath(`/clinician/member/${thought.personId}/thoughts`);
  return { ok: true, thoughtId };
}

export async function saveThoughtAction(formData: FormData): Promise<ActionResult> {
  if (!thoughtsSurfaceAvailable("CLINICIAN_THOUGHTS_CAPTURE")) return unavailable();
  const { ctx, clinicianId } = await clinicianContext();
  const thoughtId = String(formData.get("thoughtId") ?? "");
  try {
    const saved = await saveThought(ctx, thoughtId);
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "clinician_thought_saved", target: thoughtId,
      detail: { personId: saved.personId, status: saved.status },
    });
    revalidatePath(`/clinician/member/${saved.personId}/thoughts`);
    return { ok: true, thoughtId };
  } catch (e) {
    if (e instanceof InvalidTransitionError) {
      return { ok: false, error: "That recording is no longer available." };
    }
    throw e;
  }
}

export async function discardThoughtAction(formData: FormData): Promise<ActionResult> {
  if (!thoughtsSurfaceAvailable("CLINICIAN_THOUGHTS_CAPTURE")) return unavailable();
  const { ctx, clinicianId } = await clinicianContext();
  const thoughtId = String(formData.get("thoughtId") ?? "");
  try {
    const discarded = await discardThought(ctx, thoughtId);
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "clinician_thought_discarded", target: thoughtId,
      detail: { personId: discarded.personId },
    });
    revalidatePath(`/clinician/member/${discarded.personId}/thoughts`);
    return { ok: true, thoughtId };
  } catch (e) {
    if (e instanceof InvalidTransitionError) {
      return { ok: false, error: "That recording is no longer available." };
    }
    throw e;
  }
}
