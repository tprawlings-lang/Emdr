import { NextRequest, NextResponse } from "next/server";
import { requireMember, json } from "@/lib/mobile/http";
import { getConversation, latestGeneralConversation } from "@/lib/mobile/companion";

export const runtime = "nodejs";

// GET ?id=<conversationId> → { messages }
// GET (no id)             → { conversationId, messages } for the latest general
//                           conversation, or { conversationId: null, messages: [] }
export async function GET(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  const id = req.nextUrl.searchParams.get("id");
  if (id) return json({ messages: await getConversation(auth.id, id) });
  const latest = await latestGeneralConversation(auth.id);
  return json(latest ?? { conversationId: null, messages: [] });
}
