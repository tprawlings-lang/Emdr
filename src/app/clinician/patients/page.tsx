import Link from "next/link";
import { ClinicianPage } from "@/components/clinical/ClinicianPage";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import { memberDirectory, byInitial } from "@/lib/clinical/directory";
import { NoteForm } from "@/components/clinical/NoteForm";

export const dynamic = "force-dynamic";

// The patient directory — "find this person".
//
// The caseload could not serve this. It orders by clinical need, which is
// exactly wrong for finding a known name, and it deliberately does not list
// everyone. So looking someone up meant scanning a triage queue for a name
// that might not be in it.
//
// Search is a GET form with no JavaScript: it survives a page reload, it is
// linkable, and it works before hydration. A clinician typing a name into a box
// that has not booted yet is a small failure that reads as a broken product.

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const clinician = await requireClinician();
  const { q } = await searchParams;

  const c = await data();
  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? PLATFORM_TENANT_ID;

  const directory = await memberDirectory({ tenantId, query: q });
  const groups = byInitial(directory.rows);
  const attention = directory.rows.filter((r) => r.needsAttention).length;

  return (
    <ClinicianPage layer="progress" here="/clinician/patients" title="Patients">
      <p className="measure -mt-2 mb-6 text-olive">
        Everyone in your organization, alphabetically. To see who needs attention first,
        use the <Link href="/clinician/caseload" className="underline">caseload</Link> —
        it orders by clinical need and states the reason for every band.
      </p>

      {/* No JavaScript: a GET form is linkable, survives a reload, and works
          before hydration. */}
      <form method="GET" className="mt-6 flex flex-wrap items-center gap-2">
        <label htmlFor="q" className="sr-only">Search by name</label>
        <input
          id="q"
          name="q"
          defaultValue={directory.query}
          placeholder="Search by name"
          className="min-w-64 flex-1 rounded-full border border-ground/20 bg-ivory px-4 py-2 text-sm"
        />
        <button className="rounded-full bg-ground px-5 py-2 text-sm font-medium text-ivory">
          Search
        </button>
        {directory.query && (
          <Link href="/clinician/patients" className="text-sm text-olive underline">
            Clear
          </Link>
        )}
      </form>

      <p className="mt-3 text-sm text-olive" data-testid="directory-count">
        {directory.query
          ? `${directory.rows.length} of ${directory.total} matching “${directory.query}”`
          : `${directory.total} ${directory.total === 1 ? "person" : "people"}`}
        {attention > 0 && ` · ${attention} with something waiting`}
      </p>

      {directory.rows.length === 0 ? (
        <p className="measure mt-8 text-ground/80">
          {directory.query
            ? "Nobody by that name in your organization."
            : "No members in your organization yet."}
        </p>
      ) : (
        <div className="mt-8 space-y-8">
          {groups.map(([initial, rows]) => (
            <section key={initial}>
              <h2 className="type-display text-sm text-olive">{initial}</h2>
              <ul className="mt-2 divide-y divide-ground/10 rounded-3xl border border-ground/10 bg-linen">
                {rows.map((r) => (
                  <li key={r.personId} data-testid="directory-row">
                    <Link
                      href={`/clinician/member/${r.personId}/record`}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3 transition-colors hover:bg-moss/30"
                    >
                      <span className="font-medium text-ground">{r.displayName}</span>

                      {/* One quiet flag, deliberately boolean. A directory that
                          grades people has become a second caseload, and two
                          triage views that disagree is worse than one. But a
                          directory that hides urgency lets someone browse
                          alphabetically past a person in crisis — so the flag
                          is present and says where to go. */}
                      {r.needsAttention && (
                        <span
                          data-testid="attention"
                          className="rounded-full border border-state-caution/40 bg-state-caution-bg px-2 py-0.5 text-xs text-ground"
                        >
                          {r.openAlerts > 0
                            ? `${r.openAlerts} open alert${r.openAlerts === 1 ? "" : "s"}`
                            : "Request waiting"}
                        </span>
                      )}

                      <span className="ml-auto text-sm text-olive">
                        {r.lastActive ? `Last active ${r.lastActive}` : "No activity recorded"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <NoteForm
        surface="Caseload"
        returnTo="/clinician/patients"
        defaultCategory="Workflow fit"
      />
    </ClinicianPage>
  );
}
