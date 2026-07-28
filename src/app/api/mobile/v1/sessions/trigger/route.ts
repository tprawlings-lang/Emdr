import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { recordSessionTriggerMobile } from "@/lib/mobile/service";

export const runtime = "nodejs";

// POST /api/mobile/v1/sessions/trigger
//   { sessionId, name, category, bodyFelt?, belief?, disruption }
// Module-5 trigger-map entry — persists to user_triggers (encrypted), parity
// with the web recordSessionTrigger, so it reaches the program plan + specialist.
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  let b: {
    sessionId?: string; name?: string; category?: string;
    bodyFelt?: string; belief?: string; disruption?: number;
  };
  try { b = await req.json(); } catch { return error("Invalid JSON body.", 400); }

  if (!b.sessionId) return error("sessionId is required.", 400);
  if (!b.name || !b.name.trim()) return error("Give the trigger a short name first.", 400);

  const result = await recordSessionTriggerMobile(auth.id, {
    sessionId: b.sessionId,
    name: b.name,
    category: typeof b.category === "string" ? b.category : "other",
    bodyFelt: typeof b.bodyFelt === "string" ? b.bodyFelt : "",
    belief: typeof b.belief === "string" ? b.belief : "",
    disruption: Number(b.disruption ?? 5),
  });
  if (!result.ok) return error(result.error ?? "Could not save.", 400);
  return json({ ok: true });
}
