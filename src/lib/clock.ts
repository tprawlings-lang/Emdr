import { cache } from "react";
import { readClock } from "./demo-clock";

// The clock contract (17 September handoff, UX 003).
//
//   "Observed. The demo clock showed December 2025 while clinical evidence used
//   September 2026. Define and apply one explicit clock contract. Acceptance: a
//   scenario date change updates every dependent read consistently."
//
// THERE ARE TWO CLOCKS AND THEY ANSWER DIFFERENT QUESTIONS.
//
//   THE READING FRAME — what "now" means for anything a person READS as an age,
//   a window, a due date or a freshness label. This is the clock the demo
//   control moves, and this module is the only way to obtain it.
//
//   REAL TIME — what "now" means for anything the product WRITES: audit rows,
//   session issue and expiry, rate limits, `reviewed_at` on a closed alert,
//   `set_at` on the clock itself. `new Date()`, always, and never from here.
//
// The boundary is already argued in demo-clock.ts and guarded in
// tests/demo-clock.test.ts: a clock that could backdate an audit row would turn
// a tamper-evident chain into a chain of whatever somebody set the date to.
// What was missing was the other half — the reading side had no contract at
// all, so every screen chose for itself, and almost every screen chose wrong.
//
// HOW THE DEFECT HAPPENED, because the shape matters more than the instance.
// Twenty-seven functions across the read path were written as
//
//     const now = args.now ?? new Date();
//
// which is a default that silently answers with REAL time in a product whose
// data is read through a moved frame. Nothing fails; nothing is logged; the
// number on the screen is simply wrong, and wrong in a way that reads as
// plausible. `buildWorkQueue` had it worst — it took a `now`, used it for its
// own windows, and then called `buildCaseload` without passing it on, so one
// projection carried two clocks and the row ages disagreed with the header
// above them.
//
// Meanwhile the shell was making the claim out loud. DemoClockBadge tells a
// reader, in a tooltip, that "every window, refresh time and milestone on this
// screen is measured from that date". That sentence was false on every
// clinician screen. This module is what makes it true.
//
// SO THE DEFAULT IS INVERTED RATHER THAN THE PARAMETER REMOVED. A read function
// that is handed no clock now resolves the reading frame instead of real time,
// because the failure mode of forgetting must be the harmless one. A caller
// that genuinely wants real time in a read — there is currently none — has to
// say `new Date()` where a reader can see it.

/** What "now" means for everything derived on one screen. */
export interface ReadingFrame {
  /** The instant every age, window and due date on the screen is measured from. */
  now: Date;
  /** True when that instant is the real one. */
  live: boolean;
  /**
   * What the frame is, in words, or null when it is simply now.
   *
   * Null rather than "live" on purpose: a permanent "the date is today" label
   * is noise that teaches people to stop reading the corner of the frame it
   * sits in — which is the corner the FABRICATED flag lives in. The same
   * argument DemoClockBadge makes, in the data rather than in the markup, so a
   * screen that is not the shell can make it too.
   */
  label: string | null;
}

/**
 * The reading frame for this render.
 *
 * Memoised with React's `cache`, which deduplicates within a single render pass
 * — the documented answer for direct database access in this version of Next.
 * Twenty-odd modules asking the same question during one page render is twenty
 * identical queries otherwise, and, worse, twenty chances for the answer to
 * change underneath a screen while it is being built.
 *
 * Outside a render `cache` passes straight through, so a test sees a live
 * function and a clock moved mid-test moves the next reading. In any
 * environment that is not a demonstration `readClock` returns before it touches
 * the database at all, so this costs a function call in production.
 */
export const readingFrame = cache(async (): Promise<ReadingFrame> => {
  const clock = await readClock();
  if (clock.live) return { now: clock.now, live: true, label: null };
  const day = clock.now.toISOString().slice(0, 10);
  return {
    now: clock.now,
    live: false,
    label: clock.milestone ? `${clock.milestone.label} · ${day}` : day,
  };
});

/**
 * The instant to measure a read from.
 *
 * The shorthand the read path actually wants: `const now = args.now ?? await
 * readingNow()`. Anything that needs to SAY which frame it is in takes the
 * whole frame instead.
 */
export async function readingNow(): Promise<Date> {
  return (await readingFrame()).now;
}
