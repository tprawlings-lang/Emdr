// The clinician work queue (GUI and Decision-Surface Handoff §10.3, §8.3).
//
// The console previously opened on two stacked lists: an alert section and a
// caseload section, each ordered by its own rules. A clinician arriving at the
// start of a shift had to read both and reconcile them by hand, because the
// same person appears in both for the same underlying reason — an alert fires,
// and the person's caseload band rises because that alert exists.
//
// §4.2's lesson from Blueprint is that "a clinician home should open on work,
// not charts", and §6 names the clinician's first question: "Who needs my
// attention and why?" A queue answers it; two lists make the clinician answer
// it themselves.
//
// So this module is the `clinical_work_item_projection` of §8.3: one ordered
// list of owned, dated, actionable items, assembled on the server. The
// component renders it and may not reorder it (§20.1: "No client component
// recalculates safety or priority").
//
// On duplicate collapse. §10.3: "Duplicate alerts for the same person and
// reason should collapse into one work item with an event count." AHRQ's alert
// fatigue primer is cited in the handoff for the reason — desensitisation from
// volume, most of it not requiring action. Three "distress unresolved" alerts
// for one person on one day is one piece of work, and showing it three times
// makes the queue look busier while making it less informative.

import { alertQueue, type ClinicalAlert } from "./alerts";
import { buildCaseload, type CaseloadRow, type PriorityBand } from "./caseload";
import { activePolicy, type ClinicalPolicy } from "../clinical-policy";
import { thoughtsFlagEnabled } from "./thoughts-flags";
import { data } from "../data";
import {
  ready, empty, projectionFailed, policyUnavailable,
  type Envelope, type ProjectionMeta,
} from "../presentation/envelope";
import { commandCenterFlagEnabled } from "./command-center-flags";
import type { AttentionBand } from "./attention-signals";

/** §10.3's five groups, in the order they appear. Ordered by claim on the
 *  clinician's attention, not by volume. */
export type WorkGroup =
  | "needs_action"
  | "review_today"
  | "waiting_member"
  | "waiting_staff"
  | "recently_resolved";

export const GROUP_LABEL: Record<WorkGroup, string> = {
  needs_action: "Needs action now",
  review_today: "Review today",
  waiting_member: "Waiting on member",
  waiting_staff: "Waiting on staff or integration",
  recently_resolved: "Recently resolved",
};

/** §2 of expansion handoff 03: the four buckets a clinician reads.
 *
 *  The five machine groups above stay exactly as they are — "the underlying
 *  work queue may retain more granular machine groups. The UI maps those groups
 *  into four clinician-readable buckets." Waiting-on-member and
 *  waiting-on-staff are one bucket to a clinician scanning their day and two
 *  different dependencies to the code that has to name them, and collapsing the
 *  machine groups to match the UI would lose the second.
 *
 *  Recently-resolved has NO bucket. §2: "recently resolved work belongs in
 *  Recent Activity and patient history, not as a permanent front-page section."
 *  Its absence here is the mapping. */
export type UiGroup = "needs_attention" | "review_today" | "waiting";

export const UI_GROUP_LABEL: Record<UiGroup, string> = {
  needs_attention: "Needs attention",
  review_today: "Review today",
  waiting: "Waiting",
};

const UI_GROUP_FOR: Record<WorkGroup, UiGroup | null> = {
  needs_action: "needs_attention",
  review_today: "review_today",
  waiting_member: "waiting",
  waiting_staff: "waiting",
  recently_resolved: null,
};

export function uiGroupFor(g: WorkGroup): UiGroup | null {
  return UI_GROUP_FOR[g];
}

/** What a row may offer. Exactly one per row (§10.3: "One row action") — a row
 *  with three buttons is a row that has not decided what it is asking for. */
export type WorkAction = "review" | "contact" | "open" | "none";

