import { NextRequest, NextResponse } from "next/server";
import { requireMember, json } from "@/lib/mobile/http";
import { gatingSnapshot, moduleCatalog } from "@/lib/mobile/service";

export const runtime = "nodejs";

// GET /api/mobile/v1/me → { user, gating, modules }
// The single "who am I + what's open" call the app makes on launch/refresh.
export async function GET(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  const [gating, modules] = await Promise.all([
    gatingSnapshot(auth.id),
    moduleCatalog(auth.id),
  ]);
  return json({ user: auth, gating, modules });
}
