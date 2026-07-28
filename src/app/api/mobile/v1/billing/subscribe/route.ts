import { NextRequest, NextResponse } from "next/server";
import { requireMember, json } from "@/lib/mobile/http";
import { subscribeMobile } from "@/lib/mobile/onboarding";

export const runtime = "nodejs";

// POST /api/mobile/v1/billing/subscribe → { active }
// Demo billing provider (7-day trial), matching the web's startSubscription.
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  return json(await subscribeMobile(auth.id));
}
