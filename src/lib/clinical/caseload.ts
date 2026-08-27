// Caseload and priority ordering (Phase 4; workflow spec §1).
//
// The clinician's home surface answers one question: who needs me today, and
// why. Two rules shape everything here.
//
// ORDERED BY CLINICAL NEED, NOT BY CONTRACT TIER. Priority review is a Premium
// *scheduling* benefit — a request queues at a higher severity so it sorts
// sooner — and it changes nothing about the clinical bar for the decision.
// A paying member does not get a lower threshold. That is already true in the
// gate chain and must stay true here.
//
// EVERY BAND CARRIES ITS REASON. A row that says "high priority: 34" teaches a
// clinician to trust a number they cannot interrogate. The reason names the
// event, the date, and what changed, so the clinician can disagree with the
// ranking — which is the only way a ranking earns trust.

import { data } from "../data";
import { activePolicy, type CaseloadModel, type ClinicalPolicy } from "../clinical-policy";

export type PriorityBand = "immediate" | "high" | "standard" | "watch" | "none";

/** Response expectation per band. Deadlines are policy, not opinion, and the
 *  coverage model determines whether they are honest — a same-day deadline
 *  under a business-hours rota means "next working day" after 5pm. */
export const BAND_DEADLINE_HOURS: Record<PriorityBand, number | null> = {
  immediate: 24,
  high: 24,
  standard: 168,
  watch: null,
  none: null,
};

export interface CaseloadRow {
  personId: string;
  displayName: string;
  band: PriorityBand;
  /** Mandatory. Never a bare score. */
  reasons: string[];
  daysSinceContact: number | null;
  openAlerts: number;
  lastCheckinDate: string | null;
  /** Whether this clinician may act, under the active caseload model. */
  actionable: boolean;
  /** Named owner where the model has one. */
  primaryClinicianId: string | null;
}

export interface Caseload {
  rows: CaseloadRow[];
  model: CaseloadModel;
  policyVersion: string;
  /** Counts by band, so the shape of the day is visible before the list. */
  bandCounts: Record<PriorityBand, number>;
}

const BAND_ORDER: PriorityBand[] = ["immediate", "high", "standard", "watch", "none"];

function worst(a: PriorityBand, b: PriorityBand): PriorityBand {
  return BAND_ORDER.indexOf(a) <= BAND_ORDER.indexOf(b) ? a : b;
}

function daysBetween(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.replace(" ", "T") + (iso.includes("T") ? "" : "Z"));
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / 86400000);
}

interface RawRow {
  person_id: string;
  display_name: string;
  last_checkin_date: string | null;
  last_checkin_action: string | null;
  harm_urge: number | null;
  feels_safe: number | null;
  open_alerts: number;
  urgent_alerts: number;
  hard_stops_7d: number;
  unresolved_distress: number;
  pending_unlocks: number;
  last_activity: string | null;
  primary_clinician_id: string | null;
}

/** Build the caseload for one clinician within one tenant.
 *
 *  `tenantId` is required rather than optional: a caseload that silently spans
 *  tenants is the exact failure ADR 0011 exists to prevent, and defaulting it
 *  would make that failure a typo away. */
