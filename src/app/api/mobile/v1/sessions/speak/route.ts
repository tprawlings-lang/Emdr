import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { speakInSession } from "@/lib/mobile/voice";

export const runtime = "nodejs";

// POST { sessionId, moduleId, transcript, currentSuds?, calmPlace?, name? }
//   → { ok, response?: { text, kind, suggestGroundMe, crisis, ... } }  | { ok:false, error }
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  let b: {
    sessionId?: string; moduleId?: string; transcript?: string;
    currentSuds?: number | null; calmPlace?: string | null; name?: string | null;
  };
  try { b = await req.json(); } catch { return error("Invalid JSON body.", 400); }
  if (!b.sessionId || !b.moduleId) return error("sessionId and moduleId are required.", 400);

  const result = await speakInSession(auth.id, {
    sessionId: b.sessionId, moduleId: b.moduleId,
    transcript: String(b.transcript ?? ""),
    currentSuds: b.currentSuds ?? null,
    calmPlace: b.calmPlace ?? null,
    name: b.name ?? null,
  });
  return json(result);
}
