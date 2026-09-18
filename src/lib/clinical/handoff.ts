// Handoff of accountability (§26: "Keep accountability through transfer").
//
// WHAT THIS SCREEN REFUSED TO DO, and why it was right to. `/clinician/handoffs`
// rendered a sentence instead of a list, and the sentence named its own
// requirement exactly: "a handoff — from, to, reason, due, accepted — is not
// modelled, so there is nothing to list… until then this screen would be
// inferring accountability from ownership, and that inference is exactly how
// people get lost between clinicians."
//
// THE INFERENCE IT REFUSED TO MAKE is the whole design. A work item already
// carries an owner, and `assignWork` already sets one — honestly, saying
// "nobody has been notified". Ownership is something ONE person decides.
// Accountability is something the OTHER person accepts. A screen built on
// owner changes would show a transfer that may never have been agreed to, and
// the two clinicians would each be able to point at it and believe the other
// had the person.
//
// SO A HANDOFF IS TWO EVENTS WITH A GAP BETWEEN THEM, and the gap is a state
// the product can see. Between `proposed` and a decision, THE SENDER IS STILL
// ACCOUNTABLE — this module says so, the screen says so in those words, and
// nothing in either pretends otherwise. That single rule is what makes this
// worth building rather than a list of owner changes with a nicer heading.
//
// IT STILL NOTIFIES NOBODY, and that is not a gap this build closes. There is
// no delivery path in this product, so a proposal sits until the receiver
// happens to open the screen. Every surface says that in those words rather
// than letting a "Sent" state imply a person was told, which is the same rule
// the escalation channel and the assignment action already follow.

import { getDb, newId } from "../db";
import { audit } from "../audit";
import { appendEventSafe } from "../events";

export const HANDOFF_STATES = ["proposed", "accepted", "declined", "withdrawn"] as const;
export type HandoffState = (typeof HANDOFF_STATES)[number];

/** A state nobody has answered yet. The only one where accountability has not
 *  moved and the sender is still holding it. */
export function isOpen(state: HandoffState): boolean {
  return state === "proposed";
}

/**
 * Who is accountable for this person right now, given a handoff's state.
 *
 * THE ONE FUNCTION THIS MODULE EXISTS FOR. Every surface asks it rather than
 * reading `to_clinician_id` and assuming, because reading the destination of an
 * unanswered proposal is precisely the inference the old screen refused to
 * make.
 */
export function accountableClinicianId(h: {
  state: HandoffState; fromClinicianId: string; toClinicianId: string;
}): string {
  return h.state === "accepted" ? h.toClinicianId : h.fromClinicianId;
}

/** Long enough to be a sentence. A transfer with no stated reason is the thing
 *  a receiving clinician cannot act on, and "handover" is not a reason. */
export const MIN_REASON = 12;

export interface Handoff {
  id: string;
  personId: string;
  personName: string;
  fromClinicianId: string;
  fromName: string;
  toClinicianId: string;
  toName: string;
  reason: string;
  dueAt: string | null;
  state: HandoffState;
  createdAt: string;
  decidedAt: string | null;
  decidedNote: string | null;
}

const SELECT = `
  SELECT h.id, h.person_id, h.from_clinician_id, h.to_clinician_id, h.reason,
         h.due_at, h.state, h.created_at, h.decided_at, h.decided_note,
         p.name AS person_name, f.name AS from_name, t.name AS to_name
    FROM care_handoffs h
    JOIN users p ON p.id = h.person_id
    JOIN users f ON f.id = h.from_clinician_id
    JOIN users t ON t.id = h.to_clinician_id
`;

interface Row {
  id: string; person_id: string; from_clinician_id: string; to_clinician_id: string;
  reason: string; due_at: string | null; state: string; created_at: string;
  decided_at: string | null; decided_note: string | null;
  person_name: string; from_name: string; to_name: string;
}

function hydrate(r: Row): Handoff {
  return {
    id: r.id,
    personId: r.person_id,
    personName: r.person_name,
    fromClinicianId: r.from_clinician_id,
    fromName: r.from_name,
    toClinicianId: r.to_clinician_id,
    toName: r.to_name,
    reason: r.reason,
    dueAt: r.due_at,
    state: r.state as HandoffState,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    decidedNote: r.decided_note,
  };
}

