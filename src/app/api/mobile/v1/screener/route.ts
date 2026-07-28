import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { screenerInfo, submitScreenerMobile } from "@/lib/mobile/onboarding";

export const runtime = "nodejs";

// GET → { version, items }  (the 8-item program-fit screener)
export async function GET(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  return json(screenerInfo());
}

// POST { answers: { itemId: boolean } } → { outcome, flags, state }
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  let b: { answers?: Record<string, boolean> };
  try { b = await req.json(); } catch { return error("Invalid JSON body.", 400); }
  const answers: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(b.answers ?? {})) answers[k] = Boolean(v);
  return json(await submitScreenerMobile(auth.id, answers));
}
