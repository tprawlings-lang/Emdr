// Notification truth (GUI and Decision-Surface Handoff §3.8).
//
// The defect this module exists to close: four member surfaces told a member
// that their care team "has been notified" or "has been alerted". Every one of
// those sentences was rendered because `createAlert()` had just run — and
// `createAlert()` is a single `INSERT INTO alerts`. There is no delivery
// channel in this codebase. No email, no SMS, no push, no webhook. The `alerts`
// table has no `delivered_at` and no `acknowledged_at`; its only lifecycle is
// `status: open | reviewed`, which records a CLINICIAN opening the row in the
// console at some later point, not a message reaching a human.
//
// So the claim was derived from an attempted write, which §3.8 forbids outright:
//
//   "The GUI must never claim notification from an attempted write. Only a
//    delivery receipt can support 'delivered.' Only a separate acknowledgment
//    event can support 'acknowledged.'"
//
// It also contradicted the product's own public copy. /demo, /trust and the
// home FAQ all state that no one monitors this environment and no care team is
// assigned. A member in crisis was being told the opposite of what a reviewer
// was being told on the same deployment — and the member was being told it at
// the exact moment the claim mattered most.
//
// The fix is to make the claim a function of state that actually exists. When a
// channel lands, the later states become reachable by supplying a receipt; no
// copy site changes, because no copy site is allowed to assert delivery on its
// own again.

/** Where an escalation can be in its life. Ordered by how much the product is
 *  entitled to claim; nothing may skip ahead. */
export type DeliveryState =
  | "not_configured"
  | "queued"
  | "delivered"
  | "acknowledged"
  | "failed";

/** Evidence that a state was reached.
 *
 *  `at` is required for the two states that name a time to the member, because
 *  a time is the thing that makes those sentences checkable. A `delivered`
 *  record without a receipt time is not a delivery — it is a hope — and
 *  `deliveryNotice` refuses to render one. */
export interface DeliveryReceipt {
  state: DeliveryState;
  /** ISO timestamp from the receipt itself, never from the send attempt. */
  at?: string;
  /** Who acknowledged. Only meaningful for `acknowledged`. */
  actorName?: string;
}

/** Is there any configured way to reach a human about an escalation?
 *
 *  False for the whole of this beta, and deliberately a named constant rather
 *  than an environment variable: an environment setting would let a deployment
 *  turn the claim on without the channel existing, which is the failure this
 *  module removes. It flips when a channel is built and can prove delivery. */
export const ESCALATION_CHANNEL_CONFIGURED = false;

export class NotificationTruthError extends Error {}

function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new NotificationTruthError(`unparseable receipt time: ${iso}`);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** The member-safe sentence for a delivery state, verbatim from §3.8.
 *
 *  Every branch either makes no claim or cites a time that came from a receipt.
 *  Note that `queued` and `failed` both tell the member not to wait — a queued
 *  alert is not a reason to stop seeking help, and saying so is the whole point
 *  of distinguishing it from `delivered`. */
export function deliveryNotice(receipt: DeliveryReceipt): string {
  switch (receipt.state) {
    case "not_configured":
      return "This activity is not monitored. Use the support options below.";
    case "queued":
      return "Steady is trying to send an alert. Do not wait for a response if you need help now.";
    case "delivered":
      if (!receipt.at) {
        throw new NotificationTruthError(
          "a 'delivered' notice needs a receipt time; without one there is no delivery to report"
        );
      }
      return `An alert was delivered to your care team at ${clockTime(receipt.at)}. Response times vary.`;
    case "acknowledged":
      if (!receipt.at || !receipt.actorName) {
        throw new NotificationTruthError(
          "an 'acknowledged' notice needs both the acknowledging person and the time they acknowledged"
        );
      }
      return `${receipt.actorName} acknowledged this alert at ${clockTime(receipt.at)}.`;
    case "failed":
      return "Steady could not deliver the alert. Use the support options below now.";
  }
}

/** The current escalation state for a member surface.
 *
 *  Takes an optional receipt so a caller that HAS one can pass it. With no
 *  channel configured there is nothing to look up, and the honest answer is
 *  `not_configured` — which is also what the trust and demo pages already tell
 *  reviewers, so the product now says one thing to both audiences. */
export function escalationState(receipt?: DeliveryReceipt): DeliveryReceipt {
  if (!ESCALATION_CHANNEL_CONFIGURED) return { state: "not_configured" };
  return receipt ?? { state: "queued" };
}

/** What a member surface should say about escalation right now. */
export function escalationNotice(receipt?: DeliveryReceipt): string {
  return deliveryNotice(escalationState(receipt));
}