export async function buildCaseload(args: {
  clinicianId: string;
  tenantId: string;
  policy?: ClinicalPolicy;
  now?: Date;
}): Promise<Caseload> {
  const policy = args.policy ?? activePolicy();
  const now = args.now ?? new Date();
  const c = await data();

  const raw = (await c.all(
    `SELECT u.id                AS person_id,
            u.name              AS display_name,
            ci.checkin_date     AS last_checkin_date,
            ci.recommended_action AS last_checkin_action,
            ci.harm_urge        AS harm_urge,
            ci.feels_safe       AS feels_safe,
            (SELECT COUNT(*) FROM alerts a
              WHERE a.user_id = u.id AND a.status = 'open')            AS open_alerts,
            (SELECT COUNT(*) FROM alerts a
              WHERE a.user_id = u.id AND a.status = 'open'
                AND a.severity = 'urgent')                             AS urgent_alerts,
            (SELECT COUNT(*) FROM therapy_sessions s
              WHERE s.user_id = u.id AND s.status = 'hard_stop'
                AND s.ended_at >= ?)                                   AS hard_stops_7d,
            (SELECT COUNT(*) FROM post_session_checks p
              WHERE p.user_id = u.id AND p.recovery_confirmed = 0)     AS unresolved_distress,
            (SELECT COUNT(*) FROM module_unlocks mu
              WHERE mu.user_id = u.id AND mu.status = 'requested')     AS pending_unlocks,
            (SELECT MAX(created_at) FROM checkins x WHERE x.user_id = u.id) AS last_activity,
            (SELECT mu2.clinician_id FROM module_unlocks mu2
              WHERE mu2.user_id = u.id AND mu2.clinician_id IS NOT NULL
              ORDER BY mu2.decided_at DESC LIMIT 1)                    AS primary_clinician_id
       FROM users u
       LEFT JOIN checkins ci
         ON ci.user_id = u.id
        AND ci.checkin_date = (SELECT MAX(checkin_date) FROM checkins z WHERE z.user_id = u.id)
      WHERE u.role = 'member' AND u.status = 'active' AND u.tenant_id = ?`,
    [new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 19).replace("T", " "), args.tenantId]
  )) as RawRow[];

  const rows: CaseloadRow[] = raw.map((r) => {
    let band: PriorityBand = "none";
    const reasons: string[] = [];

    // ---- Immediate ----
    if (r.harm_urge === 1) {
      band = worst(band, "immediate");
      reasons.push(`Harm urge reported on the check-in of ${r.last_checkin_date}`);
    }
    if (r.feels_safe === 0) {
      band = worst(band, "immediate");
      reasons.push(`Does not feel safe — check-in of ${r.last_checkin_date}`);
    }
    if (r.urgent_alerts > 0) {
      band = worst(band, "immediate");
      reasons.push(`${r.urgent_alerts} urgent alert${r.urgent_alerts === 1 ? "" : "s"} open`);
    }

    // ---- High ----
    if (r.hard_stops_7d > 0) {
      band = worst(band, "high");
      reasons.push(`${r.hard_stops_7d} session hard stop${r.hard_stops_7d === 1 ? "" : "s"} in the last 7 days`);
    }
    if (r.unresolved_distress > 0) {
      band = worst(band, "high");
      reasons.push(`${r.unresolved_distress} post-session check${r.unresolved_distress === 1 ? "" : "s"} without confirmed recovery`);
    }

    // ---- Standard ----
    if (r.pending_unlocks > 0) {
      band = worst(band, "standard");
      reasons.push(`${r.pending_unlocks} unlock request${r.pending_unlocks === 1 ? "" : "s"} awaiting a decision`);
    }
    if (r.open_alerts > r.urgent_alerts) {
      band = worst(band, "standard");
      reasons.push(`${r.open_alerts - r.urgent_alerts} non-urgent alert${r.open_alerts - r.urgent_alerts === 1 ? "" : "s"} open`);
    }

    // ---- Watch ----
    const daysSinceContact = daysBetween(r.last_activity, now);
    if (band === "none" && daysSinceContact !== null && daysSinceContact >= 7) {
      band = "watch";
      reasons.push(`No check-in for ${daysSinceContact} days`);
    }
    if (band === "none" && r.last_checkin_action && r.last_checkin_action !== "processing_ok") {
      band = "watch";
      reasons.push(`Latest check-in routed to ${r.last_checkin_action}`);
    }

    return {
      personId: r.person_id,
      displayName: r.display_name,
      band,
      reasons,
      daysSinceContact,
      openAlerts: Number(r.open_alerts ?? 0),
      lastCheckinDate: r.last_checkin_date,
      actionable: canAct(policy.caseload, args.clinicianId, r.primary_clinician_id),
      primaryClinicianId: r.primary_clinician_id,
    };
  });

  // Clinical need first; within a band, longest since contact first. Nothing
  // about tier, plan, or payment participates in this ordering.
  rows.sort((a, b) => {
    const d = BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band);
    if (d !== 0) return d;
    return (b.daysSinceContact ?? -1) - (a.daysSinceContact ?? -1);
  });

  const bandCounts = { immediate: 0, high: 0, standard: 0, watch: 0, none: 0 } as Record<PriorityBand, number>;
  for (const r of rows) bandCounts[r.band]++;

  return { rows, model: policy.caseload, policyVersion: policy.version, bandCounts };
}

/** May this clinician act on this member, under the configured model?
 *
 *  `hybrid` is the T0/T1 default: a named owner carries accountability, and
 *  anyone in the tenant may still act, because the alternative is that a member
 *  in an Immediate band waits for one person to come back from leave. */
export function canAct(
  model: CaseloadModel, clinicianId: string, primaryClinicianId: string | null
): boolean {
  switch (model) {
    case "pooled": return true;
    case "owned": return primaryClinicianId === null || primaryClinicianId === clinicianId;
    case "hybrid": return true;
  }
}

/** Whether acting here is a coverage action rather than the owner's own —
 *  displayed so the clinician knows they are stepping into someone else's
 *  caseload, and recorded when they do. */
export function isCoverageAction(
  model: CaseloadModel, clinicianId: string, primaryClinicianId: string | null
): boolean {
  if (model === "pooled") return false;
  return primaryClinicianId !== null && primaryClinicianId !== clinicianId;
}
