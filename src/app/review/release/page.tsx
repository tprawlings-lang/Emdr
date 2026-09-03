import Link from "next/link";
import { ReviewPage } from "@/components/clinical/ReviewPage";
import { Panel, Callout, SummaryCards } from "@/components/app/surfaces";
import { requireReviewAccess } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { RELEASE_GATES, resolveEvidence, fingerprint, type EvidenceClass, type EvidenceStatus } from "@/lib/review/gates";
import { decisionsAt, decisionHistory, type ReviewDecision } from "@/lib/review/decisions";
import { reviewableSurfaces, copyVersion } from "@/lib/review/clinical-copy";
import { recordGateSignoff } from "@/lib/review/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Release gates — Steady Review" };

// §26 p44: "Release gates — /review/release — Record required sign-offs —
// Owner, evidence, state — Approve or block". The gates themselves are §31.6
// (p99).
//
// The screen's job is not to collect eight approvals. It is to make the
// DIFFERENCE between the eight visible — which are measured, which are a
// person's word, and which have gone stale since somebody approved them —
// because a release conversation held over a column of green ticks cannot ask
// the only question that matters, which is what each tick is standing on.

const CLASS_COPY: Record<EvidenceClass, { word: string; meaning: string }> = {
  measured: {
    word: "Measured",
    meaning: "Resolved from the running system on this page load. Approving confirms a fact the system checked.",
  },
  on_demand: {
    word: "Measured on request",
    meaning: "The system can check it, but the check is expensive enough that it is not run on page load. Run it before approving.",
  },
  attested: {
    word: "Attested",
    meaning: "The system cannot check this. A named owner asserts it and records where the evidence lives.",
  },
};

const STATUS_COPY: Record<EvidenceStatus, { word: string; tone: "safe" | "caution" | "support" | "info" }> = {
  pass: { word: "Evidence passing", tone: "safe" },
  fail: { word: "Evidence failing", tone: "support" },
  unavailable: { word: "Not resolved", tone: "info" },
};

