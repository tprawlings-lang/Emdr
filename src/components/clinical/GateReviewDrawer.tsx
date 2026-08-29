"use client";

import { useState } from "react";
import type { GateDecision, GateState } from "@/lib/clinical/gate-review";

// The clinician gate-review drawer (GUI and Decision-Surface Handoff §9.2).
//
// §9.2 lists eight things the drawer must show, and the list is the
// specification: current decision and effective time, rule and version,
// human-readable reasons, evidence references, what may be approved/corrected/
// overridden, WHAT CANNOT BE OVERRIDDEN, the prior decision and change, the
// member-safe copy preview, and the confirmation plus resulting audit record.
//
// Two of those carry most of the weight.
//
// The member-copy preview, because a reason that reads fine in clinical
// shorthand can read badly to a person in distress, and the only reliable place
// to notice that is next to the decision at review time.
//
// The "cannot be overridden" list, because a drawer that shows only what CAN be
// relaxed invites the reading that everything else is merely absent from this
// screen. Naming the boundary is what makes an override a bounded instrument
// rather than a general-purpose unlock.
//
// A client component because it opens and closes; every decision in it was made
// on the server. §15.1 forbids optimistic updates for approve, correct and
// override, so the form posts and waits rather than reflecting a hoped-for
// result.

const STATE_STYLE: Record<GateState, { cls: string; glyph: string; label: string }> = {
  open:          { cls: "bg-state-safe-bg text-state-safe",       glyph: "◆", label: "Open" },
  caution:       { cls: "bg-state-caution-bg text-state-caution", glyph: "◈", label: "Caution" },
  limited:       { cls: "bg-state-caution-bg text-state-caution", glyph: "◐", label: "Limited" },
  review_needed: { cls: "bg-state-review-bg text-state-review",   glyph: "◷", label: "Review needed" },
  safety_stop:   { cls: "bg-state-support-bg text-state-support", glyph: "▲", label: "Safety stop" },
  unknown:       { cls: "bg-state-unknown-bg text-state-unknown", glyph: "?", label: "Unknown" },
};

