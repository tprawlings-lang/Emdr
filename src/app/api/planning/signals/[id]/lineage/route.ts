import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { noteSignal } from "@/lib/telemetry/store";
import { signalLineage } from "@/lib/planning/service";
import { readableSignalTenants } from "@/lib/planning/scope";

// GET /api/planning/signals/:id/lineage — p47: "Return definitions and
// evidence. Primary guard: minimum necessary output."
//
// Minimum necessary is what this route returns rather than what it filters:
// the cohort definition, the thresholds that were in force, the numbers
// observed and the transition history. Every one of those is about a cohort or
// about a reviewer's decision, and none of them is about a person — so there
// is no reduction step to forget.
//
// Audited as a privileged read. p44's audit row is "every view, comment, state
// change and export", and a lineage fetch is a view of the evidence behind a
// finding.

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();
  const tenants = readableSignalTenants(user.role);
  if (tenants.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

  const lineage = await signalLineage(id, tenants, user.role);
  if (!lineage) return NextResponse.json({ error: "not found" }, { status: 404 });

  await audit({
    actorId: user.id, actorRole: user.role, family: "security",
    type: "planning_lineage_viewed", target: id, detail: {},
  });
  // §31.7's evidence_opened: "evidence type, not content". The TYPE is what
  // was opened — a planning signal's lineage — and the signal's id stays out,
  // because an id is a subject once somebody can look it up.
  noteSignal("evidence_opened", { evidenceType: "planning_signal_lineage" }, { actorRole: user.role });
  return NextResponse.json(lineage);
}
