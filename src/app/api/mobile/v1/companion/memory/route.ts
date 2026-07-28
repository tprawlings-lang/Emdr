import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { listMemory, setMemoryEnabled, deleteMemory, clearMemory } from "@/lib/mobile/companion";

export const runtime = "nodejs";

// GET → { enabled, items:[{id,type,key,value}] }
export async function GET(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  return json(await listMemory(auth.id));
}

// POST { action: "toggle"|"delete"|"clear", enabled?, itemId? }
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  let b: { action?: string; enabled?: string; itemId?: string };
  try { b = await req.json(); } catch { return error("Invalid JSON body.", 400); }
  switch (b.action) {
    case "toggle": await setMemoryEnabled(auth.id, String(b.enabled ?? "yes")); break;
    case "delete":
      if (!b.itemId) return error("itemId is required.", 400);
      await deleteMemory(auth.id, b.itemId); break;
    case "clear": await clearMemory(auth.id); break;
    default: return error("Unknown action.", 400);
  }
  return json(await listMemory(auth.id));
}
