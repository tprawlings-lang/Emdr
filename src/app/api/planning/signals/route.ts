import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { listSignals } from "@/lib/planning/service";
import { readableSignalTenants } from "@/lib/planning/scope";
import { REQUIRED_PHRASE } from "@/lib/planning/signal";

// GET /api/planning/signals — p47: "List aggregate planning signals.
// Primary guard: role-safe aggregate access."
//
// Role-safe here means two things, and both are checked on the server. The
// scope is derived from the caller's own role rather than from a parameter, so
// there is nothing to widen; and every signal carries the `allowed_actions`
// computed for THAT caller, because p49 puts the action set on the server side
// of the boundary.
//
// The response is aggregate by construction — a planning signal is about a
// cohort and has no person in it — so there is no filtering step here to get
// wrong.

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  const tenants = readableSignalTenants(user.role);
  if (tenants.length === 0) {
    // Not 403. A role without planning access learns that the endpoint exists
    // and nothing about what is in it, which is the same answer the console
    // gives by not linking to it.
    return NextResponse.json({ signals: [], required_phrase: REQUIRED_PHRASE });
  }
  const signals = await listSignals(tenants, user.role);
  await audit({
    actorId: user.id, actorRole: user.role, family: "security",
    type: "planning_signals_listed", target: null,
    detail: { count: signals.length },
  });
  return NextResponse.json({ signals, required_phrase: REQUIRED_PHRASE });
}
