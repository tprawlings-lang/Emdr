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

/** Organize a transcript into candidate items (§9, Phase 2).
 *
 *  BEHIND ITS OWN FLAG, not capture's. §22's phase order: extraction requires
 *  capture, and a deployment can have the first without the second — which is
 *  exactly the transcript-only path §8.1 gives a state to, and is worth being
 *  able to demonstrate on purpose rather than only by outage. */
export async function organizeThoughtAction(formData: FormData): Promise<ActionResult> {
  if (!thoughtsSurfaceAvailable("CLINICIAN_THOUGHTS_EXTRACTION")) {
    return { ok: false, error: "Organizing thoughts is not enabled in this environment." };
  }
  const { ctx, clinicianId } = await clinicianContext();
  const thoughtId = String(formData.get("thoughtId") ?? "");

  const { runExtraction } = await import("./extraction");
  const result = await runExtraction(ctx, thoughtId);
  const thought = await getThought(ctx, thoughtId);

  await audit({
    actorId: clinicianId, actorRole: "clinician", family: "clinical",
    type: "clinician_thought_organized", target: thoughtId,
    // Counts and outcome, never the items. §18: the act is recorded, the
    // clinical content is not.
    detail: {
      personId: thought?.personId,
      outcome: result.outcome,
      items: result.items.length,
      refused: result.rejected.length,
      droppedCitations: result.droppedCitations,
      source: result.source,
    },
  });
  if (thought) revalidatePath(`/clinician/member/${thought.personId}/thoughts`);

  if (result.outcome === "unavailable") {
    // Retryable: the transcript is intact and running it again is the fix. The
    // copy is §17.4's, and it leads with the transcript being safe because that
    // is the clinician's actual worry.
    return {
      ok: false,
      retryable: true,
      error: `Your transcript is safe. Steady could not organize it yet. ${result.reason}`.trim(),
    };
  }
  return { ok: true, thoughtId };
}

/** The Save Thoughts command (§14.1).
 *
 *  The decisions arrive as one JSON field rather than as repeated form keys,
 *  because they are one atomic submission: a form encoding that could arrive
 *  partially parsed would let half a clinician's judgement look like all of it. */
export async function saveThoughtsAction(formData: FormData): Promise<ActionResult> {
  if (!thoughtsSurfaceAvailable("CLINICIAN_THOUGHTS_EXTRACTION")) {
    return { ok: false, error: "Organizing thoughts is not enabled in this environment." };
  }
  const { ctx, clinicianId } = await clinicianContext();
  const thoughtId = String(formData.get("thoughtId") ?? "");
  const transcriptVersion = Number(formData.get("transcriptVersion") ?? 0);
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "");
  if (!idempotencyKey) return { ok: false, error: "That could not be saved. Please try again." };

  let decisions: unknown;
  try {
    decisions = JSON.parse(String(formData.get("decisions") ?? "[]"));
  } catch {
    return { ok: false, error: "That could not be saved. Please try again." };
  }
  if (!Array.isArray(decisions)) return { ok: false, error: "That could not be saved. Please try again." };

  const { saveThoughts, StaleSubmissionError, UndecidedCandidatesError } = await import("./save-thoughts");
  try {
    const result = await saveThoughts(ctx, {
      thoughtId,
      transcriptVersion,
      idempotencyKey,
      decisions: decisions as never,
    });
    const thought = await getThought(ctx, thoughtId);
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "clinician_thought_items_saved", target: thoughtId,
      detail: {
        personId: thought?.personId,
        approved: result.approved.length,
        rejected: result.rejected.length,
        replayed: result.replayed,
      },
    });
    if (thought) revalidatePath(`/clinician/member/${thought.personId}/thoughts`);
    return { ok: true, thoughtId };
  } catch (e) {
    if (e instanceof StaleSubmissionError) {
      // Retryable only after a reload: the screen is out of date, and trying
      // the same submission again would fail the same way.
      return { ok: false, error: e.message };
    }
    if (e instanceof UndecidedCandidatesError) {
      return { ok: false, error: "Every item needs a Keep or Remove before you can save." };
    }
    if (e instanceof InvalidTransitionError) {
      return { ok: false, error: "That recording is no longer available." };
    }
    throw e;
  }
}

/** Correct an approved item (§16).
 *
 *  A CORRECTION, NOT AN EDIT. The prior item is superseded and stays readable;
 *  the replacement carries the same statement class and the same citation. What
 *  cannot be changed here is what KIND of claim it is — turning an observation
 *  into a hypothesis is not a wording fix, it is a different item, and it goes
 *  through rejection and re-approval where it is visible. */
export async function correctMemoryItemAction(formData: FormData): Promise<ActionResult> {
  if (!thoughtsSurfaceAvailable("CLINICIAN_THOUGHTS_EXTRACTION")) {
    return { ok: false, error: "Organizing thoughts is not enabled in this environment." };
  }
  const { ctx, clinicianId } = await clinicianContext();
  const priorItemId = String(formData.get("itemId") ?? "");
  const displayText = String(formData.get("displayText") ?? "").trim().slice(0, 1000);
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500) || null;
  if (!priorItemId || !displayText) return { ok: false, error: "A correction needs the new wording." };

  const { supersedeItem, NotACandidateError } = await import("./memory-store");
  const { recordItemCorrected } = await import("./thoughts");
  try {
    const { prior, replacement } = await supersedeItem(ctx, {
      priorItemId, displayText, at: new Date().toISOString(),
    });
    await recordItemCorrected({
      priorItemId: prior.id, replacementItemId: replacement.id,
      tenantId: ctx.tenantId, personId: prior.personId,
      reason, correctedBy: clinicianId,
    });
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "clinical_memory_item_corrected", target: replacement.id,
      // The act and the link, never the words.
      detail: { personId: prior.personId, priorItemId: prior.id, hasReason: !!reason },
    });
    revalidatePath(`/clinician/member/${prior.personId}/thoughts`);
    return { ok: true };
  } catch (e) {
    if (e instanceof NotACandidateError) return { ok: false, error: e.message };
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
