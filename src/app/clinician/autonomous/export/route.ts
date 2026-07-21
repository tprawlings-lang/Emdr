import { requireClinician } from "@/lib/auth";
import { RULES, SESSION_RULES, SAFETY_CONFIG_VERSION } from "@/lib/safety";
import { getRuleSignoffs } from "@/lib/safety/signoff";

// CSV export of the rule sign-off register for the clinician's records.
// Clinician-gated; no secrets. One row per deterministic rule with its current
// verdict (or "unreviewed") at the current config version.
export const dynamic = "force-dynamic";

function csvCell(v: string | null): string {
  const s = v ?? "";
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  await requireClinician();
  const signoffs = getRuleSignoffs();
  const header = ["rule_id", "category", "config_version", "verdict", "note", "clinician_id", "reviewed_at"];
  const lines = [header.join(",")];
  for (const r of [...RULES, ...SESSION_RULES]) {
    const s = signoffs.get(r.id);
    lines.push(
      [
        r.id,
        r.category,
        SAFETY_CONFIG_VERSION,
        s?.verdict ?? "unreviewed",
        s?.note ?? "",
        s?.clinicianId ?? "",
        s?.createdAt ?? "",
      ]
        .map((c) => csvCell(String(c)))
        .join(",")
    );
  }
  const body = lines.join("\n") + "\n";
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="steady-signoff-${SAFETY_CONFIG_VERSION}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
