import { PayerPage } from "@/components/app/PayerPage";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import { Note, Panel, WithNote } from "@/components/app/surfaces";
import { cell, num } from "@/components/charts/aggregate";
import { buildDataQuality } from "@/lib/intelligence/payer";
import { resolvePayerTenant } from "@/lib/intelligence/scope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data quality — Steady Intelligence" };

// Data quality (§26: "Understand coverage and lag — feed quality and
// exclusions — Open audit").
//
// This is the payer's audit surface, and it is aggregate by nature: lag,
// rejections, corrections and exclusions are properties of a feed, not of a
// person. That is why the payer rail has an Audit destination where the
// provider network's does not.
//
// It exists so that no other payer screen has to be trusted blindly. A rate is
// only as good as the feed under it, and the months this page names as
// incomplete are exactly the months utilisation refuses to report.

const STATUS_NOTE: Record<string, string> = {
  accepted: "Received and counted.",
  pending: "Incurred but not yet received. These are why recent months are incomplete.",
  corrected: "Received, then restated. The correction supersedes the original rather than editing it.",
  rejected: "Received and not counted. Excluded from every rate on every screen.",
};

export default async function PayerDataQualityPage() {
  const tenantId = await resolvePayerTenant();
  const envelope = tenantId ? await buildDataQuality(tenantId) : null;

  return (
    <PayerPage
      layer="audit"
      here="/payer/data-quality"
      title="Data quality"
      lede="What arrived, what has not, and what was excluded. Every other payer screen rests on this one."
    >
      {!envelope ? (
        <Panel title="No plan in scope">
          <p className="measure text-ground/90">This account is not bound to exactly one contracted plan.</p>
        </Panel>
      ) : (
        <EnvelopeView envelope={envelope} title="Data quality" audience="operations">
          {(q) => (
            <div className="space-y-6">
              <WithNote
                note={
                  <Note
                    tone={q.observedLagDays !== null && q.observedLagDays > q.expectedLagDays ? "caution" : "safe"}
                    title="Claims lag"
                    owner="Plan analytics — the feed is theirs"
                    boundary="Lag is not a quality failure on its own. It becomes one when a rate is read off a month whose claims have not arrived."
                  >
                    <p>
                      Observed{" "}
                      {q.observedLagDays === null ? "not enough claims" : `${q.observedLagDays} days`},
                      against {q.expectedLagDays} expected by contract.
                    </p>
                    <p className="mt-2">
                      {q.incompleteMonths.length === 0
                        ? "No month is currently withheld."
                        : `${q.incompleteMonths.length} month(s) withheld from every rate: ${q.incompleteMonths.join(", ")}.`}
                    </p>
                  </Note>
                }
              >
                <Panel
                  title="Claim feed"
                  footnote={`${num(q.total)} claims on record for cohort ${q.cohortVersion}. Rejected claims are excluded from every rate; pending ones are not counted as zero.`}
                >
                  <ul className="space-y-2.5">
                    {q.byStatus.map((s) => (
                      <li key={s.status} className="border-b border-ground/5 pb-2.5 last:border-0">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-medium capitalize text-ground">{s.status}</span>
                          <span className="text-sm text-ground">{cell({ n: s.n, of: s.of })}</span>
                        </div>
                        <p className="measure mt-0.5 text-sm text-olive">{STATUS_NOTE[s.status] ?? ""}</p>
                      </li>
                    ))}
                  </ul>
                </Panel>
              </WithNote>
            </div>
          )}
        </EnvelopeView>
      )}
    </PayerPage>
  );
}
