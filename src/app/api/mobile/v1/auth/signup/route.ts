import { NextRequest } from "next/server";
import { signupMobile } from "@/lib/mobile/onboarding";
import { error, json } from "@/lib/mobile/http";

export const runtime = "nodejs";

// POST /api/mobile/v1/auth/signup
//   { name, email, password, dob (YYYY-MM-DD), wellnessAck } → { token, user }
export async function POST(req: NextRequest) {
  let b: { name?: string; email?: string; password?: string; dob?: string; wellnessAck?: boolean };
  try { b = await req.json(); } catch { return error("Invalid JSON body.", 400); }
  const result = await signupMobile({
    name: String(b.name ?? ""), email: String(b.email ?? ""),
    password: String(b.password ?? ""), dob: String(b.dob ?? ""),
    wellnessAck: Boolean(b.wellnessAck),
  });
  if ("error" in result) return error(result.error, 400);
  return json(result);
}
