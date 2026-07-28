import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { finishSessionMobile } from "@/lib/mobile/service";

export const runtime = "nodejs";

type Outcome = "completed" | "hard_stop" | "abandoned";
const OUTCOMES: Outcome[] = ["completed", "hard_stop", "abandoned"];

// POST /api/mobile/v1/sessions/finish
//   { sessionId, outcome, preSuds, postSuds, peakSuds, hardStopReason?, sudsTrail }
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  let b: {
    sessionId?: string; outcome?: string;
    preSuds?: number | null; postSuds?: number | null; peakSuds?: number | null;
    hardStopReason?: string | null; sudsTrail?: number[];
  };
  try { b = await req.json(); } catch { return error("Invalid JSON body.", 400); }

  if (!b.sessionId) return error("sessionId is required.", 400);
  if (!b.outcome || !OUTCOMES.includes(b.outcome as Outcome)) return error("Invalid outcome.", 400);

  const trail = Array.isArray(b.sudsTrail) ? b.sudsTrail.map(Number).filter(Number.isFinite) : [];
  const result = await finishSessionMobile(auth.id, {
    sessionId: b.sessionId,
    outcome: b.outcome as Outcome,
    preSuds: numOrNull(b.preSuds),
    postSuds: numOrNull(b.postSuds),
    peakSuds: numOrNull(b.peakSuds),
    hardStopReason: b.hardStopReason ?? null,
    sudsTrail: trail,
  });
  if (!result.ok) return error("Session not found.", 404);
  return json({ ok: true });
}

function numOrNull(n: unknown): number | null {
  if (n === null || n === undefined) return null;
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}
