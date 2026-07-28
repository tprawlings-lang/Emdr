import { NextRequest, NextResponse } from "next/server";
import { requireMember, json } from "@/lib/mobile/http";
import { getSosPanel } from "@/lib/sos";

export const runtime = "nodejs";

// GET /api/mobile/v1/sos → the panic panel, built from the member's own plan.
export async function GET(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  return json(await getSosPanel(auth.id));
}
