import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { startSessionMobile } from "@/lib/mobile/service";

export const runtime = "nodejs";

// POST /api/mobile/v1/sessions/start  { moduleId, focus? }
// → 200 { sessionId }  |  403 { error, action }  (gate not satisfied)
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  let b: { moduleId?: string; focus?: string };
  try { b = await req.json(); } catch { return error("Invalid JSON body.", 400); }
  if (!b.moduleId) return error("moduleId is required.", 400);

  const result = await startSessionMobile(auth.id, b.moduleId, b.focus);
  if (!result.ok) {
    return json({ error: result.reason, action: result.action }, 403);
  }
  return json({ sessionId: result.sessionId });
}
