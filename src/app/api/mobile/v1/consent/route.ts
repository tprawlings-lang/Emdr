import { NextRequest, NextResponse } from "next/server";
import { requireMember, json } from "@/lib/mobile/http";
import { consentInfo, grantConsentMobile } from "@/lib/mobile/onboarding";

export const runtime = "nodejs";

// GET  → { version, sections }  (the informed-consent copy, versioned)
export async function GET(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  return json(consentInfo());
}

// POST → { ok }  (records care_program_full consent at the current version)
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  return json(await grantConsentMobile(auth.id));
}
