"use server";

import { redirect } from "next/navigation";

import { audit } from "../audit";
import { data } from "../data";
import { newId } from "../db";
import { requireMember, requireDemoAdmin } from "../auth";
import { grantConsent as spineGrantConsent } from "../spine";
import {
  PILOT_ACK_SCOPE, PILOT_DECLINE_SCOPE, PILOT_TERMS_V2, pilotHandling,
} from "./pilot-terms";

// Accepting, declining, and recording that somebody accepted offline.
//
// THREE DOORS TO ONE FACT, and they are not interchangeable. A participant
// ticking the notice themselves, a participant refusing it, and an operator
// writing down a conversation are three different events, and the audit says
// which — because "who agreed to what, and how do we know" is the only
// question this whole mechanism exists to answer. A consent record that
// cannot distinguish "she ticked it" from "he says she said yes" is not
// evidence of anything.

/** The version row, written the same way by every door. */
async function recordAcceptance(userId: string) {
  await spineGrantConsent({
    userId,
    policyVersion: PILOT_TERMS_V2,
    scope: PILOT_ACK_SCOPE,
  });
}

export async function acceptCurrentTermsAction(): Promise<void> {
  const member = await requireMember();
  await recordAcceptance(member.id);
  await audit({
    actorId: member.id,
    actorRole: "member",
    family: "consent",
    type: "pilot_terms_accepted",
    target: PILOT_TERMS_V2,
    // BY THE PERSON THEMSELVES. The operator path below says something else,
    // and a reviewer must be able to tell them apart without asking anybody.
    detail: { via: "participant" },
  });
  redirect("/app/terms");
}

export async function declineCurrentTermsAction(): Promise<void> {
  const member = await requireMember();
  const c = await data();
  // RECORDED, not merely "not accepted". A refusal that leaves no trace is
  // indistinguishable from never having been asked, which means the operator
  // asks again, and again — and a question that keeps returning until it gets
  // the right answer is not a question.
  await c.run(
    `INSERT INTO consents (id, user_id, policy_version, scope) VALUES (?, ?, ?, ?)`,
    [newId(), member.id, PILOT_TERMS_V2, PILOT_DECLINE_SCOPE],
  );
  await audit({
    actorId: member.id,
    actorRole: "member",
    family: "consent",
    type: "pilot_terms_declined",
    target: PILOT_TERMS_V2,
    detail: { via: "participant" },
  });
  redirect("/app/terms");
}

/**
 * The operator writing down a conversation that happened elsewhere.
 *
 * THIS IS THE WEAK LINK AND IT IS SUPPOSED TO LOOK LIKE ONE. There is no mail
 * channel here, so re-consent happens in person or by phone and somebody has
 * to record it — which means an operator can, in principle, record a consent
 * that never happened. Nothing in software prevents that. What software can do
 * is refuse to disguise it: the audit row names the operator, says the
 * participant was not present, and is as permanent as any other entry, so the
 * claim is attributable to a person rather than floating free.
 */
export async function recordOfflineAcceptanceAction(formData: FormData): Promise<void> {
  const operator = await requireDemoAdmin();
  const personId = String(formData.get("personId") ?? "");

  // Scope and idempotence in one, and it lives in the domain so a test can
  // reach it — see the note on `assertAwaitingCurrentTerms`.
  const { assertAwaitingCurrentTerms, PilotTermsError } = await import("./pilot-terms");
  try {
    await assertAwaitingCurrentTerms(personId);
  } catch (e) {
    if (e instanceof PilotTermsError) {
      redirect(`/admin/pilot?error=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }

  const before = await pilotHandling(personId);
  await recordAcceptance(personId);
  await audit({
    actorId: operator.id,
    actorRole: "demo_admin",
    family: "consent",
    type: "pilot_terms_accepted",
    target: PILOT_TERMS_V2,
    detail: { via: "operator", personId, previousVersion: before.version },
  });
  redirect(`/admin/pilot?done=${encodeURIComponent(
    "Recorded as accepted. The audit says you recorded it rather than that they ticked it.",
  )}`);
}