export interface WorkItem {
  /** Stable across rebuilds for the same evidence, so a row does not jump
   *  under the cursor between refreshes. */
  id: string;
  group: WorkGroup;
  band: PriorityBand;
  personId: string;
  personName: string;
  /** Why this row exists, in words. Never a bare score, never an unexplained
   *  rank, and never a raw event key. */
  reason: string;
  /** The underlying event text, shown beneath the reason for the clinician who
   *  is acting rather than triaging. Null for caseload-derived rows. */
  detail: string | null;
  /** When this was resolved, for the recently-resolved group. A resolved item
   *  has no live deadline, and rendering one produced "Due in just now". */
  resolvedAt: string | null;
  /** Change since the last review, or null when there is no prior review to
   *  compare against. Null renders as "first time here" rather than as an
   *  invented comparison — §14 forbids treating missing as zero. */
  change: string | null;
  /** When the newest evidence behind this item arrived. */
  evidenceAt: string;
  ownerId: string | null;
  ownerName: string | null;
  dueAt: string | null;
  overdue: boolean;
  /** How many underlying events collapsed into this row. 1 when it is one. */
  eventCount: number;
  action: WorkAction;
  /** Whether THIS clinician may take the action, under the caseload model. */
  actionable: boolean;
  /** Present when the action is blocked, so the row explains itself rather
   *  than showing a control that does nothing. */
  blockedReason: string | null;
  /** §2 of expansion handoff 03: "safety remains visibly labeled as safety.
   *  Non-safety review_now cannot masquerade as safety."
   *
   *  This is a FIELD and not a guess from the band, because the two are exactly
   *  the thing that must not be confused: an attention signal can reach the
   *  same bucket as a safety obligation, and only one of them carries safety
   *  authority. A renderer that inferred it from the band would eventually
   *  label a response-pattern row as safety. */
  safetyAuthority: boolean;
  /** The attention signal this row came from, when it came from one. Null for
   *  alert-derived and caseload-derived rows. */
  signalId: string | null;
  /** Up to three short supporting facts (§4). Empty for rows that have none —
   *  never padded, because a fact invented to fill a slot is the failure §4's
   *  "never an unexplained score" is guarding against, one level down. */
  supportFacts: string[];
  /** §4: "last meaningful clinician contact". Null when there has been none,
   *  which renders as its own state — a person nobody has contacted yet and a
   *  person contacted today must not look the same. */
  lastContactDays: number | null;
}

export interface WorkQueue {
  items: WorkItem[];
  /** Counts by group, so the shape of the day is legible before the list. */
  groupCounts: Record<WorkGroup, number>;
  /** §3's header strip: the four clinician-readable counts. */
  uiCounts: Record<UiGroup, number>;
  /**
   * People on this clinician's authorized caseload with no open work under the
   * current policy (§9's "Stable is not stored as a signal").
   *
   * A DERIVED NUMBER, computed by subtraction, and it is not a quality score.
   * §23: "Stable means no current suggested action under policy, not healthy or
   * low risk." Storing it would put a row in the signal table for every quiet
   * person, so the table would grow with the caseload rather than with the
   * work — and the number would then be a thing that could go stale.
   */
  stableCount: number;
  /** Which people the stable count is made of, so clicking it can open a
   *  filtered caseload rather than a number with nothing behind it. */
  stablePersonIds: string[];
  /** §20: "one provider failed → keep other work. Surface partial coverage."
   *  Empty when every provider ran. */
  coverage: { providersRan: string[]; providersFailed: Array<{ providerId: string; reason: string }>; truncated: boolean };
  policyVersion: string;
  /** When this projection ran. §8.3 requires computed_at on every projection;
   *  the client must not derive freshness from its own clock (§8.1). */
  computedAt: string;
  /** The newest evidence anywhere in the queue. */
  newestEvidenceAt: string | null;
}

/** A human reason for each alert type (§10.3: "Reason for appearing").
 *
 *  Without this the row rendered the raw event string — "phq-9:
 *  suicidal_ideation_screen_positive (total 16)" — which is a machine key, a
 *  scoring internal, and a sentence fragment, in a field whose whole job is to
 *  tell a clinician at a glance why they are looking at this person. The raw
 *  detail is still carried and still shown, one line below, because a clinician
 *  acting on the row needs the specifics; it just is not the headline.
 *
 *  A missing mapping falls back to the type, so a new alert type degrades to
 *  something readable rather than to an empty cell. */
const REASON_FOR_TYPE: Record<string, string> = {
  checkin_safety_positive: "Safety item positive on today's check-in",
  companion_risk_language: "Risk language detected in companion conversation",
  fitness_screening_stop: "Program-fit screening returned a stop",
  onboarding_risk_disclosure: "Risk disclosed during onboarding",
  post_session_review: "Post-session review requested",
  post_session_unsafe: "Member reported feeling unsafe after a session",
  screening_risk_item: "Risk item flagged on a screening instrument",
  session_hard_stop: "Session hard-stopped on a safety threshold",
  symptom_worsening: "Symptoms worsening across recent measures",
  unlock_requested: "Member requested a gated module unlock",
};

