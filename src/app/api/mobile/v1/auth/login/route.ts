import { NextRequest } from "next/server";
import { loginMobile } from "@/lib/mobile/service";
import { error, json } from "@/lib/mobile/http";

export const runtime = "nodejs";

// POST /api/mobile/v1/auth/login  { email, password }
// → { token, user }   (token is a Bearer token for subsequent requests)
export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return error("Invalid JSON body.", 400);
  }
  const email = String(body.email ?? "");
  const password = String(body.password ?? "");
  if (!email || !password) return error("Email and password are required.", 400);

  const result = await loginMobile(email, password);
  if (!result) return error("Incorrect email or password.", 401);
  return json(result);
}
