import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { programView } from "@/lib/programs";
import { memberEntries } from "@/lib/program-activities";
import { programJson } from "@/lib/mobile/programs";

export const runtime = "nodejs";

// GET /api/mobile/v1/programs/:programId → { program, entries }
// Entries are the member's own, without ratings (CV10_B03).
export async function GET(req: NextRequest, { params }: { params: Promise<{ programId: string }> }) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  const { programId } = await params;
  const view = await programView(auth.id, programId);
  if (!view) return error("Not found.", 404);
  return json({ program: programJson(view), entries: await memberEntries(auth.id, programId) });
}