function StateBadge({ children, tone }: { children: React.ReactNode; tone: "safe" | "caution" | "support" | "info" }) {
  const bg =
    tone === "safe" ? "bg-emerald-50 text-emerald-900"
      : tone === "support" ? "bg-rose-50 text-rose-900"
        : tone === "caution" ? "bg-amber-50 text-amber-900"
          : "bg-app-accent/60 text-app-ink";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${bg}`}>{children}</span>;
}

export default async function ReleaseGatesPage({
  searchParams,
}: {
  searchParams: Promise<{ parity?: string; error?: string }>;
}) {
  await requireReviewAccess();
  const { parity, error } = await searchParams;
  const db = getDb();

  // The on-demand check, only when asked for. A ledger rebuild on every page
  // load would make this the screen nobody opens.
  let projectionParity: { identical: boolean; compared: number; diffs: number } | null = null;
  if (parity === "1") {
    const { verifyProjections } = await import("@/lib/projections");
    const v = await verifyProjections();
    projectionParity = {
      identical: v.identical,
      compared: Object.values(v.compared).reduce((a, b) => a + b, 0),
      diffs: v.diffs.length,
    };
  }

  // The clinical-language gate reads the other screen's decisions, so the two
  // cannot disagree about whether the copy is approved.
  const surfaces = reviewableSurfaces();
  const clinicalDecisions = await decisionsAt("clinical_language", copyVersion());
  const clinicalTally = {
    total: surfaces.length,
    approved: surfaces.filter((s) => clinicalDecisions.get(s.id)?.decision === "approved").length,
    blocked: surfaces.filter((s) => clinicalDecisions.get(s.id)?.decision === "blocked").length,
    changesRequested: surfaces.filter((s) => clinicalDecisions.get(s.id)?.decision === "changes_requested").length,
  };

  const evidence = resolveEvidence(db, { projectionParity, clinicalLanguage: clinicalTally });

  // A decision is in force only at the CURRENT fingerprint. One recorded
  // against an earlier evidence state is fetched separately and shown as
  // reopened, rather than being silently absent — "nobody has reviewed this"
  // and "somebody reviewed this and then the evidence moved" are different
  // situations and only one of them is anybody's fault.
  const rows = await Promise.all(
    RELEASE_GATES.map(async (gate) => {
      const ev = evidence.get(gate.id)!;
      const fp = fingerprint(ev.facts);
      const atCurrent = await decisionsAt("release_gate", fp);
      const inForce = atCurrent.get(gate.id) ?? null;
      let superseded: ReviewDecision | null = null;
      if (!inForce) {
        const history = await decisionHistory("release_gate", gate.id);
        superseded = history.length ? history[history.length - 1] : null;
      }
      return { gate, ev, fp, inForce, superseded };
    })
  );

  const approved = rows.filter((r) => r.inForce?.decision === "approved").length;
  const blocked = rows.filter((r) => r.inForce?.decision === "blocked").length;
  const reopened = rows.filter((r) => !r.inForce && r.superseded).length;

  return (
    <ReviewPage
      layer="actions"
      here="/review/release"
      title="Release gates"
      lede="The eight gates a release has to clear. A sign-off is recorded against the evidence it was shown, so changing the evidence reopens the gate rather than inheriting its approval."
    >
      {error === "reason_required" && (
        <Callout tone="support" label="Not recorded" className="mb-6">
          Blocking a gate or requesting changes needs a reason. Whoever has to resolve it cannot act on a refusal that does not say what is wrong.
        </Callout>
      )}
      {error === "evidence_required" && (
        <Callout tone="support" label="Not recorded" className="mb-6">
          An attested gate needs a pointer to its evidence before it can be approved — where the run, the report or the review can be found.
        </Callout>
      )}

      <SummaryCards
        cards={[
          { label: "Approved at current evidence", value: `${approved}`, detail: `of ${RELEASE_GATES.length} gates` },
          { label: "Blocking", value: `${blocked}`, detail: blocked === 0 ? "no gate is blocking release" : "release is blocked" },
          { label: "Reopened by changed evidence", value: `${reopened}`, detail: reopened === 0 ? "none" : "previously approved, evidence has since moved" },
        ]}
      />

      <Panel title="What a sign-off is standing on" className="mt-6">
        <dl className="space-y-3">
          {(Object.keys(CLASS_COPY) as EvidenceClass[]).map((k) => (
            <div key={k} className="sm:flex sm:gap-4">
              <dt className="w-44 shrink-0 text-sm font-medium text-app-ink">{CLASS_COPY[k].word}</dt>
              <dd className="text-sm text-olive">{CLASS_COPY[k].meaning}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-olive">
          These are not interchangeable. A gate carrying an attestation and a gate carrying a measurement can both read
          &ldquo;approved&rdquo;, and they do not mean the same thing.
        </p>
      </Panel>

      <div className="mt-6 space-y-4">
        {rows.map(({ gate, ev, fp, inForce, superseded }) => {
          const st = STATUS_COPY[ev.status];
          return (
            <Panel key={gate.id} title={gate.name}>
              <div className="flex flex-wrap items-center gap-2">
                <StateBadge tone="info">{CLASS_COPY[gate.evidenceClass].word}</StateBadge>
                <StateBadge tone={st.tone}>{st.word}</StateBadge>
                {inForce && (
                  <StateBadge tone={inForce.decision === "approved" ? "safe" : "support"}>
                    {inForce.decision === "approved" ? "Signed off" : inForce.decision === "blocked" ? "Blocked" : "Changes requested"}
                  </StateBadge>
                )}
                {!inForce && superseded && <StateBadge tone="caution">Reopened — evidence changed</StateBadge>}
              </div>

              <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
                <dt className="text-olive">Owner</dt>
                <dd className="text-app-ink">{gate.owner}</dd>
                <dt className="text-olive">Evidence</dt>
                <dd className="text-app-ink">
                  {gate.evidenceLabel}
                  {ev.href && (
                    <>
                      {" — "}
                      <Link href={ev.href} className="underline">
                        open
                      </Link>
                    </>
                  )}
                </dd>
                <dt className="text-olive">Blocks when</dt>
                <dd className="text-app-ink">{gate.blockingCondition}</dd>
                <dt className="text-olive">Reads now</dt>
                <dd className="text-app-ink">{ev.summary}</dd>
              </dl>

              {gate.evidenceClass === "on_demand" && !projectionParity && (
                <p className="mt-3 text-sm">
                  <Link href="/review/release?parity=1" className="underline">
                    Run the comparison now
                  </Link>{" "}
                  <span className="text-olive">— rebuilds the ledger and compares it with live projections.</span>
                </p>
              )}

              {!inForce && superseded && (
                <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Last decided <strong>{superseded.decision.replace("_", " ")}</strong> on{" "}
                  {new Date(superseded.createdAt).toLocaleString()} against evidence{" "}
                  <span className="font-mono text-xs">{superseded.subjectVersion}</span>. The evidence now fingerprints as{" "}
                  <span className="font-mono text-xs">{fp}</span>, so that sign-off no longer applies.
                </p>
              )}

              {inForce && (
                <p className="mt-3 text-sm text-olive">
                  Recorded by {inForce.actorRole} on {new Date(inForce.createdAt).toLocaleString()}
                  {inForce.rationale ? ` — “${inForce.rationale}”` : ""}
                </p>
              )}

              <form action={recordGateSignoff} className="mt-4 space-y-3 border-t border-ground/10 pt-4">
                <input type="hidden" name="gate_id" value={gate.id} />
                <input type="hidden" name="fingerprint" value={fp} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">
                    <span className="mb-1 block text-olive">Decision</span>
                    <select name="decision" required className="w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2">
                      <option value="">Choose…</option>
                      <option value="approved">Approve</option>
                      <option value="changes_requested">Request changes</option>
                      <option value="blocked">Block release</option>
                    </select>
                  </label>
                  {gate.evidenceClass === "attested" && (
                    <label className="text-sm">
                      <span className="mb-1 block text-olive">Where the evidence lives</span>
                      <input
                        name="evidence_ref"
                        maxLength={300}
                        placeholder="Run, report or review reference"
                        className="w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2"
                      />
                    </label>
                  )}
                </div>
                <label className="block text-sm">
                  <span className="mb-1 block text-olive">Reason (required unless approving)</span>
                  <textarea
                    name="rationale"
                    rows={2}
                    maxLength={1000}
                    className="w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2"
                  />
                </label>
                {/* §26 p44: high-impact actions are confirmed and not optimistically
                    shown as complete. A required checkbox is the confirmation that
                    still works with scripting unavailable. */}
                <label className="flex items-start gap-2 text-sm text-olive">
                  <input type="checkbox" required className="mt-1" />
                  <span>
                    I have read the evidence above, and I am recording this against fingerprint{" "}
                    <span className="font-mono text-xs">{fp}</span>.
                  </span>
                </label>
                <button className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-app-surface">
                  Record decision
                </button>
              </form>
            </Panel>
          );
        })}
      </div>
    </ReviewPage>
  );
}
