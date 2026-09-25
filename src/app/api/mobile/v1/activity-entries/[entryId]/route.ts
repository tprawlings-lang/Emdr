import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { deleteActivityEntry } from "@/lib/program-activities";

export const runtime = "nodejs";

// DELETE /api/mobile/v1/activity-entries/:entryId → { ok }. The words are
// overwritten, not hidden. 404 when it is not this member's, or already gone.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ entryId: string }> }) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  const { entryId } = await params;
  return (await deleteActivityEntry(auth.id, entryId.slice(0, 40))) ? json({ ok: true }) : error("Not found.", 404);
}
