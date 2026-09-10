import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { recordReview } from "@/lib/planning/service";
import { readableSignalTenants } from "@/lib/planning/scope";
import { BLOCKED_ACTION_REASONS, isBlockedAction } from "@/lib/planning/lifecycle";

// POST /api/planning/signals/:id/review — p47: "Record state and comments.
// Primary guard: named reviewer and transition rule."
//
// The action posted by the client is CHECKED, not trusted. p49's rule is that
// the server supplies `allowed_actions` and the client never invents or widens
// the set, and the only way to mean that is to re-derive the set here from the
// signal's own state and the caller's own role — which `recordReview` does,
// through the same function that produced the list the client was shown.
//
// A BLOCKED action gets its own status and its own audit family. "You cannot
// do that from this state" and "this system does not route people" are
// different answers: the first may change when the signal moves, and the
// second never will.

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();
  const tenants = readableSignalTenants(user.role);

  let body: { action?: string; comment?: string; limits?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "expected a JSON body with an action" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  if (!action) return NextResponse.json({ error: "action is required" }, { status: 400 });

  if (tenants.length === 0) {
    // Answered before the signal is looked up, so a role without planning
    // access cannot learn which signal ids are real.
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const result = await recordReview({
    signalId: id,
    tenantIds: tenants,
    actorId: user.id,
    role: user.role,
    action,
    comment: body.comment ?? null,
    limits: body.limits ?? null,
  });

  if (result.ok) return NextResponse.json({ ok: true, from: result.from, to: result.to });

  if (result.reason === "not_found") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (result.reason === "blocked") {
    return NextResponse.json({
      error: result.detail,
      blocked_action: action,
      reason: isBlockedAction(action) ? BLOCKED_ACTION_REASONS[action] : undefined,
    }, { status: 403 });
  }
  return NextResponse.json({ error: result.detail }, { status: 409 });
}
