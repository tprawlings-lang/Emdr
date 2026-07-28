import { NextRequest, NextResponse } from "next/server";
import { requireMember, json } from "@/lib/mobile/http";
import { moduleCatalog } from "@/lib/mobile/service";

export const runtime = "nodejs";

// GET /api/mobile/v1/modules → { modules }  (server-governed access per module)
export async function GET(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  return json({ modules: await moduleCatalog(auth.id) });
}
