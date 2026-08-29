// Shared clinical presentation primitives (GUI and Decision-Surface Handoff §11).
//
// §11 asks for these before page work, and the reason is visible in the console
// as it stands: priority, freshness, and ownership are each rendered three or
// four different ways across the alert list, the caseload, the person record,
// and the alert trail. A clinician learns each dialect separately, and a change
// to what "overdue" looks like has to be made in four places or it drifts.
//
// The rule that shapes all of them is §12.2's: "Color may reinforce meaning but
// cannot carry it alone." Every state below renders a glyph and a word as well
// as a tint, so it survives a colour-vision difference, a monochrome print, and
// the grey rendering of a screenshot pasted into a ticket.

import Link from "next/link";
import type { PriorityBand } from "@/lib/clinical/caseload";

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

const BAND_STYLE: Record<PriorityBand, { label: string; glyph: string; cls: string }> = {
  // The glyph is the redundant channel, not decoration. Chosen to differ in
  // SHAPE rather than only in weight, so they separate at small sizes.
  immediate: { label: "Immediate", glyph: "▲", cls: "bg-state-support-bg text-state-support" },
  high:      { label: "High",      glyph: "◆", cls: "bg-state-caution-bg text-state-caution" },
  standard:  { label: "Today",     glyph: "●", cls: "bg-state-info-bg text-state-info" },
  watch:     { label: "Watch",     glyph: "○", cls: "bg-state-unknown-bg text-state-unknown" },
  none:      { label: "Clear",     glyph: "—", cls: "bg-state-safe-bg text-state-safe" },
};

export function PriorityBadge({ band }: { band: PriorityBand }) {
  const s = BAND_STYLE[band];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}
    >
      <span aria-hidden>{s.glyph}</span>
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Freshness (§11 FreshnessLabel, §8.1)
// ---------------------------------------------------------------------------

/** Relative age in words.
 *
 *  Takes `now` as a parameter rather than reading the clock, because §8.1 says
 *  the client must not "fabricate freshness" — the server passes the time the
 *  projection ran, and this renders against that. A component that called
 *  Date.now() here would drift from the data the moment the page sat open.
 */
export function relativeAge(iso: string, now: string): string {
  const t = Date.parse(iso.replace(" ", "T") + (iso.includes("T") || iso.endsWith("Z") ? "" : "Z"));
  const n = Date.parse(now.replace(" ", "T") + (now.includes("T") || now.endsWith("Z") ? "" : "Z"));
  if (!Number.isFinite(t) || !Number.isFinite(n)) return "time unknown";
  const mins = Math.max(0, Math.round((n - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  return `${days} d`;
}

export function FreshnessLabel({
  evidenceAt, now, prefix = "Evidence",
}: { evidenceAt: string | null; now: string; prefix?: string }) {
  // §14: absent data is a state with its own words, not a blank or a zero.
  if (!evidenceAt) {
    return <span className="text-xs text-state-unknown">{prefix}: none recorded</span>;
  }
  return (
    <span className="text-xs text-olive">
      {prefix} {relativeAge(evidenceAt, now)} ago
    </span>
  );
}

// ---------------------------------------------------------------------------
// Ownership (§11 OwnerChip, §23.2)
// ---------------------------------------------------------------------------

/** §23.2: "Do not show an alert without a clear owner and possible action."
 *  Unowned is shown as a state, not as an empty cell — an empty cell reads as a
 *  rendering bug and gets ignored, where "Unassigned" reads as work. */
export function OwnerChip({ name }: { name: string | null }) {
  if (!name) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-state-caution">
        <span aria-hidden>○</span> Unassigned
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-olive">
      <span aria-hidden>◇</span> {name}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Due state
// ---------------------------------------------------------------------------

export function DueLabel({
  dueAt, overdue, now,
}: { dueAt: string | null; overdue: boolean; now: string }) {
  if (!dueAt) return <span className="text-xs text-olive">No deadline</span>;
  if (overdue) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-state-support">
        <span aria-hidden>▲</span> Overdue by {relativeAge(dueAt, now)}
      </span>
    );
  }
  return <span className="text-xs text-olive">Due in {relativeAge(now, dueAt)}</span>;
}

// ---------------------------------------------------------------------------
// Review state (§11 ReviewBadge, §9.3)
// ---------------------------------------------------------------------------

/** §9.3's four labels for model-produced content.
 *
 *  "Do not use a sparkle icon as the only sign that text came from a model. Do
 *  not style model output like a system fact." So each state spells itself out,
 *  and the unapproved states are visually cooler than the approved one rather
 *  than more decorative. */
const REVIEW_STYLE = {
  draft:     { label: "AI draft",     cls: "bg-state-review-bg text-state-review" },
  validated: { label: "Evidence checked", cls: "bg-state-info-bg text-state-info" },
  approved:  { label: "Reviewed",     cls: "bg-state-safe-bg text-state-safe" },
  corrected: { label: "Corrected",    cls: "bg-state-caution-bg text-state-caution" },
} as const;

export function ReviewBadge({
  state, by,
}: { state: keyof typeof REVIEW_STYLE; by?: string | null }) {
  const s = REVIEW_STYLE[state];
  // §9.3 attributes the two human states to a person. "Reviewed" with no name
  // is the same non-claim as "notified" with no receipt.
  const suffix = (state === "approved" || state === "corrected") && by ? ` by ${by}` : "";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>
      {s.label}{suffix}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Empty and failed states (§14)
// ---------------------------------------------------------------------------

/** §14: "Health software cannot treat 'no data' as one condition." An empty
 *  queue because the day is clear and an empty queue because a projection
 *  failed must not look the same — the first is good news and the second is a
 *  clinician working blind while believing they are up to date. */
export function EmptyState({
  kind, title, detail, action,
}: {
  kind: "clear" | "not_due" | "missing" | "failed" | "unauthorized";
  title: string;
  detail: string;
  action?: { href: string; label: string };
}) {
  const tone =
    kind === "clear" ? "border-state-safe/40 bg-state-safe-bg/50"
    : kind === "failed" ? "border-state-support/40 bg-state-support-bg/50"
    : "border-ground/10 bg-linen";
  return (
    <div className={`rounded-3xl border p-6 ${tone}`}>
      <p className="font-semibold text-ground">{title}</p>
      <p className="mt-1 text-sm text-olive">{detail}</p>
      {action && (
        <Link href={action.href} className="mt-3 inline-block text-sm font-medium text-state-info underline">
          {action.label}
        </Link>
      )}
    </div>
  );
}
