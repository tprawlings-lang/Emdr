// Raising a clinical alert. One writer, for every path that raises one.
//
// WHY THIS FILE EXISTS, and it is not tidiness. `createAlert` was a PRIVATE
// function in src/lib/actions.ts, and src/lib/mobile/service.ts carried a
// byte-identical copy under a comment saying so. A private writer is one a new
// call site cannot use — so when the paced screening gate needed to raise an
// alert, it had two options: copy the function a third time, or not raise one.
//
// It did neither, which is worse than both. `src/lib/member/gate-finish.ts` —
// the one-question-at-a-time gate every NEW member walks during baseline
// screening — computed the risk flags, wrote them to
// `screenings.risk_flags_json`, and continued to the next questionnaire. A
// member who answered PHQ-9's ninth item, the suicidal-ideation question,
// affirmatively was silently advanced, while the OTHER submit path in
// actions.ts raised an urgent alert and routed to the crisis screen for the
// same answer.
//
// Found by creating a patient, walking their intake, and then reading their
// rows: the flag was there and the alerts table was empty.
//
// THE TENANT COLUMN IS DELIBERATELY NOT SET, and that is worth stating rather
// than leaving as an omission somebody 'fixes' later. `alerts` has a
// `tenant_id` with a default, and no reader filters on it — every one of them
// joins through `user_id`, so the person's own tenancy does the scoping. Adding
// a lookup here would put a query on every alert write to populate a column
// nothing reads, and would make the new rows disagree with every existing one.

import { data } from "../data";
import { newId } from "../db";

export type AlertSeverity = "urgent" | "high" | "moderate" | "info";

export interface NewAlert {
  userId: string;
  /** The alert's kind, from the caller. Stored in `alert_type`. */
  type: string;
  severity: AlertSeverity;
  /** What a clinician reads. Never a raw score alone — the callers include the
   *  instrument and the flag, so the row is actionable without a second query. */
  detail: string;
}

export async function createAlert(args: NewAlert): Promise<void> {
  const c = await data();
  await c.run(
    "INSERT INTO alerts (id, user_id, alert_type, severity, detail) VALUES (?, ?, ?, ?, ?)",
    [newId(), args.userId, args.type, args.severity, args.detail]
  );
}

/**
 * The alert a positive risk item raises, wherever an instrument is submitted.
 *
 * A named helper rather than a shape each call site assembles, because the two
 * submit paths had already drifted once — and the drift was not in the wording,
 * it was in whether the alert existed at all. A caller that has risk flags and
 * a total has everything this needs, so there is no reason for a path to build
 * its own version.
 */
export async function raiseRiskItemAlert(args: {
  userId: string;
  instrumentId: string;
  riskFlags: ReadonlyArray<string>;
  total: number;
}): Promise<void> {
  await createAlert({
    userId: args.userId,
    type: "screening_risk_item",
    severity: "urgent",
    detail: `${args.instrumentId}: ${args.riskFlags.join(", ")} (total ${args.total})`,
  });
}
