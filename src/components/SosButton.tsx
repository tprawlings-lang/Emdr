"use client";

import { useEffect, useRef, useState } from "react";
import { recordSosOpenedAction } from "@/lib/actions";
import type { SosPanel } from "@/lib/sos";

// Persistent panic button (roadmap F7). Fixed to the corner on every member
// screen; one tap opens immediate, member-initiated relief — a paced breath,
// their own calm place, a one-tap call to the person they named, and the
// crisis line. No gate, no upsell, no navigation away required.

function contactHref(method: string | null): string | null {
  if (!method) return null;
  const m = method.trim();
  if (m.includes("@") && !m.includes(" ")) return `mailto:${m}`;
  const digits = m.replace(/[^0-9+]/g, "");
  if (digits.replace(/\D/g, "").length >= 7) return `tel:${digits}`;
  return null;
}

/** Slow paced breath: 4s in, 6s out — the longer exhale settles the nervous
 *  system.
 *
 *  ITS OWN COMPONENT SO ITS STATE RESETS BY MOUNTING. The phase used to live in
 *  SosButton, which stays mounted while the panel opens and closes, so every
 *  open had to begin by resetting it — a setState called synchronously inside
 *  an effect, which costs an extra render pass every time a distressed member
 *  presses the button. Rendering this inside the panel means "start on the
 *  in-breath" is simply the initial state.
 *
 *  The phase is also derived from ELAPSED TIME rather than a toggle. A toggle
 *  drifts whenever the browser throttles a background tab, and a paced-breathing
 *  circle that has drifted is worse than none: the member follows it and finds
 *  their breathing does not fit. */
function PacedBreath() {
  const [phase, setPhase] = useState<"in" | "out">("in");

  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => {
      setPhase(Math.floor((Date.now() - startedAt) / 5000) % 2 === 0 ? "in" : "out");
    }, 250);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mt-8 flex flex-col items-center">
      <div
        className="flex items-center justify-center rounded-full bg-sage/40"
        style={{
          width: phase === "in" ? 200 : 120,
          height: phase === "in" ? 200 : 120,
          transition: phase === "in" ? "width 4s ease-in-out, height 4s ease-in-out" : "width 6s ease-in-out, height 6s ease-in-out",
        }}
      >
        <span className="type-identity text-2xl text-ground">
          {phase === "in" ? "Breathe in" : "Breathe out"}
        </span>
      </div>
      <p className="mt-4 text-sm text-olive">In through the nose, slow out through the mouth.</p>
    </div>
  );
}

export default function SosButton({ panel }: { panel: SosPanel }) {
  const [open, setOpen] = useState(false);
  const recorded = useRef(false);

  function openPanel() {
    setOpen(true);
    if (!recorded.current) {
      recorded.current = true;
      void recordSosOpenedAction();
    }
  }

  const support = contactHref(panel.supportContactMethod);

  return (
    <>
      <button
        onClick={openPanel}
        aria-label="Open immediate support"
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-ground text-sm font-bold text-white shadow-lg transition-transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-ground/30"
      >
        SOS
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Immediate support"
          className="fixed inset-0 z-50 overflow-y-auto bg-ivory"
        >
          <div className="mx-auto max-w-xl px-6 py-10">
            <div className="flex items-center justify-between">
              <h2 className="type-display text-3xl font-medium text-ground">You&apos;re not alone</h2>
              <button
                onClick={() => setOpen(false)}
                className="rounded-full border border-ground/20 px-4 py-2 text-sm text-ground/80 transition-colors hover:bg-moss"
              >
                Close
              </button>
            </div>
            <p className="mt-2 text-olive">Let&apos;s slow things down together. One breath at a time.</p>

            <PacedBreath />

            {panel.reminderPhrase && (
              <div className="mt-8 rounded-3xl bg-moss p-6 text-center">
                <p className="text-sm text-olive">You asked Steady to remind you:</p>
                <p className="mt-2 type-display text-2xl font-medium">&ldquo;{panel.reminderPhrase}&rdquo;</p>
              </div>
            )}

            {panel.calmPlace && (
              <div className="mt-6 rounded-3xl border border-ground/10 bg-linen p-6 shadow-soft">
                <h3 className="font-semibold text-ground">Your calm place</h3>
                <p className="mt-2 leading-relaxed text-ground/90">{panel.calmPlace}</p>
              </div>
            )}

            {panel.groundingTools.length > 0 && (
              <div className="mt-6 rounded-3xl border border-ground/10 bg-linen p-6 shadow-soft">
                <h3 className="font-semibold text-ground">What has helped you before</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {panel.groundingTools.map((t) => (
                    <span key={t} className="rounded-full bg-sage/30 px-4 py-1.5 text-sm">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Reach a person */}
            <div className="mt-8 space-y-3">
              {support && panel.supportContactName && (
                <a
                  href={support}
                  className="block rounded-3xl bg-sage px-6 py-4 text-center text-lg font-semibold text-ground transition-colors hover:bg-sage-deep"
                >
                  Reach {panel.supportContactName}
                </a>
              )}
              {panel.supportContactName && !support && (
                <div className="rounded-3xl border border-ground/10 bg-linen p-5 text-center">
                  <p className="text-sm text-olive">Your safe person</p>
                  <p className="mt-1 font-medium text-ground">{panel.supportContactName}</p>
                  {panel.supportContactMethod && (
                    <p className="text-sm text-olive">{panel.supportContactMethod}</p>
                  )}
                </div>
              )}
              <a
                href={panel.crisisHref}
                className="block rounded-3xl bg-ground px-6 py-4 text-center text-lg font-bold text-white transition-colors hover:bg-ground"
              >
                {panel.crisisLabel} (US)
              </a>
              <a
                href="tel:911"
                className="block rounded-3xl border-2 border-ground px-6 py-3 text-center font-semibold text-ground transition-colors hover:bg-ground/10"
              >
                Call 911 (immediate danger)
              </a>
            </div>

            <div className="mt-8 flex flex-wrap justify-center gap-4 text-sm">
              <a href="/app/ground" className="text-ground underline">More grounding steps</a>
              <a href="/crisis" className="text-ground underline">All crisis resources</a>
            </div>

            <p className="mt-8 text-center text-xs text-olive">
              Steady is not emergency care and this panel is not monitored. If you are in
              immediate danger, call 911 or your local emergency number.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
