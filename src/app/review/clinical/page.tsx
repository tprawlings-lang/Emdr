import { ReviewPage } from "@/components/clinical/ReviewPage";
import { Panel, Callout, SummaryCards } from "@/components/app/surfaces";
import { requireReviewAccess } from "@/lib/auth";
import { reviewableSurfaces, copyVersion, CLAIM_MEANING, type ClaimClass } from "@/lib/review/clinical-copy";
import { decisionsAt, decisionHistory, progress } from "@/lib/review/decisions";
import { recordClinicalReview } from "@/lib/review/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clinical review — Steady Review" };

// §26 p44: "Clinical review — /review/clinical — Review language and flow —
// Version, evidence, decision — Record review".
//
// The reviewable unit is a sentence a member reads. Every string on this page
// is pulled from the module that ships it (see lib/review/clinical-copy.ts),
// so approving here approves what the product actually says — a review screen
// with its own transcription of the copy would look identical and mean
// nothing.

const CLAIM_LABEL: Record<ClaimClass, string> = {
  availability: "Availability claim",
  safety: "Safety claim",
  care_process: "Care-process claim",
  consent: "Consent claim",
};

export default async function ClinicalReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireReviewAccess();
  const { error } = await searchParams;

  const surfaces = reviewableSurfaces();
  const version = copyVersion();
  const decisions = await decisionsAt("clinical_language", version);
  const tally = progress(surfaces.map((s) => s.id), decisions);

  const histories = await Promise.all(
    surfaces.map(async (s) => ({ id: s.id, prior: await decisionHistory("clinical_language", s.id) }))
  );
  const priorById = new Map(histories.map((h) => [h.id, h.prior]));

  return (
    <ReviewPage
      layer="actions"
      here="/review/clinical"
      title="Clinical language review"
      lede="The member-facing sentences a clinical reviewer signs off. Each is read from the module that ships it, and each decision is recorded against the policy version that governs the words."
    >
      {error === "reason_required" && (
        <Callout tone="support" label="Not recorded" className="mb-6">
          Blocking a surface or requesting changes needs a reason — whoever rewrites the copy has to know what was wrong with it.
        </Callout>
      )}

      <SummaryCards
        cards={[
          { label: "Approved at this version", value: `${tally.approved}`, detail: `of ${tally.total} surfaces` },
          { label: "Blocked or changes requested", value: `${tally.blocked + tally.changesRequested}`, detail: tally.blocked ? `${tally.blocked} blocking release` : "none blocking" },
          { label: "Copy version", value: version.split("+")[0], detail: "a change to any governing policy reopens every review" },
        ]}
      />

      <Panel title="What this review is against" className="mt-6" footnote={`Full version string: ${version}`}>
        <p className="text-sm text-olive">
          A release is blocked by any unsupported diagnosis, readiness or care claim. Each surface below names the class of
          claim it is permitted to make; the review is whether the words stay inside it.
        </p>
        <dl className="mt-4 space-y-2">
          {(Object.keys(CLAIM_MEANING) as ClaimClass[]).map((k) => (
            <div key={k} className="sm:flex sm:gap-4">
              <dt className="w-44 shrink-0 text-sm font-medium text-app-ink">{CLAIM_LABEL[k]}</dt>
              <dd className="text-sm text-olive">{CLAIM_MEANING[k]}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <div className="mt-6 space-y-4">
        {surfaces.map((s) => {
          const d = decisions.get(s.id) ?? null;
          const prior = priorById.get(s.id) ?? [];
          const superseded = !d && prior.length ? prior[prior.length - 1] : null;
          return (
            <Panel key={s.id} title={s.name}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-app-accent/60 px-2.5 py-1 text-xs font-medium text-app-ink">
                  {CLAIM_LABEL[s.claimClass]}
                </span>
                {d && (
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      d.decision === "approved" ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"
                    }`}
                  >
                    {d.decision === "approved" ? "Approved" : d.decision === "blocked" ? "Blocked" : "Changes requested"}
                  </span>
                )}
                {!d && superseded && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">
                    Reopened — copy version changed
                  </span>
                )}
              </div>

              <blockquote className="mt-4 rounded-xl bg-app-accent/30 px-4 py-3 text-app-ink">
                &ldquo;{s.copy}&rdquo;
              </blockquote>

              {s.supporting.length > 0 && (
                <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
                  {s.supporting.map((sup) => (
                    <div key={sup.label} className="contents">
                      <dt className="text-olive">{sup.label}</dt>
                      <dd className="text-app-ink">{sup.text}</dd>
                    </div>
                  ))}
                </dl>
              )}

              <p className="mt-3 text-xs text-olive">
                Appears at {s.appearsAt} · governed by <span className="font-mono">{s.governedBy}</span> · read from{" "}
                <span className="font-mono">{s.source}</span>
              </p>

              {!d && superseded && (
                <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Last decided <strong>{superseded.decision.replace("_", " ")}</strong> on{" "}
                  {new Date(superseded.createdAt).toLocaleString()} against copy version{" "}
                  <span className="font-mono text-xs">{superseded.subjectVersion}</span>. The governing policy has changed
                  since, so the words need reading again.
                </p>
              )}

              {d && (
                <p className="mt-3 text-sm text-olive">
                  Recorded by {d.actorRole} on {new Date(d.createdAt).toLocaleString()}
                  {d.rationale ? ` — “${d.rationale}”` : ""}
                </p>
              )}

              <form action={recordClinicalReview} className="mt-4 space-y-3 border-t border-ground/10 pt-4">
                <input type="hidden" name="surface_id" value={s.id} />
                <input type="hidden" name="copy_version" value={version} />
                <label className="block text-sm sm:max-w-xs">
                  <span className="mb-1 block text-olive">Decision</span>
                  <select name="decision" required className="w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2">
                    <option value="">Choose…</option>
                    <option value="approved">Approve this wording</option>
                    <option value="changes_requested">Request changes</option>
                    <option value="blocked">Block release</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-olive">Reason (required unless approving)</span>
                  <textarea name="rationale" rows={2} maxLength={1000} className="w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2" />
                </label>
                <label className="flex items-start gap-2 text-sm text-olive">
                  <input type="checkbox" required className="mt-1" />
                  <span>I have read the wording above as it appears to a member.</span>
                </label>
                <button className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-app-surface">
                  Record review
                </button>
              </form>
            </Panel>
          );
        })}
      </div>
    </ReviewPage>
  );
}
