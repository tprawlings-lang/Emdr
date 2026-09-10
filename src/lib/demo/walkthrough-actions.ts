"use server";

import { redirect } from "next/navigation";

import { setSessionCookie } from "../auth";
import { startWalkthrough } from "./walkthrough";

// The write path for the onboarding walkthrough.
//
// THIN, for the reason handoff-actions.ts is thin: every refusal — the wrong
// environment, the cap — lives in `walkthrough.ts`, so it refuses identically
// whether it is reached from this button, a test, or a script somebody writes
// next year. What is left here is the two things that are properties of the
// REQUEST: minting the session, and telling the browser where to go.
//
// THE REFUSAL REACHES THE SCREEN. Carried in the query string, like the
// governed export's and the handoff's, because a server action's redraw is a
// redirect and a returned value would not survive it.

export async function startWalkthroughAction(): Promise<void> {
  const outcome = await startWalkthrough();
  if (!outcome.ok) {
    redirect(`/login?refused=${encodeURIComponent(outcome.reason)}`);
  }
  await setSessionCookie(outcome.userId);
  // NO `revalidatePath` BEFORE THIS. Calling it and then redirecting drops the
  // query string — the same trap the handoff actions carry a note about.
  //
  // TO THE GATE'S OWN FIRST DESTINATION, which is `/app/onboarding`.
  //
  // The first version sent them to `/app/welcome`, and it rendered a blank
  // page. `/app/welcome` is not a gate destination, so the member layout runs
  // the four-step chain on it and redirects a member with no consent onward —
  // and a redirect issued by a server action INTO a route whose layout then
  // redirects again leaves the browser at the first URL with nothing in it. A
  // plain GET to the same address behaves correctly, which is what made it look
  // like a rendering fault rather than a routing one.
  //
  // So this names the destination the gate would have chosen anyway. The list
  // is `GATE_DESTINATIONS` in lib/member/care-gate.ts, and a route that is not
  // on it cannot be redirected to from here.
  redirect("/app/onboarding");
}
