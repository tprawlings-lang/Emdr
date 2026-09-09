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
  /** Optional, and only for a caller that replays: the demo agent regenerates a
   *  fixed calendar, so its rows carry deterministic ids and re-running must not
   *  double them. Every live path leaves this unset and gets a fresh id. */
  id?: string;
  userId: string;
  /** The alert's kind, from the caller. Stored in `alert_type`. */
  type: string;
  severity: AlertSeverity;
  /** What a clinician reads. Never a raw score alone — the callers include the
   *  instrument and the flag, so the row is actionable without a second query. */
  detail: string;
}

/** The one statement that writes this table, and the one argument order that
 *  goes with it. Exported as a pair because NOT EVERY CALLER CAN AWAIT: the
 *  demo agent layer runs inside a synchronous better-sqlite3 transaction and
 *  drives prepared statements directly, so its choices were to hand-write a
 *  second INSERT — which is exactly the divergence this file exists to end —
 *  or to prepare this one. */
const ALERT_COLUMNS = "id, user_id, alert_type, severity, detail";

export const ALERT_INSERT_SQL =
  `INSERT INTO alerts (${ALERT_COLUMNS}) VALUES (?, ?, ?, ?, ?)`;

/** The same insert for a replaying caller. The demo agent regenerates the same
 *  fabricated fortnight from the same ids; without this, a second run would
 *  either throw on the primary key or double every alert. */
export const ALERT_INSERT_IDEMPOTENT_SQL = `${ALERT_INSERT_SQL} ON CONFLICT(id) DO NOTHING`;

/**
 * Seeded history only: an alert AND the closure of its loop, in one row.
 *
 * A live raise cannot set these columns — a clinician closes an alert by
 * reviewing it, which is a separate write by a separate actor. What the demo
 * seed needs is a chart that already contains a hard stop somebody called the
 * member about, and a row like that has to arrive with its review attached.
 *
 * Here rather than written out at the seed, because it shares the first five
 * columns with every other alert this product files, and a hand-written copy of
 * that list is the drift this file was created to end. Its bind order is
 * `alertValues(...)` followed by status, reviewed_by, review_note, created_at,
 * reviewed_at.
 */
export const ALERT_INSERT_SEEDED_SQL =
  `INSERT INTO alerts (${ALERT_COLUMNS}, status, reviewed_by, review_note, created_at, reviewed_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** The bind values for any of these statements, in its column order. */
export function alertValues(args: NewAlert): [string, string, string, AlertSeverity, string] {
  return [args.id ?? newId(), args.userId, args.type, args.severity, args.detail];
}

export async function createAlert(args: NewAlert): Promise<void> {
  const c = await data();
  await c.run(ALERT_INSERT_SQL, alertValues(args));
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

/**
 * The alert a safety-positive check-in raises, wherever a check-in is written.
 *
 * THE SECOND INSTANCE OF THE SAME DEFECT, found by sweeping for it rather than
 * by walking an intake again. `evaluateCheckin` returns "crisis" when a member
 * reports an urge to harm themselves or others, or that they do not feel safe
 * where they are. The web action raised an urgent alert and routed to crisis
 * resources; the mobile submit raised the same alert with its own copy of the
 * wording; and `src/lib/agents/runner.ts` — which runs THE PRODUCT'S OWN
 * routing rule over a fabricated population, under a comment saying so —
 * recorded the crisis routing on the check-in row and raised nothing.
 *
 * The cost of that was visible on the console before it was explained: those
 * people band "immediate" on the caseload, with the reason "Harm urge reported
 * on the check-in of …", and a clinician opening them finds nothing to act on
 * and nothing to close. It is indistinguishable from the live defect this file
 * was created for.
 *
 * A shape rather than three literals, because the wording had already drifted
 * between the two paths that did raise it.
 */
export function checkinSafetyAlert(args: {
  userId: string;
  /** From the check-in itself. Decides which of the two answers is reported —
   *  a clinician needs to know which one before opening the chart. */
  harmUrge: boolean;
  /** Which surface the check-in came from. Absent on the web, where the
   *  original wording carried no marker and the rows already written say so. */
  via?: string;
  id?: string;
}): NewAlert {
  const via = args.via ? ` (${args.via})` : "";
  return {
    id: args.id,
    userId: args.userId,
    type: "checkin_safety_positive",
    severity: "urgent",
    detail: args.harmUrge
      ? `Member reported urge to harm self or others on daily check-in${via}.`
      : `Member reported not feeling safe where they are${via}.`,
  };
}

export async function raiseCheckinSafetyAlert(args: {
  userId: string;
  harmUrge: boolean;
  via?: string;
}): Promise<void> {
  await createAlert(checkinSafetyAlert(args));
}
