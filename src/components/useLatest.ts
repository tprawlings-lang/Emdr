"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

// The "latest value" ref, written correctly, once.
//
// SIX COMPONENTS HAD THEIR OWN COPY, and all six wrote it the same wrong way:
//
//   const failRef = useRef(onFailure);
//   failRef.current = onFailure;      // ← during render
//
// The intent is right and the placement is not. React may render a component
// and then throw the result away — a concurrent render that gets interrupted, a
// suspended tree, StrictMode's double invocation in development. A ref written
// during render therefore holds a value from a render that may never have
// committed, and the effect that reads it later acts on state the user never
// saw. React's own linter rejects it outright ("Cannot access refs during
// render"), which is how this was found.
//
// WHY IT MATTERED HERE AND NOT MERELY IN THEORY. The six were BlsStimulus
// (the moving dot's completion and failure callbacks), BreathePacer,
// NarrationView, ResourcingSession and useSpeech — the components that drive
// bilateral stimulation timing, spoken narration and a resourcing session's
// place and cue word. A stale callback in that set is a set that completes into
// the wrong handler, or a spoken line naming a calm place the member has
// already changed. Those are exactly the surfaces a clinical reviewer is being
// asked to trust.
//
// useLayoutEffect rather than useEffect: the ref must be current before any
// other effect reads it, and layout effects run first. It is client-only by the
// directive above, so the server never reaches the effect at all.

/** A ref that always holds the latest committed value.
 *
 *  Use it for callbacks and values an effect needs to read WITHOUT that effect
 *  re-running when they change — a stimulation set must not restart because its
 *  parent re-rendered and handed down a new function identity. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
