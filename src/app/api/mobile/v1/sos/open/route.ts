import { NextRequest, NextResponse } from "next/server";
import { requireMember, json } from "@/lib/mobile/http";
import { recordSosOpened } from "@/lib/sos";

export const runtime = "nodejs";

// POST /api/mobile/v1/sos/open → record that the member opened the panel.
// Coded safety event only; no body.
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  return json(await recordSosOpened(auth.id));
}
