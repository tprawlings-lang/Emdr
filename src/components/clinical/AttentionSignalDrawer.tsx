"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  loadCommandContext, acknowledgeSignalAction, setSignalStateAction,
} from "@/lib/clinical/attention-actions";
import type { CommandContext, SectionMissing } from "@/lib/clinical/command-context";
// The VOCABULARY module, not the store. This runs in the browser and the store
// reaches better-sqlite3; the build refuses that, correctly, and refused this
// before the split.
import {
  DISMISS_REASONS, DISMISS_REASON_LABEL, BAND_LABEL,
} from "@/lib/clinical/attention-vocabulary";

// The Quick Review Drawer (expansion handoff 03 §5, §12, §19; Phase 3).
//
// §5 lists the sections and the rules under them; §19 lists the interaction
// requirements. Three of those requirements are the ones a drawer usually gets
// wrong, and they are the reason this is a client component at all:
//
//   FOCUS IS TRAPPED WHILE OPEN AND RETURNS TO THE ROW ON CLOSE. §19. A drawer
//   that leaves focus behind it puts a keyboard user back at the top of a
//   fifty-row queue every time they close one, which makes the queue unusable
//   without a mouse.
//
//   ESCAPE CLOSES IT, and closing it changes nothing. §12: "opening a row or
//   drawer does not silently acknowledge it. Acknowledgement is explicit."
//
//   STATUS IS NOT COMMUNICATED BY COLOUR ALONE. §19. Every state in here is a
//   word before it is a treatment.
//
// AND ONE RULE ABOUT WHAT THE DRAWER IS FOR. §5: "the drawer may expose
// secondary actions, but the queue row retains exactly one primary action." So
// the row outside still offers one button; everything else — acknowledge,
// resolve, dismiss, wait on somebody — lives in here, where there is room to
// ask for a reason.
//
// EVERY SECTION THAT HAS NOTHING SAYS WHY. The `MissingNote` below renders the
// reason the context supplied rather than an empty space, because §20 is
// explicit that a missing downstream feature must "show Not available or omit
// section. Never manufacture neutral state" — and an absent Recovery Trajectory
// that rendered as blank would read as a flat one.

function MissingNote({ section }: { section: SectionMissing }) {
  return (
    <p className="measure text-xs text-olive">
      <span aria-hidden>· </span>
      {section.note}
    </p>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-olive">{children}</h3>
  );
}

