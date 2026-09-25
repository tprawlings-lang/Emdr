import { NextRequest, NextResponse } from "next/server";
import { requireMember, json } from "@/lib/mobile/http";
import { leaveProgram } from "@/lib/programs";

export const runtime = "nodejs";

// POST /api/mobile/v1/programs/:programId/leave → { ok }. What was done stays.
export async function POST(req: NextRequest, { params }: { params: Promise<{ programId: string }> }) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  const { programId } = await params;
  await leaveProgram(auth.id, programId);
  return json({ ok: true });
}
