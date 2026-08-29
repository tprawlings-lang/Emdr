import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { divergenceReport } from "@/lib/autonomous/divergence";

// GET /api/clinician/divergence → shadow-vs-live module-access divergence report.
// Clinician/admin only (member-level data). The pre-flip artifact: does the
// autonomous engine's decision match the live human gate, and where would it be
// more permissive? See src/lib/autonomous/divergence.ts and README §14.7.
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  // Aggregate roles are not clinical roles — see requireClinician.
  if (!user || user.role !== "clinician") {
    return NextResponse.json({ error: "Clinician access required." }, { status: 403 });
  }
  return NextResponse.json(await divergenceReport());
}
