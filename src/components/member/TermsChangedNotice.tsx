import Link from "next/link";

import { termsState } from "@/lib/enrollment/pilot-terms";

// The one pointer a participant on the old notice sees.
//
// AN OFFER, NOT A NAG, and the difference is enforced here rather than
// promised: it renders once on Today, it never blocks anything, and it
// disappears the moment they decide — either way. Somebody who said no does
// not see it again, because a question that keeps returning until it gets the
// right answer is not a question.
//
// It says what changed in one line rather than summarising the whole notice.
// The full wording lives on /app/terms, where they can read the thing itself
// instead of a description of it.

export async function TermsChangedNotice({ userId }: { userId: string }) {
  const state = await termsState(userId);
  // "current" needs nothing. "declined" needs nothing EVER AGAIN — that is the
  // whole point of recording a refusal rather than an absence. And a
  // fabricated demo persona is not a participant at all: before that state
  // existed, this panel told Alex the pilot had changed since he joined.
  if (state === "current" || state === "declined" || state === "not_participant") return null;

  return (
    <div className="mb-6 rounded-3xl border border-ground/15 bg-app-surface p-5">
      <p className="font-medium text-app-ink">The pilot has changed since you joined</p>
      <p className="measure mt-1 text-sm text-olive">
        A clinician can now write notes about you, and what you type can be sent to another
        company to answer you. You agreed to something narrower, so nothing of that applies to
        you until you say it can.
      </p>
      <p className="mt-3 text-sm">
        <Link href="/app/terms" className="font-medium text-app-ink underline">
          Read what changed
        </Link>{" "}
        <span className="text-olive">&mdash; saying no is fine and costs you nothing.</span>
      </p>
    </div>
  );
}