/**
 * Every handoff this clinician is on either end of, tenant-scoped.
 *
 * ONE QUERY FOR BOTH DIRECTIONS, split in the caller. Two queries would let
 * the two halves of the screen disagree about the tenant filter, which is the
 * class of drift the person header exists to prevent on the record tabs.
 */
export function handoffsFor(args: { clinicianId: string; tenantId: string }): Handoff[] {
  const rows = getDb()
    .prepare(
      `${SELECT} WHERE h.tenant_id = ?
         AND (h.from_clinician_id = ? OR h.to_clinician_id = ?)
       ORDER BY CASE h.state WHEN 'proposed' THEN 0 ELSE 1 END,
                h.created_at DESC`
    )
    .all(args.tenantId, args.clinicianId, args.clinicianId) as Row[];
  return rows.map(hydrate);
}

/** The handoffs on one person's record, for the record tab and the packet. */
export function handoffsForPerson(args: { personId: string; tenantId: string }): Handoff[] {
  const rows = getDb()
    .prepare(`${SELECT} WHERE h.tenant_id = ? AND h.person_id = ? ORDER BY h.created_at DESC`)
    .all(args.tenantId, args.personId) as Row[];
  return rows.map(hydrate);
}

// ---------------------------------------------------------------------------
// Proposal, delivery, receipt, decision (UX 007)
// ---------------------------------------------------------------------------
//
//   "Handoff workflow says it does not notify the recipient. Display delivery
//   status honestly and surface pending work. Acceptance: proposal, delivery,
//   receipt, and acceptance cannot be confused."
//
// The honesty was already here — every surface said "nobody has been notified"
// — and that sentence was doing the work of four different answers at once. A
// clinician reading it could not tell which of these was true: the proposal is
// recorded (it is), a message was sent (none was, and none can be), the
// receiver has seen it (nobody knows), the receiver has decided (not yet). Four
// facts, one disclaimer, and the two that matter most to a person waiting on a
// transfer — has it reached them, have they seen it — were the two the sentence
// did not distinguish.
//
// So each step is its own value with its own evidence. Two of them are
// negative, permanently, and that is the point: "not sent, because there is no
// channel" and "not known, because nothing records a read" are answers, where a
// blank is not.

/** How far a transfer has actually got, per step. */
export type HandoffStepState =
  /** Happened, with a time. */
  | "done"
  /** Cannot happen in this build. Not a failure and not a wait. */
  | "not_possible"
  /** Could be true; nothing records it either way. */
  | "not_recorded"
  /** Waiting on a named person. */
  | "pending"
  /** Answered, and the answer was no. */
  | "refused";

export interface HandoffStep {
  step: "proposal" | "delivery" | "receipt" | "decision";
  label: string;
  state: HandoffStepState;
  /** One sentence a clinician can act on. */
  said: string;
  /** The evidence time, or null where there is none. Null is never rendered as
   *  a time, which is the rule the escalation channel learned first. */
  at: string | null;
}

/** Is there a configured way to tell a clinician a transfer was proposed?
 *
 *  False for this build, and a named constant rather than an environment
 *  variable for the same reason ESCALATION_CHANNEL_CONFIGURED is: a setting
 *  would let a deployment turn the claim on without the channel existing, which
 *  is the failure the notification-truth work removed. It flips when a channel
 *  exists AND can produce a receipt. */
export const HANDOFF_CHANNEL_CONFIGURED = false;

/**
 * The four steps, answered from what is on the record.
 *
 * NOT ONE STATUS STRING. A single label has to pick which of the four facts to
 * report, and whichever it picks, a reader supplies the other three from
 * assumption — which is how "proposed" comes to mean "they know about it".
 */
