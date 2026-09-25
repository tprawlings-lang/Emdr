import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { deleteThoughtRecord } from "@/lib/thought-records";

export const runtime = "nodejs";

// DELETE /api/mobile/v1/thought-records/:recordId → { ok } (the words are overwritten)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  const { recordId } = await params;
  if (!(await deleteThoughtRecord(auth.id, recordId.slice(0, 40)))) return error("Not found.", 404);
  return json({ ok: true });
}
