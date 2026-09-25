import { NextRequest, NextResponse } from "next/server";
import { requireMember, json } from "@/lib/mobile/http";
import { memberPrograms } from "@/lib/programs";
import { programJson } from "@/lib/mobile/programs";

export const runtime = "nodejs";

// GET /api/mobile/v1/programs → { programs }
export async function GET(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  return json({ programs: (await memberPrograms(auth.id)).map(programJson) });
}
