"use client";

import { useState } from "react";
import VoiceInput from "@/components/VoiceInput";

// Clinician review widget: lets the reviewer experience voice input exactly as
// a member would — speak, then read/correct/confirm the recognized text in an
// editable field before it would be "saved." Demonstrates VOICE_INPUT_CONFIRM
// and VOICE_INPUT_SCOPE. Nothing here writes to the database.
export default function VoiceReviewDemo() {
  const [value, setValue] = useState("");
  return (
    <div className="rounded-xl border border-ground/10 bg-linen/40 p-4">
      <p className="text-sm font-medium">Try it as a member would</p>
      <p className="mt-1 text-xs text-ground/70">
        Speak an example reflection (e.g. “raised voices in the next room”). The recognized
        text lands in the editable box — where the member reads it, fixes any mistakes, and
        only then confirms. Voice never submits on its own.
      </p>
      <div className="mt-3">
        <VoiceInput onTranscript={(t) => setValue((p) => (p.trim() ? `${p} ${t}` : t))} />
      </div>
      <label className="mt-3 block">
        <span className="text-xs font-medium text-olive">Recognized text (editable — this is the confirm step)</span>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={3}
          placeholder="What you say appears here for you to review and edit…"
          className="mt-1 w-full rounded-lg border border-ground/15 bg-ivory px-3 py-2 text-sm"
        />
      </label>
      <p className="mt-1 text-[11px] text-olive/80">
        Preview uses your browser’s built-in speech recognition. In the shipped mobile app,
        recognition runs on-device and no audio leaves the phone (VOICE_INPUT_ON_DEVICE).
      </p>
    </div>
  );
}
