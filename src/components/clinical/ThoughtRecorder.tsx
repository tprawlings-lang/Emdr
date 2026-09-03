"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  startThoughtAction, finalizeThoughtAction, discardThoughtAction,
} from "@/lib/clinical/thought-actions";

// The recording screen (§3.1).
//
// MEDIA CAPTURE ONLY. §20's file map says so in as many words — "no clinical
// domain decisions" — and it is the reason this file is safe to be a client
// component at all. It starts a recorder, stops it, and posts the bytes. It
// does not decide what a thought means, when one is reviewable, or whether a
// failure is recoverable; every one of those lives on the server where it is
// tested.
//
// THE PATIENT'S NAME IS AT THE TOP, and that is a safety control rather than a
// nicety. §3.1: "Display patient name at the top so the clinician can
// immediately catch a wrong-person error." A clinician who has just finished
// one session and opened another patient's record is exactly the person who
// records ninety seconds about the wrong person, and the moment to catch it is
// before they speak, not in a review screen afterwards.
//
// NO FILING FIRST. §3: "Do not ask the clinician to choose a note type,
// category, diagnosis, tag, or folder before recording." The whole promise of
// the feature is a useful thought captured with no filing work; a type picker
// in front of the record button spends the promise before it is kept.

type Phase = "idle" | "requesting" | "recording" | "paused" | "uploading" | "error";

