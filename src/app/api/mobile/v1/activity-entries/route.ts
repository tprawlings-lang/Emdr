import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { ActivityRefused, saveActivityEntry, type ActivityPayload } from "@/lib/program-activities";
import { ProgramRefused } from "@/lib/programs";

export const runtime = "nodejs";

// POST /api/mobile/v1/activity-entries { programId, unitId, payload } → 201 { id }
//   409 { crisis: true }  the crisis pre-filter matched; NOTHING was saved and
//                         the client must open the crisis screen (§3.4)
//   422 { error: code }   not what the unit offers today
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  let b: { programId?: string; unitId?: string; payload?: ActivityPayload };
  try { b = await req.json(); } catch { return error("Invalid JSON body.", 400); }
  if (!b.programId || !b.unitId || !b.payload || typeof b.payload !== "object") return error("programId, unitId and payload are required.", 400);
  try {
    const r = await saveActivityEntry(auth.id, String(b.programId), String(b.unitId), b.payload);
    if (!r.ok) return json({ crisis: true }, 409);
    return json({ id: r.id }, 201);
  } catch (e) {
    if (e instanceof ActivityRefused) return json({ error: e.code }, 422);
    if (e instanceof ProgramRefused) return json({ error: e.message }, e.message === "absent" ? 404 : 409);
    throw e;
  }
}