function reasonFor(type: string): string {
  return REASON_FOR_TYPE[type] ?? type.replace(/_/g, " ");
}

const BAND_ORDER: PriorityBand[] = ["immediate", "high", "standard", "watch", "none"];

/** Bands whose deadline is inside a working day. Used to split "needs action
 *  now" from "review today" — the split is by response expectation, not by
 *  severity label, because that is what a clinician is triaging against. */
const IMMEDIATE_BANDS: PriorityBand[] = ["immediate", "high"];

function stamp(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function parseStamp(s: string): number {
  const t = Date.parse(s.replace(" ", "T") + (s.includes("T") || s.endsWith("Z") ? "" : "Z"));
  return Number.isFinite(t) ? t : 0;
}

/** Collapse alerts that are the same work.
 *
 *  Same person AND same alert type. Deliberately not "same detail" — the detail
 *  string carries a timestamp or a value and so is almost never equal, which
 *  would collapse nothing while looking like it collapsed something.
 *
 *  The surviving row keeps the WORST band, the EARLIEST due time, and the
 *  NEWEST evidence: the most urgent obligation and the most current fact. A
 *  collapse that kept the newest alert's band could lower the priority of a
 *  group containing an immediate one. */
function collapse(alerts: ClinicalAlert[]): Map<string, { alerts: ClinicalAlert[]; head: ClinicalAlert }> {
  const groups = new Map<string, { alerts: ClinicalAlert[]; head: ClinicalAlert }>();
  for (const a of alerts) {
    const key = `${a.personId}::${a.type}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { alerts: [a], head: a });
      continue;
    }
    g.alerts.push(a);
    const worseBand = BAND_ORDER.indexOf(a.band) < BAND_ORDER.indexOf(g.head.band);
    const earlierDue =
      a.dueAt !== null &&
      (g.head.dueAt === null || parseStamp(a.dueAt) < parseStamp(g.head.dueAt));
    if (worseBand || earlierDue) {
      g.head = {
        ...g.head,
        band: worseBand ? a.band : g.head.band,
        dueAt: earlierDue ? a.dueAt : g.head.dueAt,
        overdue: g.head.overdue || a.overdue,
      };
    } else if (a.overdue) {
      g.head = { ...g.head, overdue: true };
    }
    // Newest evidence wins for the displayed time.
    if (parseStamp(a.createdAt) > parseStamp(g.head.createdAt)) {
      g.head = { ...g.head, createdAt: a.createdAt };
    }
  }
  return groups;
}

/** Which group an alert-derived item belongs in. */
function groupForAlert(a: ClinicalAlert): WorkGroup {
  if (a.status === "reviewed") return "recently_resolved";
  if (a.overdue || IMMEDIATE_BANDS.includes(a.band)) return "needs_action";
  if (a.band === "standard") return "review_today";
  return "waiting_staff";
}

/** Which group a caseload row belongs in when it has no alert of its own.
 *
 *  A person who is quiet but overdue for contact is waiting on the member;
 *  a person the engine has flagged is work for staff. Neither is "needs action
 *  now" — that group is reserved for a deadline, so it stays believable. */
function groupForCaseload(r: CaseloadRow): WorkGroup {
  if (IMMEDIATE_BANDS.includes(r.band)) return "needs_action";
  if (r.band === "standard") return "review_today";
  return "waiting_member";
}

// ---------------------------------------------------------------------------
// Attention signals → work items (expansion handoff 03 §2, §11)
// ---------------------------------------------------------------------------

/** How many caseload members are re-evaluated on one queue build.
 *
 *  A cap, and it is honest about being one: a large caseload cannot have every
 *  provider run against every member on every page load, and pretending
 *  otherwise would make the clinician's home page the slowest screen in the
 *  product. Members are refreshed in caseload-band order, so the people the
 *  model is already most concerned about are the ones whose signals are
 *  freshest, and `truncated` says when the cap bit.
 *
 *  Signals ALREADY STORED are read for everyone regardless — the cap limits
 *  re-evaluation, never what the queue can show. A person beyond the cap whose
 *  signal was raised yesterday still appears today. */
const SIGNAL_REFRESH_LIMIT = 40;

/** Which UI-facing machine group a band claims.
 *
 *  `review_now` maps to needs-action, WHICH IS THE SAME BUCKET AS A SAFETY
 *  OBLIGATION, and that is deliberate and safe only because `safetyAuthority`
 *  travels on the row. §2: "safety remains visibly labeled as safety; non-safety
 *  review_now cannot masquerade as safety." Two rows, same bucket, different
 *  label — which is what a clinician triaging actually needs, rather than a
 *  review-worthy concern hidden a section lower because it is not safety. */
const GROUP_FOR_BAND: Record<AttentionBand, WorkGroup> = {
  review_now: "needs_action",
  review_today: "review_today",
  follow_up: "review_today",
  watch: "waiting_staff",
};

/** The queue band a signal claims. Never "immediate": that band is the safety
 *  engine's, and an attention signal that could reach it would be an attention
 *  signal that could outrank a safety obligation. */
const BAND_FOR_ATTENTION: Record<AttentionBand, PriorityBand> = {
  review_now: "high",
  review_today: "standard",
  follow_up: "watch",
  watch: "watch",
};

/**
 * One person, one concern, one row (§11).
 *
 * THE DUPLICATE THIS EXISTS TO KILL is a real one and it looked like this on
 * the first render: "Omar Bergström — No check-in for 22 days" from the caseload
 * model, and directly beneath it "Omar Bergström — No check-in for 22 days.
 * Their last one was 2026-08-13" from the engagement-gap provider. Same person,
 * same fact, two rows, two Contact buttons. §11: "duplicate same-person
 * same-reason signals collapse and preserve evidence/event count."
 *
 * THE SIGNAL WINS, and not arbitrarily: a caseload row is a band and a
 * sentence, while a signal has a lineage, evidence a clinician can open, a
 * policy version, limitations and a lifecycle they can act on. Dropping the
 * richer row to keep the plainer one would be collapsing in the wrong
 * direction.
 *
 * NOTHING THE CASELOAD SAID IS LOST. Its reasons fold into the surviving row's
 * supporting facts, which is what §4's "maximum three short facts" is for — so
 * a clinician sees the caseload's own read of the person on the same row,
 * rather than on a second one.
 *
 * A person with a signal in one bucket and a caseload concern in another keeps
 * both rows. Those are two different pieces of work, and merging them would be
 * the opposite mistake.
 *
 * Exported so it can be tested directly. A test that had to construct a fixture
 * person with both a caseload band and a live provider signal would be testing
 * the seed as much as the rule, and would pass when the seed changed shape.
 */
export function collapseWithCaseloadRows(existing: WorkItem[], signalRows: WorkItem[]): WorkItem[] {
  const byPersonGroup = new Map<string, WorkItem>();
  for (const item of existing) {
    if (!item.id.startsWith("person:")) continue;
    byPersonGroup.set(`${item.personId}::${uiGroupFor(item.group) ?? item.group}`, item);
  }

  const survivors: WorkItem[] = [];
  const absorbed = new Set<string>();
  for (const row of signalRows) {
    const key = `${row.personId}::${uiGroupFor(row.group) ?? row.group}`;
    const caseloadRow = byPersonGroup.get(key);
    if (!caseloadRow) {
      survivors.push(row);
      continue;
    }
    absorbed.add(caseloadRow.id);
    survivors.push({
      ...row,
      supportFacts: [
        // The caseload's headline reason first: it is the thing the clinician
        // would otherwise have read on the row that just disappeared.
        caseloadRow.reason,
        ...row.supportFacts,
      ].slice(0, 3),
      eventCount: row.eventCount + caseloadRow.eventCount,
      // The worse of the two deadlines, so a collapse can never soften one.
      overdue: row.overdue || caseloadRow.overdue,
    });
  }

  // Remove the absorbed caseload rows in place. `existing` is the array the
  // caller is about to push onto, so this has to mutate rather than return a
  // filtered copy.
  for (let i = existing.length - 1; i >= 0; i--) {
    if (absorbed.has(existing[i].id)) existing.splice(i, 1);
  }
  return survivors;
}

async function mergeAttentionSignals(args: {
  tenantId: string;
  clinicianId: string;
  caseload: CaseloadRow[];
  ownerNames: Map<string, string>;
  changeFor: (personId: string, evidenceAt: string) => string | null;
  now: Date;
}): Promise<{
  items: WorkItem[];
  coverage: { ran: string[]; failed: Array<{ providerId: string; reason: string }> };
  truncated: boolean;
}> {
  const { listOpenSignals, upsertSignal, withdrawStaleSignals } = await import("./attention-signals");
  const { evaluateAll } = await import("./attention-providers/registry");
  // Importing the module is what registers the providers. Done here rather than
  // at the top of the file so a deployment with the flag off never loads them.
  await import("./attention-providers/providers");

  const ctx = { tenantId: args.tenantId, personId: args.clinicianId };
  const evidenceCutoff = args.now.toISOString();

  const refreshOrder = [...args.caseload].sort(
    (a, b) => BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band) ||
      a.personId.localeCompare(b.personId)
  );
  const toRefresh = refreshOrder.slice(0, SIGNAL_REFRESH_LIMIT);
  const truncated = refreshOrder.length > toRefresh.length;

  const ran = new Set<string>();
  const failed = new Map<string, string>();
  for (const row of toRefresh) {
    const result = await evaluateAll({ ctx, personId: row.personId, evidenceCutoff });
    for (const id of result.coverage.ran) ran.add(id);
    for (const f of result.coverage.failed) failed.set(f.providerId, f.reason);
    for (const { providerId, candidate } of result.candidates) {
      await upsertSignal(ctx, {
        personId: row.personId,
        sourceFeature: providerId,
        candidate,
        ownerPersonId: row.primaryClinicianId,
      });
    }
    // And the other half: concerns these providers used to raise and no longer
    // do. Without this the queue accumulates things that were true once, and a
    // clinician learns the rows are not current — which is worse than not
    // having them.
    await withdrawStaleSignals(ctx, {
      personId: row.personId,
      ranProviders: result.coverage.ran,
      stillPresent: new Set(result.candidates.map((c) => c.candidate.dedupeKey)),
      evidenceAt: evidenceCutoff,
    });
  }

  // Read for EVERYONE on the caseload, refreshed or not.
  const caseById = new Map(args.caseload.map((r) => [r.personId, r]));
  const open = await listOpenSignals(ctx);
  const items: WorkItem[] = [];
  for (const signal of open) {
    const row = caseById.get(signal.personId);
    // Not on this clinician's caseload. The caseload model decides who they may
    // see, and a signal is not a reason to widen it.
    if (!row) continue;
    const group = GROUP_FOR_BAND[signal.band];
    items.push({
      id: `signal:${signal.id}`,
      group,
      band: BAND_FOR_ATTENTION[signal.band],
      personId: signal.personId,
      personName: row.displayName,
      reason: signal.statement,
      detail: null,
      resolvedAt: null,
      change:
        signal.changeText ??
        (signal.state === "acknowledged" ? "You have reviewed this" : args.changeFor(signal.personId, signal.lastDetectedAt)),
      evidenceAt: signal.lastDetectedAt,
      ownerId: signal.ownerPersonId ?? row.primaryClinicianId,
      ownerName: args.ownerNames.get(signal.ownerPersonId ?? row.primaryClinicianId ?? "") ?? null,
      dueAt: signal.dueAt,
      overdue: false,
      eventCount: 1,
      action: "review",
      actionable: row.actionable,
      blockedReason: row.actionable
        ? null
        : "Another clinician owns this person under the active caseload model.",
      // NEVER TRUE HERE. This is the line §9 exists to protect: an attention
      // signal is review-worthiness and the alerts table keeps authority.
      safetyAuthority: false,
      signalId: signal.id,
      // §4 caps at three, and the limitations are what an honest row says about
      // itself — how much evidence, and what the evidence cannot support.
      supportFacts: signal.limitations.slice(0, 3),
      lastContactDays: row.daysSinceContact,
    });
  }

  return {
    items,
    coverage: {
      ran: [...ran].sort(),
      failed: [...failed].map(([providerId, reason]) => ({ providerId, reason })),
    },
    truncated,
  };
}

export async function buildWorkQueue(args: {
  clinicianId: string;
  tenantId: string;
  policy?: ClinicalPolicy;
  now?: Date;
}): Promise<WorkQueue> {
  const policy = args.policy ?? activePolicy();
  const now = args.now ?? new Date();

  const [alerts, caseload] = await Promise.all([
    alertQueue({ tenantId: args.tenantId, includeResolved: true, policy, now }),
    buildCaseload({ clinicianId: args.clinicianId, tenantId: args.tenantId, policy }),
  ]);

  // Owner display names, resolved once rather than per row. §10.3 requires a
  // current owner on every row, and §23.2 forbids "an alert without a clear
  // owner and possible action" — an id is not an owner to a human reading it.
  const ownerIds = [
    ...new Set([
      ...alerts.map((a) => a.ownerId),
      ...caseload.rows.map((r) => r.primaryClinicianId),
    ].filter((x): x is string => !!x)),
  ];
  const ownerNames = new Map<string, string>();
  if (ownerIds.length) {
    const c = await data();
    const rows = (await c.all(
      `SELECT id, name FROM users WHERE id IN (${ownerIds.map(() => "?").join(",")})`,
      ownerIds
    )) as Array<{ id: string; name: string }>;
    for (const r of rows) ownerNames.set(r.id, r.name);
  }

  // The most recent resolved alert per person is the "last review" that `change`
  // is measured against. Real and cheap; no invented comparison.
  const lastReviewed = new Map<string, string>();
  for (const a of alerts) {
    if (a.status !== "reviewed" || !a.resolvedAt) continue;
    const prev = lastReviewed.get(a.personId);
    if (!prev || parseStamp(a.resolvedAt) > parseStamp(prev)) {
      lastReviewed.set(a.personId, a.resolvedAt);
    }
  }
  const changeFor = (personId: string, evidenceAt: string): string | null => {
    const seen = lastReviewed.get(personId);
    if (!seen) return null;
    return parseStamp(evidenceAt) > parseStamp(seen)
      ? "New since your last review"
      : "No change since your last review";
  };

  const caseById = new Map(caseload.rows.map((r) => [r.personId, r]));
  const items: WorkItem[] = [];
  const withAlerts = new Set<string>();

  for (const [key, g] of collapse(alerts)) {
    const a = g.head;
    withAlerts.add(a.personId);
    const row = caseById.get(a.personId);
    // Coverage: the caseload model decides who may act. An item this clinician
    // cannot action still appears — hiding it would hide the work — but it says
    // why rather than offering a control that fails.
    const actionable = row?.actionable ?? true;
    items.push({
      id: `alert:${key}`,
      group: groupForAlert(a),
      band: a.band,
      personId: a.personId,
      personName: a.personName,
      reason: reasonFor(a.type),
      detail: a.detail,
      resolvedAt: a.resolvedAt,
      change: changeFor(a.personId, a.createdAt),
      evidenceAt: a.createdAt,
      ownerId: a.ownerId ?? row?.primaryClinicianId ?? null,
      ownerName: ownerNames.get(a.ownerId ?? row?.primaryClinicianId ?? "") ?? null,
      dueAt: a.dueAt,
      overdue: a.overdue,
      eventCount: g.alerts.length,
      action: a.status === "reviewed" ? "open" : "review",
      actionable,
      blockedReason: actionable ? null : "Another clinician owns this person under the active caseload model.",
      // An alert IS the safety engine's output. This is the one source in the
      // queue that carries safety authority, and saying so on the row is what
      // keeps §2's "non-safety review_now cannot masquerade as safety" true
      // when an attention signal lands in the same bucket beside it.
      safetyAuthority: true,
      signalId: null,
      supportFacts: g.alerts.length > 1 ? [`${g.alerts.length} events collapsed into this row`] : [],
      lastContactDays: row?.daysSinceContact ?? null,
    });
  }

  // People who need attention but have raised no alert. Without these the queue
  // silently equals the alert list, and the caseload's own signal — days since
  // contact, unresolved distress — disappears from the clinician's day.
  for (const r of caseload.rows) {
    if (withAlerts.has(r.personId) || r.band === "none") continue;
    const evidenceAt = r.lastCheckinDate ?? stamp(now);
    items.push({
      id: `person:${r.personId}`,
      group: groupForCaseload(r),
      band: r.band,
      personId: r.personId,
      personName: r.displayName,
      reason: r.reasons[0] ?? "Flagged by the caseload model",
      detail: r.reasons.length > 1 ? r.reasons.slice(1).join(" · ") : null,
      resolvedAt: null,
      change: changeFor(r.personId, evidenceAt),
      evidenceAt,
      ownerId: r.primaryClinicianId,
      ownerName: ownerNames.get(r.primaryClinicianId ?? "") ?? null,
      dueAt: null,
      overdue: false,
      eventCount: 1,
      action: r.actionable ? "contact" : "open",
      actionable: r.actionable,
      blockedReason: r.actionable ? null : "Another clinician owns this person under the active caseload model.",
      // The caseload model bands people; it does not issue safety obligations.
      safetyAuthority: false,
      signalId: null,
      // §4 caps supporting facts at three. The caseload's own reasons are
      // already plain sentences, so they travel as they are.
      supportFacts: r.reasons.slice(1, 4),
      lastContactDays: r.daysSinceContact,
    });
  }

  // Approved follow-ups (Phase 3). The clinician's own note to themselves,
  // kept by them, surfacing as work.
  //
  // BEHIND THE THREADS FLAG and skipped entirely when it is off, so a
  // deployment without Phase 3 sees the queue it had. Its failure is swallowed
  // for the same reason the thread matcher's is: this is an addition to a
  // clinician's day, and an addition that could take the whole queue down with
  // it would be a worse trade than not having it.
  if (thoughtsFlagEnabled("CLINICIAN_THREADS")) {
    try {
      const { openFollowUps } = await import("./followups");
      const ctx = { tenantId: args.tenantId, personId: args.clinicianId };
      for (const f of await openFollowUps(ctx, { now })) {
        const row = caseById.get(f.personId);
        // Only for people this clinician actually holds. A follow-up written by
        // a colleague about their own patient is their work, not this
        // clinician's, and the caseload model already knows the difference.
        if (!row) continue;
        items.push({
          id: `followup:${f.itemId}`,
          // Review-today, never needs-action-now: nothing is wrong, somebody
          // asked themselves to remember something.
          group: "review_today",
          // "watch", the lowest band that still appears. A follow-up is a
          // standing intention, not an escalation, and giving it a working
          // band would let a note-to-self outrank a person the caseload model
          // is actually worried about.
          band: "watch",
          personId: f.personId,
          personName: row.displayName,
          reason: "Follow-up you recorded",
          detail: f.label ? `${f.text} · ${f.label}` : f.text,
          resolvedAt: null,
          change: null,
          evidenceAt: f.approvedAt,
          ownerId: f.approvedBy ?? row.primaryClinicianId,
          ownerName: ownerNames.get(f.approvedBy ?? row.primaryClinicianId ?? "") ?? null,
          dueAt: null,
          overdue: false,
          eventCount: 1,
          action: "open",
          actionable: row.actionable,
          blockedReason: row.actionable ? null : "Another clinician owns this person under the active caseload model.",
          safetyAuthority: false,
          signalId: null,
          supportFacts: f.label ? [f.label] : [],
          lastContactDays: row.daysSinceContact,
        });
      }
    } catch (err) {
      console.error("follow-up queue rows failed (non-fatal):", err);
    }
  }

  // ── Attention signals (expansion handoff 03, Phase 1) ────────────────────
  //
  // BEHIND ITS OWN FLAG, AND SKIPPED ENTIRELY WHEN IT IS OFF. Phase 1's
  // definition of done is "existing queue unchanged when feature is off", and
  // that has to mean the ORDER and the counts, not just the rendering — so the
  // merge itself is inside the branch. With the flag off nothing below runs,
  // `coverage` stays empty, and the queue is byte-identical to the one that
  // shipped before this handoff.
  //
  // The failure is swallowed for the same reason the follow-ups' is: this is an
  // addition to a clinician's day, and an addition that could take the whole
  // queue down with it would be a worse trade than not having it. §20's rule
  // is the same one from the other side — partial coverage, surfaced.
  const coverage: WorkQueue["coverage"] = {
    providersRan: [], providersFailed: [], truncated: false,
  };
  if (commandCenterFlagEnabled("CLINICAL_ATTENTION_SIGNALS")) {
    try {
      const merged = await mergeAttentionSignals({
        tenantId: args.tenantId,
        clinicianId: args.clinicianId,
        caseload: caseload.rows,
        ownerNames,
        changeFor,
        now,
      });
      items.push(...collapseWithCaseloadRows(items, merged.items));
      coverage.providersRan = merged.coverage.ran;
      coverage.providersFailed = merged.coverage.failed;
      coverage.truncated = merged.truncated;
    } catch (err) {
      console.error("attention signal merge failed (non-fatal):", err);
      coverage.providersFailed = [{ providerId: "merge", reason: "unavailable" }];
    }
  }

  // §20.3: "Queue order is stable for the same policy version and evidence
  // set." Every comparison is total and the final tiebreak is the item id, so
  // two builds over identical data produce identical order — which is what
  // makes "the third row" a thing a clinician can say to a colleague.
  items.sort((x, y) => {
    if (x.overdue !== y.overdue) return x.overdue ? -1 : 1;
    const b = BAND_ORDER.indexOf(x.band) - BAND_ORDER.indexOf(y.band);
    if (b !== 0) return b;
    if (x.dueAt !== y.dueAt) {
      if (x.dueAt === null) return 1;
      if (y.dueAt === null) return -1;
      const d = parseStamp(x.dueAt) - parseStamp(y.dueAt);
      if (d !== 0) return d;
    }
    const e = parseStamp(y.evidenceAt) - parseStamp(x.evidenceAt);
    if (e !== 0) return e;
    return x.id.localeCompare(y.id);
  });

  const groupCounts = {
    needs_action: 0, review_today: 0, waiting_member: 0,
    waiting_staff: 0, recently_resolved: 0,
  } as Record<WorkGroup, number>;
  for (const i of items) groupCounts[i.group] += 1;

  const uiCounts: Record<UiGroup, number> = {
    needs_attention: 0, review_today: 0, waiting: 0,
  };
  for (const i of items) {
    const ui = uiGroupFor(i.group);
    if (ui) uiCounts[ui] += 1;
  }

  // Stable = the authorized caseload minus everyone with open work. Computed
  // from the items that are actually in the queue rather than from a second
  // pass over the sources, so the four counts and the list can never disagree
  // about the same person.
  const withOpenWork = new Set(
    items.filter((i) => i.group !== "recently_resolved").map((i) => i.personId)
  );
  const stablePersonIds = caseload.rows
    .filter((r) => !withOpenWork.has(r.personId))
    .map((r) => r.personId)
    .sort();

  const newest = items.reduce<string | null>(
    (acc, i) => (acc === null || parseStamp(i.evidenceAt) > parseStamp(acc) ? i.evidenceAt : acc),
    null
  );

  return {
    items,
    groupCounts,
    uiCounts,
    stableCount: stablePersonIds.length,
    stablePersonIds,
    coverage,
    policyVersion: policy.version,
    computedAt: stamp(now),
    newestEvidenceAt: newest,
  };
}

/** Items in one group, in queue order. */
export function inGroup(q: WorkQueue, g: WorkGroup): WorkItem[] {
  return q.items.filter((i) => i.group === g);
}


// ---------------------------------------------------------------------------
// The projection envelope (Wave 1, §30.3 clinician_queue, §30.8)
// ---------------------------------------------------------------------------

export const CLINICIAN_QUEUE_SCHEMA = "clinician_queue.v1";

/** buildWorkQueue, wrapped in §30.8's presentation states.
 *
 *  The distinction this exists to make: an empty queue because the day is
 *  genuinely clear, and an empty queue because the projection threw, currently
 *  render the same way — a page that maps over `items` shows a blank list for
 *  both. The first is good news. The second is a clinician working blind while
 *  believing they are up to date, and the failure is silent.
 *
 *  A policy failure is separated from both. §30.8 fails closed on it: without a
 *  policy version there is no defensible priority order, so the queue must say
 *  that rather than present an order it cannot justify. */
export async function clinicianQueueProjection(args: {
  clinicianId: string;
  tenantId: string;
  policy?: ClinicalPolicy;
  now?: Date;
  /** Correlation id for a failure, supplied by the caller so the same id can be
   *  logged server-side and quoted on screen (§30.8). */
  correlationId?: string;
}): Promise<Envelope<WorkQueue>> {
  const now = args.now ?? new Date();
  let policy: ClinicalPolicy;
  try {
    policy = args.policy ?? activePolicy();
  } catch {
    return policyUnavailable<WorkQueue>({
      schemaVersion: CLINICIAN_QUEUE_SCHEMA,
      projectionVersion: CLINICIAN_QUEUE_SCHEMA,
      generatedAt: stamp(now),
      tenantId: args.tenantId,
      sourceWatermark: null,
      policyVersion: "unavailable",
    });
  }

  const meta: ProjectionMeta = {
    schemaVersion: CLINICIAN_QUEUE_SCHEMA,
    projectionVersion: `${CLINICIAN_QUEUE_SCHEMA}+${policy.version}`,
    generatedAt: stamp(now),
    tenantId: args.tenantId,
    sourceWatermark: null,
    policyVersion: policy.version,
  };

  let queue: WorkQueue;
  try {
    queue = await buildWorkQueue({ ...args, policy, now });
  } catch {
    // No fallback to raw tables (§30.8). A queue assembled from whatever
    // happened to load is a priority order nobody computed.
    return projectionFailed<WorkQueue>(meta, args.correlationId ?? "unknown");
  }

  meta.sourceWatermark = queue.newestEvidenceAt;
  if (queue.items.length === 0) {
    return empty<WorkQueue>(
      meta,
      `The queue ran against policy ${policy.version} and found no open work. ` +
      "This is an empty result, not a failure to load."
    );
  }
  return ready(meta, queue);
}
