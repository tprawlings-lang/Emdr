import { NextRequest, NextResponse } from "next/server";
import { requireMember, json } from "@/lib/mobile/http";
import { getAutopilotPlan } from "@/lib/autopilot";

export const runtime = "nodejs";

// GET /api/mobile/v1/autopilot/today → { plan: AutopilotPlan | null }
// null = not a Premium member (or no active membership).
export async function GET(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  return json({ plan: await getAutopilotPlan(auth.id) });
}
