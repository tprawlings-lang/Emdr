import Link from "next/link";

import { requireMember } from "@/lib/auth";
import { MemberPage } from "@/components/member/MemberPage";
import { termsState } from "@/lib/enrollment/pilot-terms";
import { acceptCurrentTermsAction, declineCurrentTermsAction } from "@/lib/enrollment/terms-actions";

// What changed about the pilot, put to the person it changed for.
//
// THEY AGREED TO SOMETHING ELSE. The notice they ticked said their answers
// were not a medical record, that nobody would contact them because of what
// they entered, and that they were not shared. The pilot then gained a
// clinical workflow and three egress channels, and all three sentences stopped
// being true. Editing the signup page fixes what the next person agrees to and
// nothing about this one, so this screen exists to ask them again.
//
// IT IS AN ASK, NOT A GATE. Nothing here blocks the app, nothing nags, and
// declining costs them nothing — they carry on exactly as before, with the
// stricter handling applied on their behalf rather than as a penalty. A pilot
// where "no" means "you are out" is not consent, it is a toll.
//
// THE FULL WORDING, NOT A SUMMARY OF IT. A person being asked to agree again
// should read the thing rather than a description of the thing, so the changed
// clauses are here in full and the differences are named rather than left to
// be spotted.

export const dynamic = "force-dynamic";
export const metadata = { title: "What changed — Steady" };

export default async function TermsPage() {
  const member = await requireMember();
  const state = await termsState(member.id);

  if (state === "current") {
    return (
      <MemberPage layer="evidence" title="You're on the current terms"
        lede="Nothing needs your attention here.">
        <p className="measure text-sm text-app-ink">
          You&apos;ve already agreed to how the pilot works now. You can change your mind at any
          time by telling whoever gave you your access code.
        </p>
        <p className="mt-4 text-sm">
          <Link href="/app/today" className="underline">Back to Today</Link>
        </p>
      </MemberPage>
    );
  }

  return (
    <MemberPage
      layer="evidence"
      title="The pilot has changed. Here's what's different."
      lede="You agreed to something narrower when you signed up. We'd rather ask you again than assume."
    >
      <div className="space-y-6">
        <section className="rounded-3xl border border-ground/10 bg-app-surface p-5">
          <h2 className="font-medium text-app-ink">What you agreed to before</h2>
          <ul className="measure mt-2 list-disc space-y-1 pl-5 text-sm text-olive">
            <li>Your answers were pilot feedback and <strong>not a medical record</strong>.</li>
            <li><strong>Nobody would contact you</strong> because of what you entered.</li>
            <li>Your answers were <strong>not shared</strong>.</li>
          </ul>
        </section>

        <section className="rounded-3xl border border-ground/10 bg-app-surface p-5">
          <h2 className="font-medium text-app-ink">What is true now</h2>
          <ul className="measure mt-2 space-y-3 text-sm text-olive">
            <li>
              <span className="text-app-ink">A clinician may write notes about you.</span>{" "}
              Clinicians testing Steady can record notes, sign them, and make decisions about
              what you can open &mdash; the way they would in the real system. Those notes are
              about you, you did not write them, and a signed one cannot be edited afterwards.
              One of them may contact you about something you entered.
            </li>
            <li>
              <span className="text-app-ink">What you type leaves this website.</span> To answer
              you, the companion sends what you write to Anthropic, a separate company. Your
              data is also copied to off-site backup storage.
            </li>
            <li>
              <span className="text-app-ink">Still true:</span> this is a prototype and not care,
              nobody is watching in real time, and your answers are not shared with an insurer
              or an employer and are not sold.
            </li>
          </ul>
        </section>

        {state === "declined" && (
          // SAID BACK TO THEM. Somebody who already said no should see that it
          // was heard, not an unchanged form implying it was not.
          <p className="measure rounded-2xl border border-ground/15 bg-app-surface px-4 py-3 text-sm text-app-ink">
            You said no to this before, and that still stands. Nothing has been written about
            you and nothing of yours has been sent anywhere. You can change your mind here if
            you want to &mdash; there&apos;s no need to.
          </p>
        )}

        <section className="rounded-3xl border border-ground/10 bg-linen p-5">
          <h2 className="font-medium text-app-ink">If you say no</h2>
          <p className="measure mt-2 text-sm text-olive">
            You keep using Steady exactly as you do now. No clinician will write notes about
            you, and nothing you type will be sent to Anthropic or copied off-site. You stay in
            the pilot. Saying no costs you nothing and you do not have to give a reason.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <form action={acceptCurrentTermsAction}>
              <button className="rounded-full bg-sage px-6 py-3 font-medium text-ground transition-colors hover:bg-sage-deep">
                I agree to how it works now
              </button>
            </form>
            <form action={declineCurrentTermsAction}>
              <button className="rounded-full border border-ground/20 px-6 py-3 font-medium text-app-ink hover:bg-app-surface">
                No &mdash; keep things as they are
              </button>
            </form>
          </div>
        </section>

        <p className="text-sm">
          <Link href="/app/today" className="underline">Decide later</Link>{" "}
          <span className="text-olive">&mdash; nothing changes until you choose.</span>
        </p>
      </div>
    </MemberPage>
  );
}
