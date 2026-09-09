// The clinician home projection (handoff 09 §5, Package 2).
//
// §5 states the operating question this screen answers: "who needs me today,
// why, what changed, and what should I do next?"
//
// COMPOSITION, NOT A SECOND QUEUE. §9: "Retain the experience layer as
// composition around existing readers and commands." So this takes an
// `Envelope<WorkQueue>` that the domain already built and reshapes it — it does
// not query, does not sort, and does not re-band. Package 2's exit evidence
// includes "authorization and queue authority unchanged", and the only way to
// keep that literally true is for the ordering to arrive already decided.
//
// THE ROW SHAPE IS THE POINT OF THE PACKAGE. §5's complaint about the current
// row is specific: "A row should not require the clinician to parse eight
// badges before understanding the concern. Move secondary facts into a readable
// detail panel." The existing row carries a band badge, a safety chip, an event
// count, the reason, three support facts, a mono detail line, a change line, a
// freshness label, an owner chip, a last-contact line and a due label — eleven
// things, and §5 is right that it is too many.
//
// So `QueueRowView` below has FIVE fields, which are §5's own list: "Identity,
// reason, ownership, due state, one next action." Everything else moves to
// `secondary`, which the evidence panel renders and the row does not.
//
// TWO THINGS DO NOT MOVE, and both are safety properties rather than facts.
// The safety label stays on the row because §2 of handoff 03 requires that
// "safety remains visibly labeled as safety; non-safety review_now cannot
// masquerade as safety" — a clinician scanning must be able to tell them apart
// without opening anything. And the blocked reason stays, because a row whose
// action is unavailable has to explain itself where the action would have been.

import type { Envelope } from "../presentation/envelope";
import type { WorkItem, WorkQueue, UiGroup } from "../clinical/work-queue";
import { uiGroupFor, UI_GROUP_LABEL } from "../clinical/work-queue";
import type { PriorityBand } from "../clinical/caseload";
import type { ExperienceContext } from "./context";
import { navigationFor } from "./navigation";
import {
  assertRoleHome, fullCoverage, partialCoverage,
  type RoleHome, type Coverage,
} from "./role-home";
import type { ViewState } from "./view-state";
import { ACTION_LABEL, type ClinicianAction } from "./clinician-vocabulary";

/**
 * One row, as §5 asks for it.
 *
 * FIVE FIELDS ON THE ROW. Adding a sixth is a decision somebody has to make
 * here, in a type, rather than by appending a span to a component — which is
 * how the current row reached eleven.
 */
export interface QueueRowView {
  /** Stable across rebuilds, so a row does not move under the pointer. */
  id: string;
  personId: string;
  /** §5: "Identity". */
  personName: string;
  /** §5: "Where names match, use a permitted secondary identifier rather than
   *  initials alone." Null when the name is unambiguous on this caseload. */
  disambiguator: string | null;
  /** §5: "reason". One line, in words. */
  reason: string;
  /** §5: "ownership". Null is its own state and renders as unassigned. */
  ownerName: string | null;
  /** §5: "due state". Already computed by the domain. */
  dueAt: string | null;
  overdue: boolean;
  /** §5: "one next action". */
  action: ClinicianAction | null;
  /** Why there is no action, when there is none. A row with neither is a row
   *  that cannot explain itself. */
  blockedReason: string | null;
  /** Stays on the row. See the header: this is a safety property, not a fact. */
  safetyAuthority: boolean;
  band: PriorityBand;
  /** Everything §5 moves off the row. The panel renders these. */
  secondary: SecondaryFact[];
  /** The signal behind the row, for the panel. */
  signalId: string | null;
  group: UiGroup | null;
}

export interface SecondaryFact {
  label: string;
  value: string;
}

// §5's four separated actions live in clinician-vocabulary.ts, which imports
// nothing — a client component needs the labels, and this module reaches the
// work queue. Re-exported here so a server-side caller has one import.
export {
  CLINICIAN_ACTIONS, ACTION_LABEL, ACTION_NOTE, type ClinicianAction,
} from "./clinician-vocabulary";

/** Which action a row offers, from the domain's own decision.
 *
 *  The domain says `review`, `contact`, `open` or `none`; this maps those onto
 *  §5's separated vocabulary. `review` becomes `complete_review` rather than
 *  `open`, which is the substantive change: the row's primary action is now the
 *  thing the queue is asking for rather than a navigation. */
