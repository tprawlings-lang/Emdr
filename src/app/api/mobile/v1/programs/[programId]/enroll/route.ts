import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { enrollInProgram, ProgramRefused } from "@/lib/programs";

export const runtime = "nodejs";

// POST /api/mobile/v1/programs/:programId/enroll → { ok }
export async function POST(req: NextRequest, { params }: { params: Promise<{ programId: string }> }) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  const { programId } = await params;
  try {
    await enrollInProgram(auth.id, programId);
  } catch (e) {
    if (e instanceof ProgramRefused) return error("Not found.", 404);
    throw e;
  }
  return json({ ok: true });
}
