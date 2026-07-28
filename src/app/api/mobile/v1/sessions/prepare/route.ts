import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

// POST /api/mobile/v1/sessions/prepare { moduleId } → { ok }
// Prepare-for-session on-ramp (F4): content-free audit so hard-stop rate of
// prepared vs unprepared sessions is measurable. Parity with recordSessionPrepare.
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  let b: { moduleId?: string };
  try { b = await req.json(); } catch { return error("Invalid JSON body.", 400); }
  if (!b.moduleId) return error("moduleId is required.", 400);
  await audit({
    actorId: auth.id, actorRole: "member", family: "module_runtime",
    type: "session_prepared", target: b.moduleId, detail: { via: "mobile" },
  });
  return json({ ok: true });
}
