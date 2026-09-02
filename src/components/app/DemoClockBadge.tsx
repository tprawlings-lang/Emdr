import { readClock } from "@/lib/demo-clock";

// p9: "Advance clock — guard: demo only; CLOCK SHOWN IN SHELL."
//
// An async server component rather than a prop, so every console gets it
// without six page wrappers each remembering to pass it down. The one that
// forgot would be the one a presenter was using.
//
// It renders NOTHING when the clock is live. A live clock is the absence of a
// claim, and a permanent "the date is today" badge is noise that teaches
// people to stop reading this corner of the frame — which is the corner the
// FABRICATED flag lives in.
export async function DemoClockBadge() {
  const clock = await readClock();
  if (clock.live) return null;

  const day = clock.now.toISOString().slice(0, 10);
  const label = clock.milestone ? `${clock.milestone.label} · ${day}` : day;

  return (
    <span
      className="rounded-full bg-state-caution-bg px-3 py-1 text-xs font-semibold text-app-ink"
      title={
        `The demo clock is set to ${day}. Every window, refresh time and milestone on this ` +
        "screen is measured from that date, not from today. Audit records, sessions and rate " +
        "limits are not affected — the clock moves the reading, never the record."
      }
    >
      Clock: {label}
    </span>
  );
}
