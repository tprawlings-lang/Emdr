import type { AuditEntry, AuditKind } from "@/lib/clinical/audit-history";
import type { ChainVerification } from "@/lib/audit";

// Shared rendering for audit entries (Phase 4).
//
// One component, used by the tenant feed and by the member-scoped history, so
// the two cannot diverge in what they redact. The previous audit view printed
// `detail_json` straight into a table cell; keeping the rendering in one place
// is what stops that from coming back on the next surface someone adds.

const KIND_STYLE: Record<AuditKind, string> = {
  access: "bg-state-info-bg/60 text-ground border-state-info/40",
  clinical: "bg-moss/40 text-ground border-sage/60",
  safety: "bg-state-support-bg/60 text-state-support border-state-support/40",
  consent: "bg-state-caution-bg text-ground border-state-caution/40",
  alert: "bg-linen text-ground border-ground/20",
  other: "bg-linen text-olive border-ground/10",
};

/** The chain result, stated plainly. An append-only claim nobody checks is a
 *  claim, not a control — so the check runs and its outcome is shown, including
 *  when it fails. */
export function ChainBanner({ chain }: { chain: ChainVerification }) {
  return (
    <p
      data-testid="chain-banner"
      className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
        chain.ok
          ? "border-state-safe/40 bg-state-safe-bg/60 text-ground"
          : "border-state-support/40 bg-state-support-bg/60 text-state-support"
      }`}
    >
      {chain.ok ? (
        <>
          <strong>Chain intact.</strong> {chain.checked} entr
          {chain.checked === 1 ? "y" : "ies"} verified — each links to the hash of the one
          before it, so an edited, reordered, or deleted row is detectable.
        </>
      ) : (
        <>
          <strong>Chain broken.</strong> Verification failed
          {chain.brokenAtId != null ? ` at entry ${chain.brokenAtId}` : ""}
          {chain.reason ? `: ${chain.reason}` : "."} Treat the log as unreliable from that
          point and preserve it before doing anything else.
        </>
      )}
    </p>
  );
}

export function AuditTable({
  entries, showTarget = false,
}: { entries: AuditEntry[]; showTarget?: boolean }) {
  if (entries.length === 0) {
    return <p className="mt-6 text-sm text-olive">No audit entries in scope.</p>;
  }

  return (
    <div className="mt-6 overflow-x-auto rounded-3xl border border-ground/10 bg-linen shadow-soft">
      <table className="w-full min-w-[44rem] text-sm">
        <caption className="sr-only">Audit entries, most recent first</caption>
        <thead className="bg-sand/40 text-left">
          <tr>
            <th scope="col" className="px-3 py-2">Time</th>
            <th scope="col" className="px-3 py-2">Kind</th>
            <th scope="col" className="px-3 py-2">Event</th>
            <th scope="col" className="px-3 py-2">Actor</th>
            {showTarget && <th scope="col" className="px-3 py-2">Target</th>}
            <th scope="col" className="px-3 py-2">Detail</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} data-testid="audit-row" className="border-t border-ground/10 align-top">
              <td className="whitespace-nowrap px-3 py-2 text-xs text-olive">{e.at}</td>
              <td className="px-3 py-2">
                <span className={`rounded-full border px-2 py-0.5 text-xs ${KIND_STYLE[e.kind]}`}>
                  {e.kind}
                </span>
              </td>
              <td className="px-3 py-2 font-medium">{e.type.replace(/_/g, " ")}</td>
              <td className="px-3 py-2 text-xs">{e.actorLabel}</td>
              {showTarget && (
                <td className="px-3 py-2 text-xs">
                  {e.target ? <code className="text-[10px]">{e.target.slice(0, 12)}…</code> : "—"}
                </td>
              )}
              <td className="max-w-md px-3 py-2 text-xs text-olive">
                {Object.keys(e.detail).length > 0 ? (
                  <code className="text-[10px]">{JSON.stringify(e.detail)}</code>
                ) : (
                  "—"
                )}
                {/* Withholding is stated. A silently trimmed record teaches a
                    reviewer that they are seeing everything. */}
                {e.redacted && (
                  <span className="ml-1 rounded bg-ground/10 px-1 py-0.5 text-[10px]">
                    free-text fields withheld
                  </span>
                )}
                {!e.chained && (
                  <span className="ml-1 rounded bg-state-caution-bg px-1 py-0.5 text-[10px]">
                    predates chaining
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
