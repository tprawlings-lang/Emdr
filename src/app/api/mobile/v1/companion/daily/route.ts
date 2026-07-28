import { NextRequest, NextResponse } from "next/server";
import { requireMember, json } from "@/lib/mobile/http";
import { openDailyChat } from "@/lib/mobile/companion";

export const runtime = "nodejs";

// POST → opens (or resumes) today's post-check-in companion chat.
// { conversationId, messages }
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  return json(await openDailyChat(auth.id));
}
