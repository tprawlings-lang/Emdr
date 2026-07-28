import { NextRequest, NextResponse } from "next/server";
import { requireMember, json } from "@/lib/mobile/http";
import { listSessions } from "@/lib/mobile/service";

export const runtime = "nodejs";

// GET /api/mobile/v1/sessions?since=ISO → { sessions }
// Used for the cross-device history + distress trend.
export async function GET(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  const since = req.nextUrl.searchParams.get("since") ?? undefined;
  return json({ sessions: await listSessions(auth.id, since) });
}
