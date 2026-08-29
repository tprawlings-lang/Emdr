import { data } from "@/lib/data";
import { CLINICAL_POLICY_VERSION } from "@/lib/clinical-policy";
import type { TimelineEvent, GateMark } from "@/components/charts/clinical";

// The safety timeline (§29's clinician inventory; chart p78).
//
// "Fixed gate events and human response" — what the deterministic rules did,
// in order, and what a person did about each.
//
// THE RULE THIS SCREEN EXISTS TO NOT BREAK. §29.1: "Show fixed event
// timelines and response workflow. Do not create a predictive risk score."
// This is the surface where a score would be most welcome and most wrong: a
// clinician looking at three amber marks wants a fourth telling them what
// comes next, and anything this system offered would be a guess with the
// authority of a measurement.
//
// So every mark below is an event that HAPPENED, sourced from a row that
// records it, and nothing here is computed forward. There is no trend, no
// projection, and no summary verdict — only the sequence and the rule behind
// each step.

/** Alert types map to the four marks the page example draws. A type with no
 *  mapping is shown as a review rather than dropped: an unclassified safety
 *  event is exactly the one a clinician must not miss. */
const MARK_FOR: Record<string, GateMark> = {
  session_hard_stop: "block",
  screening_risk_item: "pause",
  checkin_risk_item: "pause",
  crisis_routed: "block",
  unlock_requested: "review",
  autopilot_escalation: "pause",
};

const DETAIL_FOR: Record<string, string> = {
  session_hard_stop: "Session stopped on a safety threshold",
  screening_risk_item: "Risk item answered on a screening instrument",
  checkin_risk_item: "Risk item answered on a daily check-in",
  crisis_routed: "Crisis resources shown and routed",
  unlock_requested: "Member asked for a gated module",
  autopilot_escalation: "Plan escalated for human review",
};

export interface SafetyTimeline {
  events: TimelineEvent[];
  /** Gates that fired and have no recorded human response. The count a
   *  clinician actually needs, and the one a timeline alone hides. */
  awaitingResponse: number;
}

export async function buildSafetyTimeline(
  personId: string,
  tenantId: string,
): Promise<SafetyTimeline | null> {
  const c = await data();

  // Tenant-scoped. The measures page shipped without this once — a person id
  // alone read across tenants, and the access was audited under the
  // clinician's name, which made it look sanctioned.
  const rows = (await c.all(
    `SELECT a.alert_type, a.status, substr(a.created_at, 1, 10) AS day,
            substr(a.reviewed_at, 1, 10) AS reviewed_day
       FROM alerts a
       JOIN users u ON u.id = a.user_id
      WHERE a.user_id = ? AND u.tenant_id = ?
      ORDER BY a.created_at`,
    [personId, tenantId],
  )) as { alert_type: string; status: string; day: string; reviewed_day: string | null }[];

  if (rows.length === 0) return null;

  const events: TimelineEvent[] = [];
  let awaiting = 0;

  for (const r of rows) {
    events.push({
      date: r.day.slice(5),
      mark: MARK_FOR[r.alert_type] ?? "review",
      detail: DETAIL_FOR[r.alert_type] ?? r.alert_type.replace(/_/g, " "),
      version: CLINICAL_POLICY_VERSION,
    });

    // The human response is its own event, because "a rule fired" and "a
    // person answered it" are two different facts and a timeline that merges
    // them cannot show the gap between.
    if (r.status !== "open" && r.reviewed_day) {
      events.push({
        date: r.reviewed_day.slice(5),
        mark: "clear",
        detail: "Reviewed and documented by a clinician",
      });
    } else if (r.status === "open") {
      awaiting++;
    }
  }

  return { events, awaitingResponse: awaiting };
}