export function AttentionSignalDrawer({
  personId, personName, signalId, label = "Open review",
}: {
  personId: string;
  personName: string;
  /** Null for a person with no attention signal — the drawer still assembles
   *  the rest of the record, and Why-Here says where the row came from. */
  signalId: string | null;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<CommandContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState<"dismiss" | "wait" | null>(null);

  const openerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // The loading and error flags are reset by the opener below, not here. A
  // synchronous setState in an effect body triggers a cascading render, and
  // React's own lint rule is right about it: opening the drawer is an event,
  // and an event handler is where state that responds to an event belongs.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadCommandContext(personId, signalId)
      .then((c) => {
        if (cancelled) return;
        if (!c) setError("This could not be assembled just now. The row behind it is unchanged.");
        else setContext(c);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, personId, signalId]);

  // §19: "drawer focus is trapped while open and returns to originating row on
  // close." Both halves, because either one alone leaves a keyboard user
  // stranded — trapped focus with no return puts them at the top of the queue,
  // and a return with no trap lets Tab walk them behind the panel.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);

    focusable()[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, context]);

  useEffect(() => {
    if (!open) openerRef.current?.focus();
  }, [open]);

  async function acknowledge() {
    if (!signalId) return;
    setBusy(true);
    try {
      const r = await acknowledgeSignalAction(signalId, personId);
      if (!r.ok) setError(r.error ?? "That could not be saved.");
      else setContext((c) => (c && c.whyHere.present ? { ...c, whyHere: { ...c.whyHere, acknowledged: true } } : c));
    } finally {
      setBusy(false);
    }
  }

  async function submitState(form: FormData) {
    setBusy(true);
    setError(null);
    try {
      const r = await setSignalStateAction(form);
      if (!r.ok) { setError(r.error ?? "That could not be saved."); return; }
      setClosing(null);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        ref={openerRef}
        type="button"
        onClick={() => {
          setLoading(true);
          setError(null);
          setOpen(true);
        }}
        className="rounded-full border border-ground/20 px-3 py-1.5 text-xs text-app-ink"
      >
        {label}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Not a click-catcher alone: the button below is a real control with a
          real label, so a screen reader has something to say about it. */}
      <button
        type="button"
        aria-label="Close review"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-ground/30"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Review ${personName}`}
        className="relative h-full w-full max-w-xl overflow-y-auto bg-app-surface px-5 py-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="type-display text-xl font-medium text-ground">{personName}</h2>
            <p className="text-xs text-olive">
              Reviewing this does not change it. Anything you decide below is recorded as your
              decision.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-full border border-ground/20 px-3 py-1 text-xs text-app-ink"
          >
            Close
          </button>
        </div>

        {loading && <p className="mt-6 text-sm text-olive">Assembling the record…</p>}
        {error && <p className="mt-4 text-sm text-state-support" role="alert">{error}</p>}

        {context && (
          <div className="mt-6 space-y-6">
            <WhyHere context={context} />

            {/* §12: acknowledgement is explicit, and it is separate from
                resolving. A clinician who has read something and is not ready
                to close it needs a way to say so. */}
            {signalId && context.whyHere.present && (
              <div className="flex flex-wrap items-center gap-2">
                {context.whyHere.acknowledged ? (
                  <span className="text-xs text-state-safe">◆ You have reviewed this</span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={acknowledge}
                    className="rounded-full bg-app-ink px-3 py-1.5 text-xs font-medium text-linen disabled:opacity-50"
                  >
                    {busy ? "…" : "Mark as reviewed"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setClosing(closing === "wait" ? null : "wait")}
                  className="rounded-full border border-ground/20 px-3 py-1.5 text-xs text-app-ink"
                >
                  Waiting on someone
                </button>
                <button
                  type="button"
                  onClick={() => setClosing(closing === "dismiss" ? null : "dismiss")}
                  className="rounded-full border border-ground/20 px-3 py-1.5 text-xs text-app-ink"
                >
                  Resolve or dismiss
                </button>
              </div>
            )}

            {signalId && closing && (
              <ClosingForm
                kind={closing}
                signalId={signalId}
                personId={personId}
                busy={busy}
                onSubmit={submitState}
                onCancel={() => setClosing(null)}
              />
            )}

            <ReturnToLife context={context} />
            <ObservedResponses context={context} personId={personId} />
            <ActiveThreads context={context} />
            <RecoveryAndLoad context={context} />
            <FollowUps context={context} />
            <ActionHistory context={context} />

            <div className="border-t border-ground/10 pt-4">
              <SectionHeading>Next</SectionHeading>
              <p className="mt-2 text-sm">
                <Link href={context.sessionPrepHref} className="underline">
                  Open the full record and session prep
                </Link>
              </p>
              <p className="measure mt-3 text-xs text-olive">
                Assembled from evidence up to {context.evidenceCutoff.slice(0, 10)}, under policy{" "}
                {context.provenance.clinicalPolicyVersion} and {context.provenance.responsePolicyVersion}.
                {context.coverage.failed.length > 0 &&
                  ` ${context.coverage.failed.length} section${context.coverage.failed.length === 1 ? "" : "s"} could not be loaded — they are named above.`}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections (§5)
// ---------------------------------------------------------------------------

function WhyHere({ context }: { context: CommandContext }) {
  const s = context.whyHere;
  return (
    <section>
      <SectionHeading>Why they are here</SectionHeading>
      {!s.present ? (
        <div className="mt-2"><MissingNote section={s} /></div>
      ) : (
        <>
          <p className="measure mt-2 text-sm text-app-ink">{s.signal.statement}</p>
          <p className="mt-1 text-xs text-olive">
            {BAND_LABEL[s.signal.band]} · from {s.signal.sourceFeature.replace(/-/g, " ")} · first
            seen {s.signal.firstDetectedAt.slice(0, 10)}
          </p>
          {s.limitations.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {s.limitations.map((l, i) => (
                <li key={i} className="measure text-xs text-olive">{l}</li>
              ))}
            </ul>
          )}
          {/* "Every material statement can open its evidence." The ids are the
              record of what the sentence rests on; the count is shown even when
              there is nothing to link to, because zero is a fact about the
              signal a clinician should weigh. */}
          <p className="mt-2 text-xs text-olive">
            {s.evidence.length === 0
              ? "No evidence records are attached to this signal."
              : `${s.evidence.length} evidence record${s.evidence.length === 1 ? "" : "s"} behind it (${s.evidence[0].evidenceType.replace(/_/g, " ")}).`}
          </p>
        </>
      )}
    </section>
  );
}

function ReturnToLife({ context }: { context: CommandContext }) {
  const s = context.returnToLife;
  return (
    <section>
      <SectionHeading>Return to life</SectionHeading>
      {!s.present ? (
        <div className="mt-2"><MissingNote section={s} /></div>
      ) : (
        <ul className="mt-2 space-y-2">
          {s.goals.map((g) => (
            <li key={g.goalId}>
              <p className="text-sm text-app-ink">{g.title}</p>
              {/* Plain language, not a number from a scale nobody can see. */}
              <p className="measure text-xs text-olive">
                {g.currentLevelLabel}
                {g.currentDescription ? ` — ${g.currentDescription}` : ""}
              </p>
              <p className="text-xs text-olive">
                {g.latestEvidenceAt
                  ? `Last accepted evidence ${g.latestEvidenceAt.slice(0, 10)}`
                  : "No accepted evidence yet"}
                {g.pendingCount > 0 && ` · ${g.pendingCount} suggestion${g.pendingCount === 1 ? "" : "s"} waiting on you`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ObservedResponses({ context, personId }: { context: CommandContext; personId: string }) {
  const s = context.responseFingerprint;
  return (
    <section>
      {/* NOT "what works". §5 titles this section that way and then forbids the
          claim underneath it — "wording is observed association, never treatment
          truth" — so the heading uses the same language as the rows beneath it.
          A heading that says "what works" over rows saying "settling has been
          observed" teaches the reader to trust the heading. */}
      <SectionHeading>What has tended to settle them</SectionHeading>
      {!s.present ? (
        <div className="mt-2"><MissingNote section={s} /></div>
      ) : (
        <>
          <ul className="mt-2 space-y-1.5">
            {s.interventions.map((r) => (
              <li key={r.definitionId}>
                <p className="text-sm text-app-ink">
                  {r.displayName} <span className="text-xs text-olive">{r.classLabel}</span>
                </p>
                <p className="measure text-xs text-olive">
                  {r.stateLabel}, on {r.supportCount} recorded exposure{r.supportCount === 1 ? "" : "s"}
                  {r.missingFollowupCount > 0 &&
                    `; ${r.missingFollowupCount} had a window nobody recorded`}
                  .
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            <Link href={`/clinician/member/${personId}/responses`} className="underline">
              Open the response record
            </Link>
            {s.withheldCount > 0 && (
              <span className="text-olive">
                {" "}— {s.withheldCount} more with too few exposures to summarise
              </span>
            )}
          </p>
        </>
      )}
    </section>
  );
}

function ActiveThreads({ context }: { context: CommandContext }) {
  const s = context.activeThreads;
  return (
    <section>
      <SectionHeading>Active threads</SectionHeading>
      {!s.present ? (
        <div className="mt-2"><MissingNote section={s} /></div>
      ) : (
        <ul className="mt-2 space-y-1">
          {s.threads.map((t) => (
            <li key={t.threadId} className="measure text-sm text-app-ink">
              {t.label}{" "}
              {/* Accepted connections only. §5: "proposed AI links do not appear
                  as accepted", and the count says which kind it is counting. */}
              <span className="text-xs text-olive">
                {t.acceptedItemCount} thing{t.acceptedItemCount === 1 ? "" : "s"} you connected to it
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecoveryAndLoad({ context }: { context: CommandContext }) {
  return (
    <section>
      <SectionHeading>Recovery and load</SectionHeading>
      <div className="mt-2 space-y-1">
        <MissingNote section={context.recoveryTrajectory} />
        <MissingNote section={context.therapeuticLoad} />
      </div>
    </section>
  );
}

function FollowUps({ context }: { context: CommandContext }) {
  const s = context.followUps;
  return (
    <section>
      <SectionHeading>You wanted to revisit</SectionHeading>
      {!s.present ? (
        <div className="mt-2"><MissingNote section={s} /></div>
      ) : (
        <ul className="mt-2 space-y-1">
          {s.items.map((f) => (
            <li key={f.itemId} className="measure text-sm text-app-ink">
              {f.text}{" "}
              <span className="text-xs text-olive">— you kept this {f.approvedAt.slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActionHistory({ context }: { context: CommandContext }) {
  const s = context.actionHistory;
  return (
    <section>
      <SectionHeading>What has been done</SectionHeading>
      {!s.present ? (
        <div className="mt-2"><MissingNote section={s} /></div>
      ) : (
        <ul className="mt-2 space-y-1">
          {s.actions.map((a) => (
            <li key={a.id} className="text-xs text-olive">
              {a.completedAt.slice(0, 16)} — {a.action.replace(/_/g, " ")}
              {a.outcomeState ? ` (${a.outcomeState.replace(/_/g, " ")})` : ""}
              {/* §13 forbids counting passive time, so a duration appears only
                  when something explicitly bounded one. */}
              {a.durationSeconds !== null && ` · ${Math.round(a.durationSeconds / 60)} min recorded`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Closing a signal (§12)
// ---------------------------------------------------------------------------

function ClosingForm({
  kind, signalId, personId, busy, onSubmit, onCancel,
}: {
  kind: "dismiss" | "wait";
  signalId: string;
  personId: string;
  busy: boolean;
  onSubmit: (form: FormData) => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <form action={onSubmit} className="space-y-3 rounded-xl border border-ground/15 px-4 py-3">
      <input type="hidden" name="signalId" value={signalId} />
      <input type="hidden" name="personId" value={personId} />

      {kind === "wait" ? (
        <>
          <label className="block text-sm">
            <span className="mb-1 block text-olive">Waiting on</span>
            <select
              name="state"
              className="w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
            >
              <option value="waiting_member">Them</option>
              <option value="waiting_staff">Someone here, or another system</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-olive">What are you waiting for?</span>
            <input
              name="dependency"
              required
              maxLength={300}
              placeholder="Waiting for her to try the shop once before we review it"
              className="w-full rounded-xl border border-ground/20 bg-linen px-3 py-2 text-sm text-app-ink"
            />
            {/* §2's display rule, said to the person writing the row. */}
            <span className="mt-1 block text-xs text-olive">
              A row that cannot say what it is waiting for reads as though the person is at fault.
            </span>
          </label>
        </>
      ) : (
        <>
          <label className="block text-sm">
            <span className="mb-1 block text-olive">What is happening to this?</span>
            <select
              name="state"
              className="w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
            >
              <option value="resolved">Resolved — I have dealt with it</option>
              <option value="dismissed">Dismissed — it should not have been raised</option>
            </select>
          </label>
          <fieldset>
            <legend className="mb-1 text-sm text-olive">If dismissing, why?</legend>
            <div className="space-y-1">
              {DISMISS_REASONS.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm text-app-ink">
                  <input type="radio" name="dismissReason" value={r} />
                  {DISMISS_REASON_LABEL[r]}
                </label>
              ))}
            </div>
            <p className="measure mt-1 text-xs text-olive">
              A dismissal nobody explained is one the same rule will raise again next week.
            </p>
          </fieldset>
        </>
      )}

      <label className="block text-sm">
        <span className="mb-1 block text-olive">Anything to record (optional)</span>
        <textarea
          name="note"
          rows={2}
          maxLength={500}
          className="w-full rounded-xl border border-ground/20 bg-linen px-3 py-2 text-sm text-app-ink"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-linen disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-olive underline">
          Cancel
        </button>
      </div>
    </form>
  );
}
