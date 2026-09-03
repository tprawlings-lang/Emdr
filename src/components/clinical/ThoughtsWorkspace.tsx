"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ThoughtRecorder } from "./ThoughtRecorder";
import { ThoughtReview, type ReviewTranscript } from "./ThoughtReview";

// Sequences record → review (§3's six interaction states), and nothing else.
//
// Split from both components on purpose. The recorder owns media, the review
// owns the transcript, and the ORDER between them is a third concern that would
// otherwise have to live inside one of them — which is how a recorder ends up
// knowing what a transcript is.
//
// The processing copy comes from §17.4's table verbatim in meaning: each state
// says what is happening to the clinician's recording, and the failure line
// leads with the recording being safe rather than with the failure. A clinician
// who has just spoken for ninety seconds needs to know their words survived
// before they need to know what went wrong.

type Stage =
  | { kind: "recording" }
  | { kind: "processing" }
  | { kind: "review"; thoughtId: string; transcript: ReviewTranscript; transcriptOnly: boolean }
  | { kind: "failed"; message: string; retryable: boolean };

export function ThoughtsWorkspace({
  personId,
  personName,
  /** Fetches the transcript for a thought once processing finishes. Passed in
   *  so this component never talks to the database and can be rendered in a
   *  test without one. */
  loadTranscript,
}: {
  personId: string;
  personName: string;
  loadTranscript: (thoughtId: string) => Promise<
    { transcript: ReviewTranscript; transcriptOnly: boolean } | null
  >;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "recording" });
  const router = useRouter();

  return (
    <div className="space-y-4">
      {stage.kind === "recording" && (
        <ThoughtRecorder
          personId={personId}
          personName={personName}
          onCaptured={async (result) => {
            if (!result.ok || !result.thoughtId) {
              setStage({
                kind: "failed",
                message: result.error ?? "Something went wrong.",
                retryable: result.retryable ?? false,
              });
              return;
            }
            setStage({ kind: "processing" });
            const loaded = await loadTranscript(result.thoughtId);
            if (!loaded) {
              setStage({
                kind: "failed",
                message: "Your recording is safe, but its transcript could not be loaded.",
                retryable: true,
              });
              return;
            }
            setStage({ kind: "review", thoughtId: result.thoughtId, ...loaded });
          }}
        />
      )}

      {stage.kind === "processing" && (
        <div className="rounded-2xl border border-ground/10 bg-app-surface px-5 py-5" aria-live="polite">
          <p className="text-sm font-medium text-app-ink">Creating a transcript…</p>
          <p className="measure mt-2 text-sm text-olive">
            Your recording is saved. This takes a few seconds.
          </p>
        </div>
      )}

      {stage.kind === "review" && (
        <ThoughtReview
          thoughtId={stage.thoughtId}
          transcript={stage.transcript}
          transcriptOnly={stage.transcriptOnly}
          onDone={() => {
            setStage({ kind: "recording" });
            router.refresh();
          }}
        />
      )}

      {stage.kind === "failed" && (
        <div className="rounded-2xl border border-ground/10 bg-app-surface px-5 py-5" role="alert">
          {/* The recording first, the failure second. */}
          <p className="measure text-sm text-ground">{stage.message}</p>
          <button
            type="button"
            onClick={() => setStage({ kind: "recording" })}
            className="mt-4 rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-app-ink"
          >
            {stage.retryable ? "Try again" : "Record another thought"}
          </button>
        </div>
      )}
    </div>
  );
}