function StateChip({ state }: { state: GateState }) {
  const s = STATE_STYLE[state];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${s.cls}`}>
      <span aria-hidden>{s.glyph}</span>
      {s.label}
    </span>
  );
}

export function GateReviewDrawer({
  decision,
  moduleNames,
  canOverride,
  overrideAction,
}: {
  decision: GateDecision;
  /** Every module this one cause currently applies to. Named rather than
   *  hidden: a clinician needs to know the blast radius of the decision they
   *  are about to relax. */
  moduleNames: string[];
  /** Computed on the server. The drawer never decides this for itself. */
  canOverride: boolean;
  overrideAction: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const d = decision;

  return (
    <div className="rounded-3xl border border-ground/10 bg-linen">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-3">
          <StateChip state={d.state} />
          <span className="min-w-0">
            {/* The chip already carries the state word; repeating it in the
                headline reads as a stutter ("Limited · Limited — screening
                incomplete"). Strip the prefix and keep the cause. */}
            <span className="block font-medium text-ground first-letter:uppercase">
              {d.headline.replace(new RegExp(`^${STATE_STYLE[d.state].label}\\s*—\\s*`, "i"), "")}
            </span>
            <span className="block text-sm text-olive">
              {moduleNames.length === 1
                ? moduleNames[0]
                : `${moduleNames.length} modules`}
            </span>
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-olive">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-ground/10 px-5 py-5">
          {/* Decision, rule, effective time — §9.2's first two requirements. */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-olive">Decision</p>
              <p className="mt-1 text-sm text-ground">{d.headline}</p>
              <p className="mt-0.5 text-xs text-olive">Effective {d.effectiveAt}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-olive">Why</p>
              <ul className="mt-1 space-y-1">
                {d.reasons.length === 0 ? (
                  <li className="text-sm text-olive">No constraint applied.</li>
                ) : (
                  d.reasons.map((r) => (
                    <li key={r.code} className="text-sm text-ground">
                      {r.label}
                      <span className="block font-mono text-xs text-olive">{r.code}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-olive">Policy</p>
              <p className="mt-1 font-mono text-sm text-ground">{d.policy.id}</p>
              <p className="mt-0.5 font-mono text-xs text-olive">{d.policy.version}</p>
            </div>
          </div>

          {moduleNames.length > 1 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-olive">
                Applies to ({moduleNames.length})
              </p>
              <p className="mt-1 text-sm text-ground">{moduleNames.join(" · ")}</p>
            </div>
          )}

          {/* Evidence — §9.2 requires references, not a bare conclusion. */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-olive">Evidence</p>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {d.evidence.map((e, i) => (
                <li key={i} className="text-sm text-ground">
                  {e.label}{" "}
                  {/* An absence has no timestamp, and saying so is the point —
                      "no check-in today" is frequently the whole reason. */}
                  <span className="text-xs text-olive">{e.at ?? "— not recorded"}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Prior decision — §9.2's "prior decision and change". */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-olive">Prior decision</p>
            {d.prior ? (
              <p className="mt-1 text-sm text-ground">
                <StateChip state={d.prior.state} />{" "}
                <span className="text-olive">on {d.prior.at}</span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-state-unknown">
                No prior decision on record. This is not the same as unchanged.
              </p>
            )}
          </div>

          {/* Member-safe copy preview — §9.2. The clinician reads the exact
              sentence the member reads. */}
          <div className="rounded-2xl border border-ground/10 bg-ivory p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-olive">
              What the member sees
            </p>
            <p className="mt-1.5 text-ground">{d.memberCopy}</p>
            <p className="mt-1 text-sm text-olive">
              Primary action: {d.memberAction}
              {d.safeAlternative && <> · Safe alternative: {d.safeAlternative}</>}
            </p>
          </div>

          {/* Allowed actions, and the boundary. */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-olive">Allowed actions</p>
            {canOverride ? (
              <div className="mt-2">
                {!confirming ? (
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className="rounded-full border border-ground/25 px-4 py-2 text-sm font-medium text-ground hover:bg-ground/5"
                  >
                    Relax pacing ({d.overridable})
                  </button>
                ) : (
                  // §15.2: an override is a HIGH-RISK confirmation carrying its
                  // scope. §15.1: no optimistic update — the form posts and the
                  // server returns the new state.
                  <form action={overrideAction} className="space-y-3 rounded-2xl border border-state-caution/40 bg-state-caution-bg/40 p-4">
                    <input type="hidden" name="personId" value={d.personId} />
                    <input type="hidden" name="target" value={d.overridable ?? ""} />
                    <p className="text-sm font-semibold text-ground">
                      Relax {d.overridable} — affects {moduleNames.length} module{moduleNames.length === 1 ? "" : "s"}
                    </p>
                    <p className="text-xs text-ground/90">
                      Scope: pacing only. This does not relax the daily check-in read, crisis
                      routing, cooldowns, the daily cap, the fitness screener, or the kill
                      switch. The override is recorded against you with its reason.
                    </p>
                    <label className="block text-sm">
                      <span className="font-medium text-ground">Clinical reason</span>
                      <textarea
                        name="reason"
                        required
                        minLength={10}
                        rows={3}
                        className="mt-1 w-full rounded-2xl border border-ground/20 bg-ivory px-3 py-2 text-sm"
                        placeholder="Why this member, why now."
                      />
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        className="rounded-full bg-ground px-4 py-2 text-sm font-medium text-ivory"
                      >
                        Review and record action
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(false)}
                        className="rounded-full border border-ground/25 px-4 py-2 text-sm text-ground"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ) : (
              // Not a disabled button. §15.2: "Attempt safety-stop override —
              // do not render the action."
              <p className="mt-1 text-sm text-olive">
                No override is available for this decision.
              </p>
            )}
          </div>

          {/* What cannot be overridden — §9.2, stated always, including when an
              override IS available, because that is exactly when the boundary
              needs to be legible. */}
          <div className="rounded-2xl border border-ground/10 bg-ivory p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-olive">
              Cannot be overridden
            </p>
            <p className="mt-1.5 text-sm text-ground">
              {d.neverOverridable.join(" · ")}
            </p>
            <p className="mt-1.5 text-xs text-olive">
              An override relaxes pacing only. A safety stop cannot be overridden by any role,
              and the action is not offered anywhere in this console.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