function actionFor(item: WorkItem): ClinicianAction | null {
  if (!item.actionable || item.action === "none") return null;
  switch (item.action) {
    case "review": return "complete_review";
    case "contact": return "record_contact";
    case "open": return "open";
  }
}

/**
 * The facts §5 moves off the row.
 *
 * Each is a label and a value, so the panel can render them as a definition
 * list rather than as prose somebody has to parse. Absences are included with
 * their own wording — a fact that is missing and a fact that is absent read
 * differently, and dropping the row entirely would make them identical.
 */
/** A timestamp a clinician can read.
 *
 *  The first version passed `item.evidenceAt` and the render clock straight
 *  through, and the panel showed "2026-09-09T04:48:59.577Z" — a value nobody
 *  reads and which puts sub-second precision on a clinical fact that is
 *  accurate to the day. Stored stamps arrive in two shapes (ISO and SQLite's
 *  space-separated form), so both are normalised here rather than at each call
 *  site. */
function stamp(at: string): string {
  return at.replace("T", " ").slice(0, 16);
}

function secondaryFor(item: WorkItem, now: string): SecondaryFact[] {
  const out: SecondaryFact[] = [];
  out.push({
    label: "Change since last review",
    // §14: missing is not the same as nothing changed.
    value: item.change ?? "First time in this queue",
  });
  out.push({ label: "Newest evidence", value: stamp(item.evidenceAt) });
  out.push({
    label: "Last clinician contact",
    value:
      item.lastContactDays === null
        ? "None recorded"
        : item.lastContactDays === 0
          ? "Today"
          : `${item.lastContactDays} days ago`,
  });
  if (item.eventCount > 1) {
    // §10.3's duplicate collapse. The count keeps the collapse honest: three
    // alerts becoming one row without saying so hides volume.
    out.push({ label: "Events collapsed into this row", value: String(item.eventCount) });
  }
  for (const [i, fact] of item.supportFacts.slice(0, 3).entries()) {
    out.push({ label: i === 0 ? "Supporting" : "", value: fact });
  }
  if (item.detail) out.push({ label: "Underlying event", value: item.detail });
  if (item.resolvedAt) out.push({ label: "Resolved", value: stamp(item.resolvedAt) });
  out.push({ label: "As of", value: stamp(now) });
  return out;
}

/**
 * §5's "where names match, use a permitted secondary identifier rather than
 * initials alone."
 *
 * INITIALS ARE THE FAILURE THIS AVOIDS. Two people called Aiko on one caseload
 * rendered as "Aiko N." and "Aiko I." is a distinction a tired clinician reads
 * wrong, and the consequence is a note on the wrong record. The disambiguator
 * is only added where a name actually repeats — adding it everywhere would put
 * an identifier on every row for no reason, which §18 discourages.
 */
function disambiguators(items: WorkItem[]): Map<string, string> {
  const byName = new Map<string, string[]>();
  for (const i of items) {
    const list = byName.get(i.personName) ?? [];
    if (!list.includes(i.personId)) list.push(i.personId);
    byName.set(i.personName, list);
  }
  const out = new Map<string, string>();
  for (const [, ids] of byName) {
    if (ids.length < 2) continue;
    // The last six of the person id: already on screen elsewhere in the
    // console, stable, and not a name somebody could mistake for another
    // person's.
    for (const id of ids) out.set(id, `id ending ${id.slice(-6)}`);
  }
  return out;
}

export interface ClinicianHome extends RoleHome<QueueRowView> {
  /** §3's counts, unchanged — the header strip reads them. */
  counts: Record<UiGroup, number>;
  stableCount: number;
  stablePersonIds: string[];
  /** Which bucket is showing, from the view state rather than from a parameter
   *  this layer parsed. */
  showing: UiGroup | null;
  /** The presentation state, carried through so a failed projection stays a
   *  failed projection rather than becoming an empty home. */
  envelopeState: Envelope<WorkQueue>["state"];
  reason?: string;
  correlationId?: string;
}

/**
 * Reshape the queue into a home.
 *
 * NO SORTING, NO FILTERING BY PRIORITY. The items arrive in the domain's order
 * and stay in it. The one narrowing this does is by BUCKET, which is what the
 * clinician asked for by pressing a count — and §6's rule holds: "user filters
 * do not rewrite server clinical priority semantics."
 */
