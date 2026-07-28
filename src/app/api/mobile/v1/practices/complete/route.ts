import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { recordPracticeCompletion } from "@/lib/practices";

export const runtime = "nodejs";

// POST /api/mobile/v1/practices/complete { practiceId, durationSec } → { ok }
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  let b: { practiceId?: string; durationSec?: number };
  try { b = await req.json(); } catch { return error("Invalid JSON body.", 400); }
  if (!b.practiceId) return error("practiceId is required.", 400);
  const r = await recordPracticeCompletion(auth.id, b.practiceId, Number(b.durationSec ?? 0));
  if (!r.ok) return error("Unknown practice.", 404);
  return json({ ok: true });
}
