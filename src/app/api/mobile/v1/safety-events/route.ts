import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { logSafetyEventMobile } from "@/lib/mobile/service";

export const runtime = "nodejs";

// POST /api/mobile/v1/safety-events  { type, sessionId? }
// Telemetry parity with the web player: ground_me_pressed, suds_pause,
// session_time_cap, session_winddown_shown, etc. → the audit log the
// clinician dashboard reads.
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  let b: { type?: string; sessionId?: string };
  try { b = await req.json(); } catch { return error("Invalid JSON body.", 400); }
  if (!b.type) return error("type is required.", 400);
  await logSafetyEventMobile(auth.id, b.type, b.sessionId);
  return json({ ok: true });
}
