import { NextResponse } from "next/server";
import { safetyCoreStatus } from "@/lib/safety/governance";

// Operational visibility for the autonomous safety core (Autonomous Step 6):
// current mode (shadow vs governing), kill-switch state, active stages, and the
// versioned config snapshot. No secrets, no member data — thresholds are
// surfaced deliberately (Vol V Ch.21: not invisible engineering parameters).
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(safetyCoreStatus());
}
