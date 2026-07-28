import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { sendMessage } from "@/lib/mobile/companion";

export const runtime = "nodejs";

// POST { conversationId?, text, contextType? }
//   → { conversationId, reply, riskFlag, aiEnabled }
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  let b: { conversationId?: string | null; text?: string; contextType?: string };
  try { b = await req.json(); } catch { return error("Invalid JSON body.", 400); }
  const text = String(b.text ?? "").trim();
  if (!text) return error("text is required.", 400);
  return json(await sendMessage(auth.id, b.conversationId ?? null, text, b.contextType));
}
