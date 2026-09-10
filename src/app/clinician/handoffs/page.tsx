import Link from "next/link";

import { ClinicianPage } from "@/components/clinical/ClinicianPage";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import { EmptyState } from "@/components/clinical/primitives";
import { handoffsFor, isOpen, MIN_REASON, type Handoff } from "@/lib/clinical/handoff";
import { proposeHandoffAction, resolveHandoffAction } from "@/lib/clinical/handoff-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Handoffs — Steady Clinical" };

// Handoffs (§26: "Keep accountability through transfer").
//
// THIS SCREEN USED TO REFUSE, and the refusal named its own requirement: "a
// handoff — from, to, reason, due, accepted — is not modelled, so there is
// nothing to list… until then this screen would be inferring accountability
// from ownership, and that inference is exactly how people get lost between
// clinicians."
//
// It is built now, and the inference is still not made. A work item's owner is
// something one clinician decides; accountability is something the other
// accepts. The two are different facts and this screen only ever shows the
// second — `accountableClinicianId` is asked rather than `to_clinician_id`
// read, so an unanswered proposal never displays as a completed transfer.
//
// WAITING IS THE LOUDEST STATE ON THE PAGE, above everything else and stated in
// the second person. A transfer nobody answered is the failure mode this screen
// exists to make visible: the sender believes they have handed over, the
// receiver has not looked, and the person belongs to nobody in practice while
// belonging to somebody in the record.
//
// AND NOBODY IS NOTIFIED. There is no delivery path in this build, so a
// proposal sits until the receiver opens this page. Said in those words on
// every state rather than letting a "sent" imply a person was told — the same
// rule the escalation channel and the assignment action already follow.

