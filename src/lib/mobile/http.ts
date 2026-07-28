// Shared helpers for the mobile JSON API route handlers.
import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken, type SessionUser } from "../auth";

export function bearerToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

export function error(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Authenticate a request as a member. Returns the user, or a ready-to-return
 * error Response. Usage:
 *   const auth = await requireMember(req);
 *   if (auth instanceof NextResponse) return auth;
 *   const user = auth;
 */
export async function requireMember(req: NextRequest): Promise<SessionUser | NextResponse> {
  const user = await getUserFromToken(bearerToken(req));
  if (!user) return error("Not authenticated.", 401);
  if (user.role !== "member") return error("Members only.", 403);
  return user;
}
