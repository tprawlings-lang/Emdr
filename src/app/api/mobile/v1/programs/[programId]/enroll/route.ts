import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { enrollInProgram, ProgramRefused } from "@/lib/programs";

export const runtime = "nodejs";

// POST /api/mobile/v1/programs/:programId/enroll { entryAnswers?: boolean[] } → { ok }
//   422 { error: "entry_screen" }  the program asks entry questions and the
//                                  answers are missing or do not fit them
export async function POST(req: NextRequest, { params }: { params: Promise<{ programId: string }> }) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  const { programId } = await params;
  let b: { entryAnswers?: unknown } = {};
  try { b = await req.json(); } catch { /* no body: a program without entry questions */ }
  try {
    await enrollInProgram(auth.id, programId, Array.isArray(b.entryAnswers) ? b.entryAnswers : undefined);
  } catch (e) {
    if (e instanceof ProgramRefused && e.message === "entry_screen") return json({ error: "entry_screen" }, 422);
    if (e instanceof ProgramRefused) return error("Not found.", 404);
    throw e;
  }
  return json({ ok: true });
}
