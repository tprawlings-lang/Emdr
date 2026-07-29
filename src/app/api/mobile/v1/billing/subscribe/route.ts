import { NextRequest, NextResponse } from "next/server";
import { requireMember, json } from "@/lib/mobile/http";
import { subscribeMobile } from "@/lib/mobile/onboarding";

export const runtime = "nodejs";

// POST /api/mobile/v1/billing/subscribe { plan? } → { active }
// Demo billing provider (7-day Premium trial, then the chosen tier — base |
// plus | premium, defaulting to premium), matching the web's startSubscription.
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  let plan: string | undefined;
  try {
    const body = await req.json();
    if (typeof body?.plan === "string") plan = body.plan;
  } catch {
    // no body — default plan
  }
  return json(await subscribeMobile(auth.id, plan));
}
