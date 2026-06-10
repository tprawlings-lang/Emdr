import Link from "next/link";
import { requireClinician } from "@/lib/auth";
import { recentAuditEvents } from "@/lib/audit";

export default async function AuditConsolePage() {
  await requireClinician();
  const events = recentAuditEvents(300);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/clinician" className="text-sm underline">
        ← Back to queue
      </Link>
      <h1 className="mt-3 text-2xl font-bold">Audit console</h1>
      <p className="mt-1 text-sm text-stone-600">
        Append-only ledger of identity, consent, clinical, module-runtime, specialist, and
        security events. Most recent first.
      </p>

      <div className="mt-6 overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-100 text-left">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Family</th>
              <th className="px-3 py-2">Event</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Detail</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t border-stone-100 align-top">
                <td className="whitespace-nowrap px-3 py-2 text-xs text-stone-500">
                  {e.created_at}
                </td>
                <td className="px-3 py-2">{e.event_family}</td>
                <td className="px-3 py-2 font-medium">{e.event_type}</td>
                <td className="px-3 py-2 text-xs">{e.actor_role ?? "system"}</td>
                <td className="px-3 py-2 text-xs">{e.target ?? "—"}</td>
                <td className="max-w-md px-3 py-2 text-xs text-stone-600">
                  {e.detail_json !== "{}" ? e.detail_json : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