export function handoffProgress(h: Handoff): HandoffStep[] {
  const proposal: HandoffStep = {
    step: "proposal",
    label: "Proposed",
    state: "done",
    said: `${h.fromName} proposed the transfer to ${h.toName}, with a reason on the record.`,
    at: h.createdAt,
  };

  const delivery: HandoffStep = HANDOFF_CHANNEL_CONFIGURED
    ? { step: "delivery", label: "Delivered", state: "not_recorded",
        said: "A channel exists and this proposal has no receipt from it.", at: null }
    : {
        step: "delivery",
        label: "Delivered",
        state: "not_possible",
        said:
          `Nothing was sent. There is no delivery path in this build, so ${h.toName} finds ` +
          "this by opening Steady rather than by being told.",
        at: null,
      };

  const receipt: HandoffStep = {
    step: "receipt",
    label: "Seen by the receiver",
    state: "not_recorded",
    said:
      `Steady does not record when a proposal is read, so whether ${h.toName} has seen this ` +
      "is unknown. An unanswered proposal is not evidence that they have.",
    at: null,
  };

  const decision: HandoffStep =
    h.state === "accepted"
      ? { step: "decision", label: "Accepted", state: "done",
          said: `${h.toName} accepted and is accountable for ${h.personName} from that point.`,
          at: h.decidedAt }
      : h.state === "declined"
      ? { step: "decision", label: "Declined", state: "refused",
          said: `${h.toName} declined. ${h.fromName} is still accountable.`, at: h.decidedAt }
      : h.state === "withdrawn"
      ? { step: "decision", label: "Withdrawn", state: "refused",
          said: `${h.fromName} withdrew it. Accountability never moved.`, at: h.decidedAt }
      : { step: "decision", label: "Decision", state: "pending",
          said: `Waiting on ${h.toName}. ${h.fromName} is accountable for ${h.personName} until it is accepted.`,
          at: null };

  return [proposal, delivery, receipt, decision];
}

export type HandoffOutcome =
  | { ok: true; id: string; note: string }
  | { ok: false; reason: string };

/**
 * Propose a transfer.
 *
 * REFUSES RATHER THAN DEGRADES. Each branch is a case where recording
 * something would put a transfer in the record that nobody could act on.
 */
export async function proposeHandoff(args: {
  tenantId: string;
  personId: string;
  fromClinicianId: string;
  toClinicianId: string;
  reason: string;
  dueAt?: string | null;
}): Promise<HandoffOutcome> {
  const reason = args.reason.trim();
  if (reason.length < MIN_REASON) {
    return {
      ok: false,
      reason:
        "Say why you are transferring this person, in a sentence. The receiving clinician " +
        "reads this before they decide, and a transfer with no reason is one they cannot act on.",
    };
  }
  if (args.toClinicianId === args.fromClinicianId) {
    return { ok: false, reason: "You already hold this person. Choose somebody else." };
  }

  const db = getDb();

  // TENANT-SCOPED ON BOTH ENDS AND THE SUBJECT. A handoff names three people,
  // and any one of them being outside the acting tenant is a cross-tenant
  // disclosure wearing a workflow's clothes: the reason field alone would tell
  // an outside clinician why somebody they may not see is being transferred.
  const inTenant = (id: string): boolean =>
    Boolean(db.prepare("SELECT 1 FROM users WHERE id = ? AND tenant_id = ?").get(id, args.tenantId));
  if (!inTenant(args.personId) || !inTenant(args.toClinicianId) || !inTenant(args.fromClinicianId)) {
    // Absent rather than forbidden: "not permitted" confirms the id exists.
    return { ok: false, reason: "That person is not on your caseload." };
  }

  // ONE OPEN PROPOSAL PER PERSON PER PAIR. Two open transfers of the same
  // person is a state where accepting either leaves the other dangling, and a
  // screen showing both is showing two answers to one question.
  const open = db
    .prepare(
      "SELECT id FROM care_handoffs WHERE person_id = ? AND state = 'proposed' AND tenant_id = ?"
    )
    .get(args.personId, args.tenantId) as { id: string } | undefined;
  if (open) {
    return {
      ok: false,
      reason:
        "A transfer of this person is already waiting for an answer. Withdraw it before " +
        "proposing another — two open transfers of one person is a state nobody can resolve.",
    };
  }

  const id = newId();
  db.prepare(
    `INSERT INTO care_handoffs
       (id, tenant_id, person_id, from_clinician_id, to_clinician_id, reason, due_at, state)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed')`
  ).run(id, args.tenantId, args.personId, args.fromClinicianId, args.toClinicianId,
        reason, args.dueAt ?? null);

  await appendEventSafe({
    personId: args.personId,
    tenantId: args.tenantId,
    type: "care_handoff.proposed",
    actorType: "clinician",
    actorId: args.fromClinicianId,
    payload: { handoffId: id, to: args.toClinicianId, dueAt: args.dueAt ?? null },
  });
  await audit({
    actorId: args.fromClinicianId, actorRole: "clinician", family: "clinical",
    type: "care_handoff_proposed", target: args.personId,
    detail: { handoffId: id, to: args.toClinicianId },
  });

  return {
    ok: true,
    id,
    // SAYS WHAT DID NOT HAPPEN. There is no delivery path, so a "sent" that
    // implied somebody was told would be the notification-truth defect with a
    // workflow attached.
    note:
      "Transfer proposed. Nobody has been notified — there is no delivery path in this " +
      "build — and YOU ARE STILL ACCOUNTABLE for this person until it is accepted.",
  };
}

