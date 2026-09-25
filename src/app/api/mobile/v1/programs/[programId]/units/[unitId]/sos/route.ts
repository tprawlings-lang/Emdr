import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { ActivityRefused, answerSosQuestion } from "@/lib/program-activities";
import { ProgramRefused } from "@/lib/programs";

export const runtime = "nodejs";

// POST /api/mobile/v1/programs/:programId/units/:unitId/sos { add: boolean, practiceIds?: string[] }
//   → { added: string[] }   the skill names newly in the member's SOS plan
// Riding Strong Feelings' closing question (CV10_D05). Either answer completes
// the unit. 422 { error } when the choice is not the unit's; 409 when the unit
// is not open to this member now.
export async function POST(req: NextRequest, { params }: { params: Promise<{ programId: string; unitId: string }> }) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  const { programId, unitId } = await params;
  let b: { add?: unknown; practiceIds?: unknown };
  try { b = await req.json(); } catch { return error("Invalid JSON body.", 400); }
  const practiceIds = Array.isArray(b.practiceIds) ? b.practiceIds.filter((x): x is string => typeof x === "string") : [];
  try {
    return json(await answerSosQuestion(auth.id, programId, unitId, { add: b.add === true, practiceIds }));
  } catch (e) {
    if (e instanceof ActivityRefused) return json({ error: e.code }, 422);
    if (e instanceof ProgramRefused) return json({ error: e.message }, e.message === "absent" ? 404 : 409);
    throw e;
  }
}
