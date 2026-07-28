import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { measuresInfo, submitMeasureMobile } from "@/lib/mobile/onboarding";

export const runtime = "nodejs";

// GET → { instruments, completed }  (the 5 baseline instruments + item banks)
export async function GET(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  return json(await measuresInfo(auth.id));
}

// POST { instrument, answers: number[] } → { total, positive, riskFlags, crisis }
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  let b: { instrument?: string; answers?: number[] };
  try { b = await req.json(); } catch { return error("Invalid JSON body.", 400); }
  if (!b.instrument) return error("instrument is required.", 400);
  const answers = Array.isArray(b.answers) ? b.answers.map(Number) : [];
  const result = await submitMeasureMobile(auth.id, b.instrument, answers);
  if ("error" in result) return error(result.error, 400);
  return json(result);
}
