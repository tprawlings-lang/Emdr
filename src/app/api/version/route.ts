import { NextResponse } from "next/server";

import { versionReport } from "@/lib/version";

// Which build is answering this request.
//
// DELIBERATELY UNAUTHENTICATED, and that is the whole point: the question
// "did the thing I merged actually deploy" has to be answerable from outside,
// before anyone can sign in, and without spending a login attempt. Trying to
// answer it by signing in was how a demo account got locked out for a day.
//
// It carries no secret and no member data — a commit, a branch, two versions
// and two booleans. The commit of a private repository is not a credential,
// and every other value here is already visible on the pages themselves.

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(versionReport(), {
    // NEVER CACHED. A cached answer to "what is running right now" is the one
    // kind of wrong this endpoint cannot afford: it would report the previous
    // deployment with complete confidence.
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
