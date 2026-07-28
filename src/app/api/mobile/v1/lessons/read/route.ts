import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { markLessonRead } from "@/lib/lessons";

export const runtime = "nodejs";

// POST /api/mobile/v1/lessons/read { lessonId } → { ok }
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  let b: { lessonId?: string };
  try { b = await req.json(); } catch { return error("Invalid JSON body.", 400); }
  if (!b.lessonId) return error("lessonId is required.", 400);
  const r = await markLessonRead(auth.id, b.lessonId);
  if (!r.ok) return error("Unknown lesson.", 404);
  return json({ ok: true });
}