export function clinicianHome(args: {
  ctx: ExperienceContext;
  envelope: Envelope<WorkQueue>;
  view: ViewState;
  showing: UiGroup | null;
  now: string;
  /** How many rows a bucket shows before it asks to be opened. Paging, never
   *  hiding: the counts above are never capped. */
  rowsPerBucket: number;
}): ClinicianHome {
  const { ctx, envelope, showing, now } = args;
  const queue = envelope.data;

  const navigation = navigationFor(ctx);
  const emptyCounts: Record<UiGroup, number> = { needs_attention: 0, review_today: 0, waiting: 0 };

  if (!queue) {
    // A failed or empty projection is not a clear day. The state travels so the
    // surface can say which — §30.8's whole reason for existing.
    return assertRoleHome({
      audience: ctx.audience,
      asking: {
        question: "Your attention queue",
        orienting:
          envelope.state === "empty"
            ? "Nothing needs action under the current policy."
            : "Steady could not load your queue.",
      },
      primary: null,
      primaryAbsentNote:
        envelope.state === "empty"
          ? "Nothing needs action under the current policy. That is a statement about policy and today, not about how anybody is doing."
          : envelope.reason ?? "The queue could not be loaded, so there is nothing to act on here yet.",
      items: [],
      totalItems: 0,
      coverage: fullCoverage([]),
      navigation,
      generatedAt: now,
      counts: emptyCounts,
      stableCount: 0,
      stablePersonIds: [],
      showing,
      envelopeState: envelope.state,
      reason: envelope.reason,
      correlationId: envelope.correlationId,
    });
  }

  const inShowing = showing
    ? queue.items.filter((i) => uiGroupFor(i.group) === showing)
    : queue.items.filter((i) => uiGroupFor(i.group) !== null);
  const ambiguous = disambiguators(queue.items);

  const rows = inShowing.slice(0, args.rowsPerBucket).map((item): QueueRowView => ({
    id: item.id,
    personId: item.personId,
    personName: item.personName,
    disambiguator: ambiguous.get(item.personId) ?? null,
    reason: item.reason,
    ownerName: item.ownerName,
    dueAt: item.dueAt,
    overdue: item.overdue,
    action: actionFor(item),
    blockedReason: item.actionable ? null : item.blockedReason,
    safetyAuthority: item.safetyAuthority,
    band: item.band,
    secondary: secondaryFor(item, now),
    signalId: item.signalId,
    group: uiGroupFor(item.group),
  }));

  const coverage: Coverage =
    queue.coverage.providersFailed.length === 0 && !queue.coverage.truncated
      ? fullCoverage(queue.coverage.providersRan)
      : partialCoverage(
          queue.coverage.providersRan,
          queue.coverage.providersFailed.map((f) => ({
            source: f.providerId,
            reason: f.reason,
            // The queue does not carry a last-good reading per provider, and
            // inventing one would be worse than saying it is unknown. §5 asks
            // for it; this is the honest state until the providers record it.
            lastGoodAt: null,
          }))
        );

  const total = inShowing.length;
  const first = rows[0] ?? null;

  return assertRoleHome({
    audience: ctx.audience,
    asking: {
      question: "Your attention queue",
      orienting: showing
        ? `${UI_GROUP_LABEL[showing]} — ${total} item${total === 1 ? "" : "s"}.`
        : `${total} item${total === 1 ? "" : "s"} need review.`,
    },
    // §8.2: "one strongest action." The first row's, because the queue is
    // already in the order the domain decided — so the strongest action is the
    // top of the list rather than a choice this layer made.
    primary: first?.action
      ? {
          label: `${ACTION_LABEL[first.action]}: ${first.personName}`,
          href: `/clinician/member/${first.personId}`,
          description: first.reason,
        }
      : null,
    primaryAbsentNote: first?.action
      ? undefined
      : total === 0
        ? "Nothing in this bucket. That is a statement about policy and today, not about how anybody is doing."
        : first?.blockedReason ??
          "The first item is not yours to act on, so there is no single strongest action here.",
    items: rows,
    // NEVER CAPPED. The rows are paged; the total is the whole bucket, so a
    // filter cannot make an obligation disappear (§5).
    totalItems: total,
    coverage,
    navigation,
    generatedAt: queue.computedAt,
    counts: queue.uiCounts,
    stableCount: queue.stableCount,
    stablePersonIds: queue.stablePersonIds,
    showing,
    envelopeState: envelope.state,
    reason: envelope.reason,
    correlationId: envelope.correlationId,
  });
}
