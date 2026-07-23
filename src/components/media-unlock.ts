"use client";

// iOS/iPadOS Safari only lets audio + speech start from *inside* a user-gesture
// call stack (a real tap handler). A React effect runs after render, which iOS no
// longer counts as a gesture — so audio created/resumed there stays suspended and
// the set never advances. These helpers must be called SYNCHRONOUSLY from a tap
// handler to unlock media; BlsStimulus then reuses the already-running context.

let sharedCtx: AudioContext | null = null;

/** The one shared AudioContext (created lazily). Reused across sets so the iOS
 *  gesture-unlock done in a tap handler carries over. Never closed mid-session. */
export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    (undefined as unknown as typeof AudioContext);
  if (!AC) return null;
  if (!sharedCtx || sharedCtx.state === "closed") {
    try {
      sharedCtx = new AC();
    } catch {
      return null;
    }
  }
  return sharedCtx;
}

/** Unlock audio + speech. MUST be called synchronously inside a tap handler so
 *  iOS honors it. Resumes the context and plays a 1-sample silent buffer (the iOS
 *  unlock trick), and primes speech synthesis with a silent utterance. Idempotent
 *  and safe to call on every relevant tap. */
export function unlockMedia(): void {
  // Audio.
  const ctx = getAudioContext();
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* no-op */
    }
  }
  // Speech: a silent utterance inside the gesture unlocks later spoken cues on iOS.
  if (typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window) {
    try {
      window.speechSynthesis.resume();
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch {
      /* no-op */
    }
  }
}