/**
 * Answer a proposal, or withdraw your own.
 *
 * ONE FUNCTION FOR THREE OUTCOMES because they are one decision, and splitting
 * them would let a caller resolve a handoff into a state the others do not
 * know about. Who may do what is enforced here rather than by the screen: a
 * receiver accepts or declines, a sender withdraws, and neither can do the
 * other's half.
 */
export async function resolveHandoff(args: {
  handoffId: string;
  actorId: string;
  tenantId: string;
  outcome: "accepted" | "declined" | "withdrawn";
  note?: string;
}): Promise<HandoffOutcome> {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, person_id, from_clinician_id, to_clinician_id, state
         FROM care_handoffs WHERE id = ? AND tenant_id = ?`
    )
    .get(args.handoffId, args.tenantId) as
    | { id: string; person_id: string; from_clinician_id: string; to_clinician_id: string; state: string }
    | undefined;
  if (!row) return { ok: false, reason: "That transfer no longer exists." };

  if (row.state !== "proposed") {
    return {
      ok: false,
      reason: `That transfer was already ${row.state}. It cannot be answered twice.`,
    };
  }

  const isReceiver = args.actorId === row.to_clinician_id;
  const isSender = args.actorId === row.from_clinician_id;
  if (args.outcome === "withdrawn" && !isSender) {
    return { ok: false, reason: "Only the clinician who proposed a transfer can withdraw it." };
  }
  if (args.outcome !== "withdrawn" && !isReceiver) {
    return { ok: false, reason: "Only the clinician a transfer was sent to can answer it." };
  }

  // A DECLINE NEEDS A REASON and an accept does not, which is not an
  // inconsistency. Accepting says "I have them" and the state carries that;
  // declining sends a person back to somebody who now has to decide what to do
  // instead, and "no" with nothing after it is what makes that hard.
  const note = (args.note ?? "").trim();
  if (args.outcome === "declined" && note.length < MIN_REASON) {
    return {
      ok: false,
      reason:
        "Say why, in a sentence. Declining sends this person back to the clinician who asked, " +
        "and they have to decide what to do instead.",
    };
  }

  db.prepare(
    `UPDATE care_handoffs
        SET state = ?, decided_at = CURRENT_TIMESTAMP, decided_note = ?
      WHERE id = ? AND state = 'proposed'`
  ).run(args.outcome, note || null, args.handoffId);

  await appendEventSafe({
    personId: row.person_id,
    tenantId: args.tenantId,
    type: "care_handoff.resolved",
    actorType: "clinician",
    actorId: args.actorId,
    payload: {
      handoffId: args.handoffId,
      outcome: args.outcome,
      from: row.from_clinician_id,
      to: row.to_clinician_id,
    },
  });
  await audit({
    actorId: args.actorId, actorRole: "clinician", family: "clinical",
    type: "care_handoff_resolved", target: row.person_id,
    detail: { handoffId: args.handoffId, outcome: args.outcome },
  });

  const said: Record<typeof args.outcome, string> = {
    accepted: "Transfer accepted. You are accountable for this person from now.",
    declined:
      "Transfer declined, with your reason recorded. The clinician who proposed it is still " +
      "accountable — nobody has been notified, so tell them.",
    withdrawn:
      "Transfer withdrawn. You are still accountable for this person, which you were " +
      "throughout — accountability never moved.",
  };
  return { ok: true, id: args.handoffId, note: said[args.outcome] };
}
