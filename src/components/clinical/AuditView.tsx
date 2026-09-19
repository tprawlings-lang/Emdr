import type { AuditEntry, AuditKind } from "@/lib/clinical/audit-history";
import type { ChainVerification } from "@/lib/audit";
import { displayTermFor, coverageOf } from "@/lib/clinical/event-vocabulary";
import { checkApproval } from "@/lib/governance/clinical-approval";

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

/** One event's name: the approved words, or the raw key marked as raw.
 *
 *  THE NOTE IS NOT HERE, and the first version had it. Rendering it per row put
 *  the same three lines under every `person_record_viewed` — the commonest row
 *  on the tab — so a table of twenty entries carried the same sentence eight
 *  times. That is the density this work exists to remove, arriving as a side
 *  effect of being thorough. The note is said once, below the table, for each
 *  distinct event on the page. */
function EventName({ type }: { type: string }) {
  const t = displayTermFor(type);
  return (
    <>
      <span className="font-medium text-ground">{t.term}</span>
      {!t.approved && (
        <span
          className="ml-1.5 rounded bg-ground/10 px-1 py-0.5 text-xs text-olive"
          title="No clinician-approved wording exists for this event yet, so its raw key is shown."
        >
          raw key
        </span>
      )}
      <code className="mt-0.5 block text-xs text-olive">{t.key}</code>
    </>
  );
}

/** What each event on this page means, once each.
 *
 *  A glossary rather than a repeated annotation: the distinctions these notes
 *  carry — opened is not reviewed, prepared is not sent — are worth reading
 *  once and worth finding again, and neither of those is helped by printing
 *  them on every row. */
function EventGlossary({ types }: { types: string[] }) {
  const distinct = [...new Set(types)].map(displayTermFor).filter((t) => t.note);
  if (distinct.length === 0) return null;
  distinct.sort((a, b) => a.term.localeCompare(b.term));

  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer text-olive underline-offset-2 hover:underline">
        What these events mean ({distinct.length})
      </summary>
      <dl className="mt-2 space-y-2">
        {distinct.map((t) => (
          <GlossaryRow key={t.key} term={t.term} note={t.note!} />
        ))}
      </dl>
    </details>
  );
}

/** A fragment, so the <dl> has only <dt> and <dd> as children. */
function GlossaryRow({ term, note }: { term: string; note: string }) {
  return (
    <>
      <dt className="font-medium text-ground">{term}</dt>
      <dd className="measure text-olive">{note}</dd>
    </>
  );
}

/** What the words on this table rest on, stated above it.
 *
 *  THE WORDS ARE AN IMPROVEMENT ON RAW KEYS WHETHER OR NOT ANYBODY HAS SIGNED
 *  THEM OFF, and "clinician-approved" is a claim that needs a clinician. So the
 *  table shows the terms and this says exactly what backs them. When an
 *  attestation is recorded against this content the notice goes away, because
 *  then the claim is simply true. */
function VocabularyNotice({ types }: { types: string[] }) {
  const approval = checkApproval();
  const coverage = coverageOf(types);
  if (approval.ok && coverage.missing.length === 0) return null;

  return (
    <p className="mt-4 rounded-2xl border border-state-caution/40 bg-state-caution-bg px-4 py-3 text-sm text-ground">
      {!approval.ok && (
        <>
          <strong>These words are not clinically approved yet.</strong>{" "}
          {approval.problems[0]} They are shown because they are clearer than the raw
          keys, not because a clinician has signed them off.{" "}
        </>
      )}
      {coverage.missing.length > 0 && (
        <>
          {coverage.approved} of {coverage.total} event types on this page have approved
          wording; the rest show their raw key and are marked.
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
    <>
    <VocabularyNotice types={entries.map((e) => e.type)} />
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
              {/* UX 009: "Raw event keys and routing values appear in routine
                  clinical views. Add clinician-approved display mappings;
                  retain raw values in details." This column used to render
                  `e.type.replace(/_/g, " ")` — the identifier with its
                  punctuation changed, which reads as English and means nothing
                  a clinician would say.

                  THE RAW KEY IS RETAINED, one line down and in the monospace
                  it deserves, because this is a log somebody may have to
                  reconcile against a database.

                  AN UNAPPROVED KEY IS SHOWN AS WHAT IT IS. No words are
                  invented for an event the vocabulary has never heard of. */}
              <td className="px-3 py-2">
                <EventName type={e.type} />
              </td>
              <td className="px-3 py-2 text-xs">{e.actorLabel}</td>
              {showTarget && (
                <td className="px-3 py-2 text-xs">
                  {e.target ? <code className="text-xs">{e.target.slice(0, 12)}…</code> : "—"}
                </td>
              )}
              <td className="max-w-md px-3 py-2 text-xs text-olive">
                {Object.keys(e.detail).length > 0 ? (
                  <code className="text-xs">{JSON.stringify(e.detail)}</code>
                ) : (
                  "—"
                )}
                {/* Withholding is stated. A silently trimmed record teaches a
                    reviewer that they are seeing everything. */}
                {e.redacted && (
                  <span className="ml-1 rounded bg-ground/10 px-1 py-0.5 text-xs">
                    free-text fields withheld
                  </span>
                )}
                {!e.chained && (
                  <span className="ml-1 rounded bg-state-caution-bg px-1 py-0.5 text-xs">
                    predates chaining
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <EventGlossary types={entries.map((e) => e.type)} />
    </>
  );
}