const MIME_CANDIDATES = ["audio/webm", "audio/ogg", "audio/mp4"];

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? "audio/webm";
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function ThoughtRecorder({
  personId,
  personName,
  onCaptured,
}: {
  personId: string;
  /** Shown first, so a wrong-person error is caught before anything is said. */
  personName: string;
  /** Called once the server has the recording. */
  onCaptured: (result: { ok: boolean; thoughtId?: string; error?: string; retryable?: boolean }) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const thoughtIdRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  const accumulatedRef = useRef(0);

  // The tracks are released on unmount whatever happened, so navigating away
  // mid-recording does not leave a microphone open. A recording indicator that
  // outlives the screen is both a privacy problem and the kind of thing that
  // makes people stop trusting the feature.
  useEffect(() => () => {
    try { recorderRef.current?.stop(); } catch { /* already stopped */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(
      () => setElapsed(accumulatedRef.current + (Date.now() - startedAtRef.current)),
      200
    );
    return () => clearInterval(id);
  }, [phase]);

  const start = useCallback(async () => {
    setError(null);
    setPhase("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // The server row is created BEFORE recording, so the upload has an id to
      // attach to and an interrupted session leaves a record of an attempt
      // rather than nothing at all.
      const started = await startThoughtAction(personId);
      if (!started.ok || !started.thoughtId) {
        stream.getTracks().forEach((t) => t.stop());
        setError(started.error ?? "Recording could not be started.");
        setPhase("error");
        return;
      }
      thoughtIdRef.current = started.thoughtId;

      const recorder = new MediaRecorder(stream, { mimeType: pickMimeType() });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.start(1000);
      recorderRef.current = recorder;
      accumulatedRef.current = 0;
      startedAtRef.current = Date.now();
      setElapsed(0);
      setPhase("recording");
    } catch {
      setError("Steady could not reach your microphone. Check your browser's permissions.");
      setPhase("error");
    }
  }, [personId]);

  const pause = useCallback(() => {
    if (!recorderRef.current || phase !== "recording") return;
    recorderRef.current.pause();
    accumulatedRef.current += Date.now() - startedAtRef.current;
    setElapsed(accumulatedRef.current);
    setPhase("paused");
  }, [phase]);

  const resume = useCallback(() => {
    if (!recorderRef.current || phase !== "paused") return;
    recorderRef.current.resume();
    startedAtRef.current = Date.now();
    setPhase("recording");
  }, [phase]);

  const finish = useCallback(async () => {
    const recorder = recorderRef.current;
    const thoughtId = thoughtIdRef.current;
    if (!recorder || !thoughtId) return;

    const durationMs = phase === "paused"
      ? accumulatedRef.current
      : accumulatedRef.current + (Date.now() - startedAtRef.current);

    setPhase("uploading");
    const blob: Blob = await new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: recorder.mimeType }));
      recorder.stop();
    });
    streamRef.current?.getTracks().forEach((t) => t.stop());

    const form = new FormData();
    form.set("thoughtId", thoughtId);
    form.set("durationMs", String(Math.max(0, Math.round(durationMs))));
    form.set("audio", blob, "thought.webm");
    const result = await finalizeThoughtAction(form);

    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      setPhase("error");
    } else {
      setPhase("idle");
      setElapsed(0);
    }
    onCaptured(result);
  }, [phase, onCaptured]);

  const cancel = useCallback(async () => {
    const captured = chunksRef.current.length > 0;
    // §3.1: "On Cancel, require a second action only if audio has already been
    // captured." Nothing recorded yet is nothing to lose, and a confirmation
    // for it teaches people to click through confirmations.
    if (captured && !window.confirm("Discard this recording? It has not been saved.")) return;

    try { recorderRef.current?.stop(); } catch { /* already stopped */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (thoughtIdRef.current) {
      const form = new FormData();
      form.set("thoughtId", thoughtIdRef.current);
      await discardThoughtAction(form);
    }
    thoughtIdRef.current = null;
    chunksRef.current = [];
    accumulatedRef.current = 0;
    setElapsed(0);
    setPhase("idle");
  }, []);

  const live = phase === "recording" || phase === "paused";

  return (
    <div className="rounded-2xl border border-ground/10 bg-app-surface px-5 py-5">
      {/* First, and before any control. A wrong-person error is caught here or
          not at all. */}
      <p className="text-sm text-olive">Recording a thought about</p>
      <p className="text-lg font-medium text-app-ink">{personName}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center gap-2 text-sm font-medium ${
            phase === "recording" ? "text-state-support" : "text-olive"
          }`}
          // The live region announces state changes without a visual cue being
          // the only signal.
          aria-live="polite"
        >
          <span aria-hidden>{phase === "recording" ? "●" : phase === "paused" ? "❙❙" : "○"}</span>
          {phase === "recording" && "Recording"}
          {phase === "paused" && "Paused"}
          {phase === "requesting" && "Waiting for your microphone…"}
          {phase === "uploading" && "Saving your recording…"}
          {phase === "idle" && "Not recording"}
          {phase === "error" && "Stopped"}
        </span>
        {(live || elapsed > 0) && (
          <span className="font-mono text-sm text-ground" aria-label="Elapsed time">
            {clock(elapsed)}
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {phase === "idle" || phase === "error" ? (
          <button
            type="button"
            onClick={start}
            className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-linen"
          >
            Record
          </button>
        ) : null}
        {phase === "recording" && (
          <button type="button" onClick={pause}
            className="rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-app-ink">
            Pause
          </button>
        )}
        {phase === "paused" && (
          <button type="button" onClick={resume}
            className="rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-app-ink">
            Resume
          </button>
        )}
        {live && (
          <button type="button" onClick={finish}
            className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-linen">
            Done
          </button>
        )}
        {(live || phase === "uploading") && (
          <button type="button" onClick={cancel} disabled={phase === "uploading"}
            className="rounded-full px-4 py-2 text-sm text-olive underline disabled:opacity-50">
            Cancel
          </button>
        )}
      </div>

      {error && (
        <p className="measure mt-4 text-sm text-state-support" role="alert">{error}</p>
      )}

      {/* §3.1's duration guidance is guidance. It is not enforced, because a
          clinician mid-thought at 3:01 should not be cut off. */}
      <p className="measure mt-4 text-xs text-olive">
        Most thoughts take thirty seconds to three minutes. Say it however it comes out —
        Steady organizes it afterwards, and you review what it did before anything is saved.
      </p>
    </div>
  );
}
