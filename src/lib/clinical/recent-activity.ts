// The Recent Activity feed (expansion handoff 03 §7; Phase 4).
//
// §7's first sentence draws the line this file exists to hold: "Recent Activity
// is a clinician situational-awareness feed built from authorized events. It is
// not a raw audit log and not a firehose of every patient action."
//
// Phase 4's definition of done says the same thing from the other side:
// "activity is not a raw-event firehose." A feed that showed every row in
// `longitudinal_events` would be complete, would be honest, and would be
// unreadable — and an unreadable feed is one a clinician stops opening, which
// is worse than not having it.
//
// SO THREE THINGS DECIDE WHAT APPEARS.
//
//   AN ALLOWLIST OF EVENT TYPES, not a denylist. §7 names what to include, and
//   a new event type added by some future feature is EXCLUDED until somebody
//   decides it is clinically relevant. A denylist would mean every new type
//   arrives in a clinician's feed by default, which is how a feed becomes a
//   firehose without anyone choosing it.
//
//   COLLAPSE. §7: "collapse repetitive same-type events when individual items
//   add no clinical meaning." Four practice completions on one day is one line;
//   four separate lines is volume pretending to be information.
//
//   THE COMPANION RULE, WHICH IS THE HARD ONE. §7: "do not show raw Companion
//   transcript text in the clinician-wide feed. Companion entries obey source
//   visibility and consent. Metadata cannot bypass a content visibility
//   restriction."
//
//   That last clause is the trap. The obvious implementation shows "Sarah had a
//   Companion conversation" with no text and calls it metadata — but if the
//   active policy says a clinician may not see companion content, a feed line
//   saying a conversation happened at 9:18pm about a named topic IS content,
//   delivered by summary. So the topic never travels, and under a `never`
//   policy the line does not appear at all: the count of withheld entries does,
//   because §20 requires the absence to be visible without the thing being
//   shown.
//
// AND ONE THING THAT DOES NOT DECIDE: nothing here reads a model. §16: "no AI
// task decides queue position, urgency, safety state, due date, owner, or next
// action", and a feed is the same kind of surface — chronological, server
// ordered, explainable.

import { data } from "../data";
import { activePolicy, companionContentAllowed, type ClinicalPolicy } from "../clinical-policy";
import { buildCaseload } from "./caseload";

export const ACTIVITY_VERSION = "recent-activity.1.0.0";

/**
 * §7's inclusion list.
 *
 * Each entry says what it is in a clinician's words, and whether repeats of it
 * on one day collapse. A measure and a session are individually meaningful; a
 * practice completion mostly is not, and four of them on a Tuesday is one fact
 * about that Tuesday.
 */
export const ACTIVITY_KINDS = [
  "checkin", "measure", "session", "practice", "goal_milestone",
  "thought_saved", "companion", "safety", "followup",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  checkin: "Check-in",
  measure: "Measure",
  session: "Session",
  practice: "Practice",
  goal_milestone: "Life goal",
  thought_saved: "Your thoughts",
  companion: "Companion",
  safety: "Safety",
  followup: "Follow-up",
};

/**
 * Kinds whose repeats within one day collapse into a single line.
 *
 * TWO, AND THE LIST IS SHORT ON PURPOSE. §7 collapses "when individual items
 * add no clinical meaning", and that is a judgement per kind rather than a
 * general tidiness rule. A check-in is its own clinical fact — activation 8 on
 * Tuesday and activation 3 on Wednesday are two things a clinician reads
 * separately — so check-ins are never in here, and neither are sessions,
 * measures, goal milestones or safety obligations.
 *
 * Exported so the rule can be asserted rather than inferred from a fixture that
 * happens not to produce a collision.
 */
export const COLLAPSIBLE: ReadonlySet<ActivityKind> = new Set(["practice", "companion"]);

/** How a collapsed line reads, per kind. One sentence per collapsible kind
 *  rather than one for all of them — see the note at the collapse itself. */
const COLLAPSED_HEADLINE: Record<string, (n: number) => string> = {
  practice: (n) => `completed ${n} practices`,
  companion: (n) => `had ${n} Companion conversations`,
};