export default async function HandoffsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; refused?: string }>;
}) {
  const { done, refused } = await searchParams;
  const clinician = await requireClinician();
  const c = await data();
  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? PLATFORM_TENANT_ID;

  const all = handoffsFor({ clinicianId: clinician.id, tenantId });
  const incoming = all.filter((h) => isOpen(h.state) && h.toClinicianId === clinician.id);
  const outgoing = all.filter((h) => isOpen(h.state) && h.fromClinicianId === clinician.id);
  const settled = all.filter((h) => !isOpen(h.state));

  // A RECIPIENT MUST BE ABLE TO ANSWER, which is what makes this list different
  // from the assignee list on the queue. Assignment goes to a PERSON — owning a
  // piece of work has never required an account — but a handoff is only a
  // handoff once somebody accepts it, so proposing one to a person who cannot
  // sign in would create a transfer that can never be resolved and would sit
  // in "waiting" forever.
  const recipients = (await c.all(
    `SELECT id, name FROM users
      WHERE tenant_id = ? AND role = 'clinician' AND id != ?
      ORDER BY name LIMIT 24`,
    [tenantId, clinician.id]
  )) as Array<{ id: string; name: string }>;

  // The caseload to transfer FROM. Scoped to the tenant, which is this
  // product's care relationship — the same rule the person record follows.
  const people = (await c.all(
    `SELECT id, name FROM users
      WHERE tenant_id = ? AND role = 'member'
      ORDER BY name LIMIT 60`,
    [tenantId]
  )) as Array<{ id: string; name: string }>;

  return (
    <ClinicianPage
      layer="actions"
      here="/clinician/handoffs"
      title="Handoffs"
      lede="Transfer of accountability: proposed by you, accepted by them, and nobody is accountable twice."
    >
      {/* WHAT JUST HAPPENED, said before anything else. The domain refuses
          carefully — a reason too short to act on, a transfer to yourself, a
          second open proposal for one person — and the first version of this
          screen discarded every one of those refusals. A clinician who typed
          "handover" saw a page redraw with nothing on it, which is a worse
          failure than the one being prevented: they would reasonably conclude
          the transfer had gone through. */}
      {refused && (
        <p role="alert" className="measure mt-1 rounded-2xl border border-state-caution/60 bg-state-caution-bg/50 px-4 py-3 text-sm text-ground">
          <strong>Not done.</strong> {refused}
        </p>
      )}
      {done && (
        <p role="status" className="measure mt-1 rounded-2xl border border-state-safe/50 bg-state-safe-bg/40 px-4 py-3 text-sm text-ground">
          {done}
        </p>
      )}

      <p className="measure mt-3 rounded-2xl border border-ground/15 bg-linen px-4 py-3 text-sm text-ground">
        <strong>A transfer moves accountability only when it is accepted.</strong> Until then
        the clinician who proposed it still holds the person. Nobody is notified when you
        propose or answer one — there is no delivery path in this build, so tell them.
      </p>

      {/* WAITING FOR YOU FIRST. It is the only section that asks the reader to
          do something, and burying it under a form would be the screen
          disagreeing with its own priority. */}
      <section aria-labelledby="incoming" className="mt-8">
        <h2 id="incoming" className="text-xs font-semibold uppercase tracking-wide text-olive">
          Waiting for your answer
        </h2>
        {incoming.length === 0 ? (
          <div className="mt-3">
            {/* CLEAR, not merely empty. §14: an empty list because there is
                nothing to do and an empty list because something failed must
                not look the same. Nobody waiting on you is good news, and this
                is the one section where that distinction changes what a
                clinician does next. */}
            <EmptyState
              kind="clear"
              title="Nobody is waiting on you"
              detail="No clinician has asked you to take over a person."
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {incoming.map((h) => (
              <li key={h.id} className="rounded-3xl border border-state-caution/50 bg-state-caution-bg/40 p-5">
                <HandoffFacts h={h} />
                <p className="measure mt-2 text-sm text-ground">
                  <strong>{h.fromName}</strong> is accountable for {h.personName} until you
                  accept. Declining sends them back with your reason.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <form action={resolveHandoffAction} className="space-y-2">
                    <input type="hidden" name="handoffId" value={h.id} />
                    <input type="hidden" name="outcome" value="accepted" />
                    <button className="w-full rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-app-surface hover:opacity-90">
                      Accept — I am accountable
                    </button>
                  </form>
                  <form action={resolveHandoffAction} className="space-y-2">
                    <input type="hidden" name="handoffId" value={h.id} />
                    <input type="hidden" name="outcome" value="declined" />
                    {/* A DECLINE NEEDS A REASON and an accept does not.
                        Accepting says "I have them" and the state carries it;
                        declining sends a person back to somebody who now has to
                        decide what to do instead. */}
                    <input
                      name="note"
                      required
                      minLength={MIN_REASON}
                      placeholder="Why you cannot take this person"
                      className="w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
                    />
                    <button className="w-full rounded-full border border-ground/25 px-4 py-2 text-sm font-medium text-ground hover:bg-ground/5">
                      Decline
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="outgoing" className="mt-8">
        <h2 id="outgoing" className="text-xs font-semibold uppercase tracking-wide text-olive">
          Waiting for somebody else
        </h2>
        {outgoing.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              kind="clear"
              title="You are not waiting on anybody"
              detail="You have no transfers out for an answer, so nobody else is holding a decision about your caseload."
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {outgoing.map((h) => (
              <li key={h.id} className="rounded-3xl border border-ground/10 bg-linen p-5">
                <HandoffFacts h={h} />
                <p className="measure mt-2 text-sm text-ground">
                  <strong>You are still accountable for {h.personName}.</strong>{" "}
                  {h.toName} has not answered, and has not been told — this build has no way
                  to tell them.
                </p>
                <form action={resolveHandoffAction} className="mt-3">
                  <input type="hidden" name="handoffId" value={h.id} />
                  <input type="hidden" name="outcome" value="withdrawn" />
                  <button className="rounded-full border border-ground/25 px-4 py-2 text-sm font-medium text-ground hover:bg-ground/5">
                    Withdraw
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="propose" className="mt-8">
        <h2 id="propose" className="text-xs font-semibold uppercase tracking-wide text-olive">
          Propose a transfer
        </h2>
        {recipients.length === 0 ? (
          <div className="mt-3 rounded-3xl border border-ground/10 bg-linen p-5">
            <p className="measure text-sm text-ground">
              There is no other clinician in this organization to transfer to. A transfer needs
              somebody who can accept it — proposing one to an account that cannot sign in would
              create a transfer nobody can ever answer.
            </p>
          </div>
        ) : (
          <form action={proposeHandoffAction} className="mt-3 space-y-3 rounded-3xl border border-ground/10 bg-linen p-5">
            <label className="block text-sm">
              <span className="font-medium text-app-ink">Person</span>
              <select
                name="personId"
                required
                className="mt-1 w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
              >
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-app-ink">Transfer to</span>
              <select
                name="toClinicianId"
                required
                className="mt-1 w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
              >
                {recipients.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-app-ink">Why</span>
              <input
                name="reason"
                required
                minLength={MIN_REASON}
                placeholder="Going on leave from the 14th; she has a session booked that week"
                className="mt-1 w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-olive">
                The receiving clinician reads this before they decide. A transfer with no
                reason is one they cannot act on.
              </span>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-app-ink">Answer needed by (optional)</span>
              <input
                type="date"
                name="dueAt"
                className="mt-1 w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-olive">
                Left blank when there is no deadline. An invented one is worse than none.
              </span>
            </label>
            <button className="rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-app-ink hover:opacity-90">
              Propose the transfer
            </button>
          </form>
        )}
      </section>

      <section aria-labelledby="settled" className="mt-8">
        <h2 id="settled" className="text-xs font-semibold uppercase tracking-wide text-olive">
          Answered
        </h2>
        {settled.length === 0 ? (
          <div className="mt-3">
            {/* NOT "clear". An empty history is not good news, it is an
                absence of history — and dressing it as good news would tell a
                clinician their transfers had all resolved. */}
            <EmptyState
              kind="not_due"
              title="No transfer has been answered yet"
              detail="Accepted, declined and withdrawn transfers stay listed here. A withdrawn one is kept rather than deleted: asking and thinking better of it is part of the record of who was looking after somebody."
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {settled.map((h) => (
              <li key={h.id} className="rounded-2xl border border-ground/10 bg-app-surface px-4 py-3 text-sm">
                <HandoffFacts h={h} />
                <p className="measure mt-1 text-sm text-olive">
                  {/* A WITHDRAWN TRANSFER IS KEPT, not deleted. "I asked and
                      thought better of it" is part of the record of who was
                      looking after somebody. */}
                  {h.state} {h.decidedAt}
                  {h.decidedNote ? ` — “${h.decidedNote}”` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="measure mt-8 text-sm text-olive">
        A transfer is recorded against the person as well as here — it appears on their{" "}
        <Link href="/clinician/patients" className="underline">record</Link> and in the audit
        trail, so accountability can be reconstructed later rather than remembered.
      </p>
    </ClinicianPage>
  );
}

/** The five facts §26 asks a handoff to carry: from, to, reason, due, and what
 *  happened to it. One component so the four sections cannot describe the same
 *  transfer differently. */
function HandoffFacts({ h }: { h: Handoff }) {
  return (
    <>
      <p className="text-sm font-medium text-app-ink">{h.personName}</p>
      <p className="mt-0.5 text-xs text-olive">
        {h.fromName} → {h.toName} · proposed {h.createdAt}
        {h.dueAt ? ` · answer needed by ${h.dueAt}` : " · no deadline given"}
      </p>
      <p className="measure mt-1 text-sm text-ground">“{h.reason}”</p>
    </>
  );
}
