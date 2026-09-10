import { NextResponse } from "next/server";

import { requireDemoAdmin } from "@/lib/auth";
import { data } from "@/lib/data";
import { audit } from "@/lib/audit";
import { verifySignature } from "@/lib/intelligence/export";
import { QA_EXPORT_SURFACE } from "@/lib/demo/qa-export";

// Fetching a released QA report (handoff 07 Wave 8, p9's "Export QA report").
//
// A SECOND DOOR, AND THE REASON IS STATED RATHER THAN WORKED AROUND.
// `/api/exports/[id]` resolves the caller's scope through the organization and
// payer bindings and deliberately excludes the platform tenant, which is where
// a QA report is created — the report is about a DEMONSTRATION ENVIRONMENT, not
// about a plan's population. The alternative was giving a demo administrator an
// intelligence binding so the existing route would let them through, which
// would have widened a disclosure scope to solve a routing problem.
//
// EVERYTHING ELSE IS THE SAME MACHINERY, on purpose:
//
//   The signature is checked at READ time, not trusted from write time. A
//   record whose signature was verified when it was written can be altered
//   afterwards and still be served; one checked here cannot.
//
//   The surface is checked, so this route cannot be used as a general export
//   reader. An id is a URL — it gets pasted into a ticket and fetched by
//   whoever has it — and without this line, a demo administrator holding any
//   export id could read an organization's purpose, cohort and filter through
//   a door that never meant to offer them.
//
//   Every fetch is audited, not only the creation. A report downloaded five
//   times by three people is a different artifact from one downloaded once.
//
// AND IT SERVES THE MANIFEST, NOT THE ROWS, for the same reason the aggregate
// route does: what has to survive independently of the file is the proof of
// what was released and when.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireDemoAdmin();

  const c = await data();
  const row = (await c.get(
    `SELECT id, tenant_id, surface, purpose, cohort_version, filter_hash, filter_json,
            row_count, suppressed_cells, content_hash, signature, created_at
       FROM export_jobs WHERE id = ?`,
    [id],
  )) as Record<string, unknown> | undefined;

  // Not found rather than forbidden, for the reason the aggregate route gives:
  // "forbidden" confirms the export exists.
  if (!row) return new NextResponse("Not found", { status: 404 });

  if (String(row.surface) !== QA_EXPORT_SURFACE) {
    await audit({
      actorId: user.id, actorRole: user.role, family: "security",
      type: "export_out_of_scope", target: String(row.surface),
      detail: { exportId: id, via: "demo qa report route" },
    });
    return new NextResponse("Not found", { status: 404 });
  }

  if (!verifySignature(String(row.content_hash), String(row.signature))) {
    await audit({
      actorId: user.id, actorRole: user.role, family: "security",
      type: "export_signature_invalid", target: String(row.surface),
      detail: { exportId: id },
    });
    return new NextResponse("This report cannot be verified and will not be served.", {
      status: 409,
    });
  }

  await audit({
    actorId: user.id, actorRole: user.role, family: "security",
    type: "export_downloaded", target: String(row.surface),
    detail: { exportId: id, contentHash: String(row.content_hash) },
  });

  const manifest = [
    `# Steady QA report manifest ${id}`,
    `# Surface: ${row.surface}`,
    `# Dataset version: ${row.cohort_version}`,
    `# Filter hash: ${row.filter_hash}`,
    `# Filter: ${row.filter_json ?? "{}"}`,
    `# Purpose: ${row.purpose}`,
    `# Rows: ${row.row_count ?? 0}`,
    `# Content hash: ${row.content_hash}`,
    `# Signature verified: yes`,
    `# Released: ${row.created_at}`,
    // p9: "labelled fabricated on every page". One file, one page, and the
    // label is the last line so it survives a truncated paste as well as a
    // whole one.
    `# FABRICATED DEMONSTRATION DATA — NOT CLINICAL OR FINANCIAL RECORD`,
  ].join("\n");

  return new NextResponse(`${manifest}\n`, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="steady-qa-${id.slice(0, 8)}-manifest.txt"`,
      "cache-control": "no-store",
    },
  });
}
