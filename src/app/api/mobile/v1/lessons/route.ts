import { NextRequest, NextResponse } from "next/server";
import { requireMember, json } from "@/lib/mobile/http";
import { LESSONS, readLessonIds } from "@/lib/lessons";

export const runtime = "nodejs";

// GET /api/mobile/v1/lessons → { lessons, read: [ids] }
export async function GET(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  return json({ lessons: LESSONS, read: await readLessonIds(auth.id) });
}
