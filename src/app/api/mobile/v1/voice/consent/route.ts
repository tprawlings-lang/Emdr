import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { voiceInfo, grantVoice, withdrawVoice } from "@/lib/mobile/voice";

export const runtime = "nodejs";

// GET → { version, sections, granted, available }
export async function GET(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  return json(await voiceInfo(auth.id));
}

// POST { action: "grant" | "withdraw" } → updated voice info
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  let b: { action?: string };
  try { b = await req.json(); } catch { return error("Invalid JSON body.", 400); }
  if (b.action === "grant") return json(await grantVoice(auth.id));
  if (b.action === "withdraw") return json(await withdrawVoice(auth.id));
  return error("Unknown action.", 400);
}
