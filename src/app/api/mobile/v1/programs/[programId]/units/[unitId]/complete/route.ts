import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { completeUnit, ProgramRefused } from "@/lib/programs";

export const runtime = "nodejs";

// POST /api/mobile/v1/programs/:programId/units/:unitId/complete → { ok }
// 409 { error: reason } when out of order, not joined, or not open today.
export async function POST(req: NextRequest, { params }: { params: Promise<{ programId: string; unitId: string }> }) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  const { programId, unitId } = await params;
  try {
    await completeUnit(auth.id, programId, unitId);
  } catch (e) {
    if (e instanceof ProgramRefused) return error(e.message, e.message === "absent" ? 404 : 409);
    throw e;
  }
  return json({ ok: true });
}
