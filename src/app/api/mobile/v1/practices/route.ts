import { NextRequest, NextResponse } from "next/server";
import { requireMember, json } from "@/lib/mobile/http";
import { listPractices, type PracticeType } from "@/lib/practices";

export const runtime = "nodejs";

const TYPES: PracticeType[] = ["breathwork", "meditation", "movement", "sleep", "soundscape"];

// GET /api/mobile/v1/practices?type=breathwork → { practices }
// Safety-ordered for the member's day (gentler/no-hold first on elevated days).
export async function GET(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  const raw = req.nextUrl.searchParams.get("type");
  const type = TYPES.includes(raw as PracticeType) ? (raw as PracticeType) : undefined;
  return json({ practices: await listPractices(auth.id, type) });
}
