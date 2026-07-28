import { NextRequest, NextResponse } from "next/server";
import { requireMember, json, error } from "@/lib/mobile/http";
import { listCheckins, submitCheckinMobile, type CheckinValues } from "@/lib/mobile/service";

export const runtime = "nodejs";

// GET /api/mobile/v1/checkins?since=YYYY-MM-DD → { checkins }
export async function GET(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  const since = req.nextUrl.searchParams.get("since") ?? undefined;
  return json({ checkins: await listCheckins(auth.id, since) });
}

// POST /api/mobile/v1/checkins  { activation, shutdown, harm_urge, feels_safe,
//   dissociation, sleep_quality, substance_flag } → { action, date }
export async function POST(req: NextRequest) {
  const auth = await requireMember(req);
  if (auth instanceof NextResponse) return auth;
  let b: Partial<CheckinValues>;
  try { b = await req.json(); } catch { return error("Invalid JSON body.", 400); }

  const values: CheckinValues = {
    activation: clamp(b.activation),
    shutdown: clamp(b.shutdown),
    harm_urge: Boolean(b.harm_urge),
    feels_safe: b.feels_safe === undefined ? true : Boolean(b.feels_safe),
    dissociation: clamp(b.dissociation),
    sleep_quality: clamp(b.sleep_quality, 5),
    substance_flag: Boolean(b.substance_flag),
  };
  const result = await submitCheckinMobile(auth.id, values);
  return json(result);
}

function clamp(n: unknown, fallback = 0): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(10, Math.round(v)));
}