export interface ActivityItem {
  id: string;
  personId: string;
  personName: string;
  kind: ActivityKind;
  /** One line, in a clinician's words. Never a raw event key. */
  headline: string;
  /** A second line with the specifics, when there are any. */
  detail: string | null;
  occurredAt: string;
  /** How many events collapsed into this line. 1 when it is one. */
  eventCount: number;
  /** Where to open it, when the clinician has access. Null when the item is
   *  real and has nothing openable — which is itself worth showing. */
  href: string | null;
}

export interface RecentActivity {
  items: ActivityItem[];
  computedAt: string;
  policyVersion: string;
  activityVersion: string;
  /** §20 and §7: entries the companion-visibility policy kept out, counted so
   *  the absence is visible without the content being shown. */
  withheld: { count: number; reason: string };
  /** People whose activity this feed covers — the clinician's authorized
   *  caseload, never the whole tenant. */
  coveredPeople: number;
}

function stamp(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function dayOf(ts: string): string {
  return ts.slice(0, 10);
}

/**
 * Build the feed for one clinician's authorized caseload.
 *
 * THE CASELOAD IS THE SCOPE, and it is resolved before anything is read. §18:
 * "cross-patient and cross-tenant access fails before retrieval." A feed built
 * from the tenant's events and filtered afterwards would have already loaded
 * rows the clinician may not see, and "we filtered them out" is a weaker
 * property than "we never asked for them".
 */
export async function buildRecentActivity(args: {
  clinicianId: string;
  tenantId: string;
  policy?: ClinicalPolicy;
  now?: Date;
  limit?: number;
  kinds?: ActivityKind[];
}): Promise<RecentActivity> {
  const policy = args.policy ?? activePolicy();
  const now = args.now ?? new Date();
  const limit = args.limit ?? 60;
  const wanted = new Set<ActivityKind>(args.kinds ?? ACTIVITY_KINDS);

  const caseload = await buildCaseload({
    clinicianId: args.clinicianId, tenantId: args.tenantId, policy,
  });
  const people = caseload.rows;
  const names = new Map(people.map((r) => [r.personId, r.displayName]));
  const ids = people.map((r) => r.personId);

  if (ids.length === 0) {
    return {
      items: [], computedAt: stamp(now), policyVersion: policy.version,
      activityVersion: ACTIVITY_VERSION,
      withheld: { count: 0, reason: "" }, coveredPeople: 0,
    };
  }

  const c = await data();
  const placeholders = ids.map(() => "?").join(",");
  const raw: ActivityItem[] = [];
  let withheldCompanion = 0;

  // A cheap upper bound per source. The feed is a recency window, not an
  // archive, and reading everything to show sixty lines is how a page that
  // opens on every shift becomes the slowest one in the product.
  const perSource = Math.max(limit, 40);

  async function collect<T extends { person_id: string; occurred_at: string }>(
    kind: ActivityKind,
    sql: string,
    toItem: (row: T) => { id: string; headline: string; detail: string | null; href: string | null },
    extraParams: unknown[] = [],
  ): Promise<void> {
    if (!wanted.has(kind)) return;
    const rows = (await c.all(sql, [...ids, ...extraParams, perSource])) as T[];
    for (const row of rows) {
      const mapped = toItem(row);
      raw.push({
        id: `${kind}:${mapped.id}`,
        personId: row.person_id,
        personName: names.get(row.person_id) ?? "Unknown",
        kind,
        headline: mapped.headline,
        detail: mapped.detail,
        occurredAt: row.occurred_at,
        eventCount: 1,
        href: mapped.href,
      });
    }
  }

  await collect<{
    person_id: string; occurred_at: string; id: string;
    activation: number; sleep_quality: number; recommended_action: string;
  }>(
    "checkin",
    `SELECT id, user_id AS person_id, checkin_date AS occurred_at,
            activation, sleep_quality, recommended_action
       FROM checkins WHERE user_id IN (${placeholders})
      ORDER BY checkin_date DESC LIMIT ?`,
    (r) => ({
      id: r.id,
      headline: "completed a check-in",
      // The numbers a clinician scans for, not every field on the row.
      detail: `Activation ${r.activation} · sleep ${r.sleep_quality} · routed to ${r.recommended_action.replace(/_/g, " ")}`,
      href: `/clinician/member/${r.person_id}/record`,
    })
  );

  await collect<{
    person_id: string; occurred_at: string; id: string;
    instrument: string; total_score: number;
  }>(
    "measure",
    `SELECT id, user_id AS person_id, created_at AS occurred_at, instrument, total_score
       FROM screenings WHERE user_id IN (${placeholders})
      ORDER BY created_at DESC LIMIT ?`,
    (r) => ({
      id: r.id,
      headline: `completed ${r.instrument.toUpperCase()}`,
      detail: `Total ${r.total_score}`,
      href: `/clinician/member/${r.person_id}/measures`,
    })
  );

  await collect<{
    person_id: string; occurred_at: string; id: string;
    module_id: string; status: string; pre_suds: number | null; post_suds: number | null;
  }>(
    "session",
    `SELECT id, user_id AS person_id, started_at AS occurred_at, module_id, status, pre_suds, post_suds
       FROM therapy_sessions WHERE user_id IN (${placeholders})
      ORDER BY started_at DESC LIMIT ?`,
    (r) => ({
      id: r.id,
      headline:
        r.status === "hard_stop" ? "had a session stopped by a safety rule"
        : r.status === "abandoned" ? "left a session early"
        : r.status === "in_progress" ? "started a session"
        : "completed a session",
      // A missing close stays missing. The cross-feature invariant, in a feed.
      detail:
        r.pre_suds === null ? `${r.module_id.replace(/-/g, " ")} — no opening reading`
        : r.post_suds === null ? `${r.module_id.replace(/-/g, " ")} — distress ${r.pre_suds} at the start, no close reading`
        : `${r.module_id.replace(/-/g, " ")} — distress ${r.pre_suds} to ${r.post_suds}`,
      href: `/clinician/member/${r.person_id}/sessions`,
    })
  );

  await collect<{
    person_id: string; occurred_at: string; id: string; practice_id: string; duration_sec: number;
  }>(
    "practice",
    `SELECT id, user_id AS person_id, created_at AS occurred_at, practice_id, duration_sec
       FROM practice_completions WHERE user_id IN (${placeholders})
      ORDER BY created_at DESC LIMIT ?`,
    (r) => ({
      id: r.id,
      headline: "completed a practice",
      detail: `${r.practice_id.replace(/-/g, " ")} · ${Math.max(1, Math.round(r.duration_sec / 60))} min`,
      href: `/clinician/member/${r.person_id}/responses`,
    })
  );

  await collect<{
    person_id: string; occurred_at: string; id: string;
    observed_level: number | null; evidence_class: string;
  }>(
    "goal_milestone",
    `SELECT id, person_id, occurred_at, observed_level, evidence_class
       FROM return_to_life_observations
      WHERE person_id IN (${placeholders}) AND tenant_id = ? AND status = 'accepted'
      ORDER BY occurred_at DESC LIMIT ?`,
    (r) => ({
      id: r.id,
      headline: "moved on a life goal",
      // The evidence class travels: "they told us" and "you observed it" are
      // different facts and must not read the same in a feed either.
      detail: `Recorded as ${r.evidence_class.replace(/_/g, " ")}`,
      href: `/clinician/member/${r.person_id}/goals`,
    }),
    // BOUND, never interpolated. The tenant is the isolation boundary, and a
    // boundary assembled by string concatenation is a boundary one escaping
    // quote gets through.
    [args.tenantId]
  );

  await collect<{
    person_id: string; occurred_at: string; id: string;
    alert_type: string; detail: string; severity: string; status: string;
  }>(
    "safety",
    `SELECT id, user_id AS person_id, created_at AS occurred_at, alert_type, detail, severity, status
       FROM alerts WHERE user_id IN (${placeholders})
      ORDER BY created_at DESC LIMIT ?`,
    (r) => ({
      id: r.id,
      // Safety reads as safety here too. §2's rule about the queue holds in the
      // feed: a safety obligation and a review signal must never be worded so
      // they could be mistaken for each other.
      headline: `a safety obligation was raised: ${r.alert_type.replace(/_/g, " ")}`,
      detail: `${r.severity} · ${r.status === "reviewed" ? "closed" : "open"} · ${r.detail}`,
      href: `/clinician/alerts/${r.id}`,
    })
  );

  // ── Companion (§7, §18) ──────────────────────────────────────────────────
  //
  // METADATA ONLY, AND ONLY WHEN THE POLICY ALLOWS THE CONTENT.
  //
  // The obvious implementation shows "had a Companion conversation" with no
  // text and calls that metadata. But under a policy that withholds companion
  // content, a line naming a conversation, its time and its topic is content
  // delivered by summary — §7: "metadata cannot bypass a content visibility
  // restriction." So when the policy says no, the entries are counted and not
  // shown; when it says yes, the line still carries no transcript text, because
  // §7 forbids raw text in the clinician-wide feed under any policy.
  if (wanted.has("companion")) {
    const rows = (await c.all(
      `SELECT id, user_id AS person_id, started_at AS occurred_at, risk_level
         FROM ai_conversations WHERE user_id IN (${placeholders})
        ORDER BY started_at DESC LIMIT ?`,
      [...ids, perSource]
    )) as Array<{ id: string; person_id: string; occurred_at: string; risk_level: string }>;

    for (const r of rows) {
      // An escalation is a different context from a routine conversation, and
      // the policy distinguishes them. A conversation that raised risk is one a
      // clinician may see under `escalation`; an ordinary one is not.
      const context = r.risk_level && r.risk_level !== "none" ? "escalation" : "routine";
      if (!companionContentAllowed(context, policy)) {
        withheldCompanion += 1;
        continue;
      }
      raw.push({
        id: `companion:${r.id}`,
        personId: r.person_id,
        personName: names.get(r.person_id) ?? "Unknown",
        kind: "companion",
        headline: "had a Companion conversation",
        // No topic, no text, no first line. What a clinician gets is that it
        // happened and whether it raised anything — the rest is on the member's
        // own record, behind the same policy.
        detail:
          context === "escalation"
            ? "Risk language was flagged during it. The conversation itself is on their record."
            : "No new safety obligation was created.",
        occurredAt: r.occurred_at,
        eventCount: 1,
        href: `/clinician/member/${r.person_id}/record`,
      });
    }
  }

  // ── Order, collapse, cap ─────────────────────────────────────────────────
  //
  // §7: "default chronological order." Newest first, with the item id as a
  // total tiebreak so two builds over the same data produce the same feed.
  raw.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));

  const collapsed: ActivityItem[] = [];
  const seen = new Map<string, ActivityItem>();
  for (const item of raw) {
    if (!COLLAPSIBLE.has(item.kind)) {
      collapsed.push(item);
      continue;
    }
    // §7: "collapse repetitive same-type events when individual items add no
    // clinical meaning." Same person, same kind, same day.
    const key = `${item.personId}::${item.kind}::${dayOf(item.occurredAt)}`;
    const existing = seen.get(key);
    if (!existing) {
      const head = { ...item };
      seen.set(key, head);
      collapsed.push(head);
      continue;
    }
    existing.eventCount += 1;
    // The collapsed line stops naming one of them: "three practices" is the
    // fact, and picking one to name would make the other two invisible while
    // implying the named one mattered most.
    //
    // PER KIND, and this was a bug worth the extra table: a single hard-coded
    // sentence made two Companion conversations on one day read as "completed 2
    // practices". A collapse that reworded the thing it collapsed would be
    // worse than no collapse at all.
    existing.headline = COLLAPSED_HEADLINE[item.kind](existing.eventCount);
    existing.detail = null;
  }

  return {
    items: collapsed.slice(0, limit),
    computedAt: stamp(now),
    policyVersion: policy.version,
    activityVersion: ACTIVITY_VERSION,
    withheld: {
      count: withheldCompanion,
      reason:
        withheldCompanion === 0
          ? ""
          : `${withheldCompanion} Companion interaction${withheldCompanion === 1 ? "" : "s"} withheld by ` +
            `policy "${policy.companionVisibility}" (${policy.version}). They happened; you are not seeing them here.`,
    },
    coveredPeople: ids.length,
  };
}
