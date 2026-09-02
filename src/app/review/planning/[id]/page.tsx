import Link from "next/link";
import { notFound } from "next/navigation";
import { ReviewPage } from "@/components/clinical/ReviewPage";
import { Panel, Note, WithNote, RecordRows } from "@/components/app/surfaces";
import { requireReviewAccess } from "@/lib/auth";
import { getSignal, signalExplanations, signalHistory, signalLineage } from "@/lib/planning/service";
import { populationTenantIds, readableSignalTenants } from "@/lib/planning/scope";
import { submitSignalReview } from "@/lib/planning/actions";
import { ACTION_LABELS, BLOCKED_ACTIONS, BLOCKED_ACTION_REASONS, stateDef } from "@/lib/planning/lifecycle";
import { ladder } from "@/lib/planning/ladder";
import { PLANNING_OWNER, THRESHOLD_VERSION } from "@/lib/planning/policy";
import { rule } from "@/lib/planning/rules";

export const dynamic = "force-dynamic";
export const metadata = { title: "Planning signal — Steady Review" };

// The planning-signal detail screen (handoff 07 §4.5, p44).
//
// p44 fixes nine sections and one sentence. The sections are the headings
// below, in p44's order — statement, why it fired, population, evidence,
// alternative explanations, fairness, allowed next actions, blocked actions,
// audit — and the sentence is the required phrase, which comes off the signal
// object rather than being typed here, so a signal that reaches any other
// surface carries it too.
//
// THE ACTION BUTTONS ARE RENDERED FROM `signal.allowed_actions`, WHICH THE
// SERVER COMPUTED. There is no list of actions in this file: p49's rule is
// that the client never invents or widens the action set, and a page that
// hard-coded four buttons and let the server sort it out would be inventing
// one — correctly today, and for exactly as long as nobody adds a fifth.

export default async function PlanningSignalPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireReviewAccess();
  const tenants = readableSignalTenants(user.role);
  if (tenants.length === 0) notFound();

  const signal = await getSignal(id, tenants, user.role);
  if (!signal) notFound();

  const lineage = await signalLineage(id, tenants, user.role);
  const history = await signalHistory(id, tenants);
  const explanations = await signalExplanations(signal, populationTenantIds());
  const def = rule(signal.signal_type);
  const state = stateDef(signal.state);
  const level = ladder(signal.evidence_level);

  const num = (v: unknown) => (typeof v === "number" ? String(Math.round(v * 1000) / 1000) : String(v));

  return (
    <ReviewPage
      title={`${signal.signal_type} — ${signal.cohort_ref}`}
      lede={state.entry}
      layer="evidence"
      here="/review/planning"
    >
      <div className="space-y-6">
        <p className="text-sm">
          <Link href="/review/planning" className="text-olive hover:underline">
            ← All planning signals
          </Link>
        </p>

        {/* p44 §1 — Statement */}
        <WithNote
          note={
            <Note
              title="What this is"
              tone="review"
              owner={`${PLANNING_OWNER.name} — thresholds ${THRESHOLD_VERSION}, approved ${PLANNING_OWNER.approvedAt}`}
              boundary={signal.required_phrase}
            >
              <p>
                Release level {signal.evidence_level} ({level.name}). Permitted wording:
                &ldquo;{level.permittedWording}&rdquo;. Decision use: {level.decisionUse}.
              </p>
            </Note>
          }
        >
          <Panel
            title="Statement"
            footnote={
              `Rule ${signal.rule_version} · dataset ${signal.data_version} · detected ${signal.detected_at}` +
              (signal.reading_point
                ? ` · read with the demo clock at the ${signal.reading_point.replace(/-/g, " ")}, not today`
                : "")
            }
          >
            <p className="measure text-ground">{signal.statement}</p>
            <p className="mt-3 text-xs text-olive">
              Current state: <span className="font-medium">{signal.state.replace(/_/g, " ")}</span> — {state.allowedActivity}.
            </p>
          </Panel>
        </WithNote>

        {/* p44 §2 — Why it fired */}
        <Panel
          title="Why it fired"
          footnote="Thresholds are policy configuration with a named owner and an approval date (p34). They are not constants in the rule."
        >
          <p className="measure mb-4 text-sm text-ground">{def.trigger}</p>
          <RecordRows
            rows={[
              { label: "Rule", value: `${def.id} — ${def.label}` },
              { label: "Recommended", value: def.output },
              ...Object.entries(signal.threshold).map(([k, v]) => ({
                label: `Threshold · ${k}`, value: num(v),
              })),
              ...Object.entries(signal.observed).map(([k, v]) => ({
                label: `Observed · ${k}`, value: num(v),
              })),
            ]}
          />
        </Panel>

        {/* p44 §3 — Population */}
        <Panel
          title="Population"
          footnote="The executable cohort definition, hashed. Eligibility is resolved before any group filter, so a group is never its own denominator."
        >
          <RecordRows
            rows={[
              { label: "Cohort", value: signal.cohort_ref },
              { label: "Hash", value: signal.cohort_hash },
              { label: "Compared with", value: signal.reference_ref },
              {
                label: "Question",
                value: lineage && "question" in lineage.cohort ? String(lineage.cohort.question) : "—",
              },
              {
                label: "Eligibility",
                value: lineage && "eligibility" in lineage.cohort
                  ? <code className="break-all text-xs">{JSON.stringify(lineage.cohort.eligibility)}</code>
                  : "—",
              },
              {
                label: "Group filters",
                value: lineage && "filters" in lineage.cohort
                  ? <code className="break-all text-xs">{JSON.stringify(lineage.cohort.filters)}</code>
                  : "—",
              },
            ]}
          />
        </Panel>

        {/* p44 §4 — Evidence */}
        <Panel
          title="Evidence"
          footnote="Lineage references point at the metric run behind each number. The full definitions and history are at the lineage endpoint below."
        >
          {signal.metric_refs.length === 0 ? (
            <p className="measure text-sm text-ground/90">
              This rule reads no metric run — its inputs are operational counts rather than a
              computed metric, so there is no lineage reference to follow.
            </p>
          ) : (
            <ul className="space-y-1 text-sm text-ground">
              {signal.metric_refs.map((m) => <li key={m}><code className="text-xs">{m}</code></li>)}
            </ul>
          )}
          <p className="mt-4 text-xs text-olive">
            <code>GET /api/planning/signals/{signal.signal_id}/lineage</code>
          </p>
        </Panel>

        {/* p44 §5 — Alternative explanations.
            COMPUTED, not listed. The first version of this section rendered
            the rule's static limitation strings, which are true, generic and
            useless: a reader who has decided what a signal means is not talked
            out of it by a disclaimer, only by a number. Each row below either
            found something or says it looked and did not. */}
        <Panel
          title="Alternative explanations"
          footnote="Stratified comparisons are level 2 on p36's ladder — observed within these strata. A difference that shrinks inside a stratum is an observation about that stratum, not a demonstration that it is the cause."
        >
          {explanations.length === 0 ? (
            <p className="measure text-sm text-ground/90">
              This signal&rsquo;s cohort is no longer in the registry, so the alternatives cannot be
              recomputed against it.
            </p>
          ) : (
            <ul className="divide-y divide-ground/10">
              {explanations.map((e) => (
                <li key={e.question} className="py-3">
                  <p className="text-sm font-medium text-app-ink">
                    <span
                      className={`mr-2 rounded-full px-2 py-0.5 text-xs ${
                        e.found ? "bg-state-caution-bg text-ground" : "bg-app-accent/50 text-olive"
                      }`}
                    >
                      {e.found ? "worth weighing" : "checked"}
                    </span>
                    {e.question}
                  </p>
                  <p className="measure mt-1 text-sm text-ground">{e.detail}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="measure mt-4 text-xs text-olive">
            The rule also records what it cannot rule out at all:{" "}
            {signal.limitations.join("; ")}.
          </p>
        </Panel>

        {/* p44 §6 — Fairness */}
        <Panel
          title="Fairness"
          footnote="Protected attributes are used here to audit access and verify representation. p36 prohibits race correction factors, and nothing on this screen ranks, grades or colour-codes a group."
        >
          <RecordRows
            rows={[
              {
                label: "Protected-group cohort",
                value: signal.signal_type === "FAIRNESS_ALERT" ? "Yes — this signal is a disparity finding" : "Reviewed as part of routing",
              },
              {
                label: "Fairness review",
                value: signal.fairness_review
                  ? `Recorded ${signal.fairness_review.at} by ${signal.fairness_review.role}`
                  : "Not yet recorded",
              },
              {
                label: "Clinical review",
                value: signal.clinical_review
                  ? `Recorded ${signal.clinical_review.at} by ${signal.clinical_review.role}`
                  : "Not yet recorded",
              },
            ]}
          />
        </Panel>

        {/* p44 §7 — Allowed next actions */}
        <Panel
          title="Allowed next actions"
          footnote="Supplied by the server after policy evaluation. The action posted back is re-checked against this same computation, so a request for an action that was not offered is refused rather than performed."
        >
          {signal.allowed_actions.length === 0 ? (
            <p className="measure text-sm text-ground/90">
              No action is available to this role in this state. {state.state === "retired"
                ? "A retired signal is read only: p35 permits no reactivation, only a new version."
                : "p50 gives this role read access to planning output and not its lifecycle."}
            </p>
          ) : (
            <form action={submitSignalReview} className="space-y-4">
              <input type="hidden" name="signalId" value={signal.signal_id} />
              <label className="block text-sm">
                <span className="font-medium text-app-ink">Comment</span>
                <textarea
                  name="comment"
                  rows={3}
                  className="mt-1 w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
                  placeholder="What you looked at, and what you concluded."
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-app-ink">Limits</span>
                <input
                  name="limits"
                  className="mt-1 w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
                  placeholder="Constraints a later pilot must respect."
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {signal.allowed_actions.map((a) => (
                  <button
                    key={a}
                    type="submit"
                    name="action"
                    value={a}
                    className="rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-app-ink hover:opacity-90"
                  >
                    {ACTION_LABELS[a]}
                  </button>
                ))}
              </div>
            </form>
          )}
        </Panel>

        {/* p44 §8 — Blocked actions.
            A section with its own heading, not a callout: p44 gives it a row
            in the detail table beside the allowed actions, and a reader should
            be able to find "what this cannot do" the same way they find
            everything else on the page. */}
        <Panel
          title="Blocked actions"
          footnote="These are not permissions nobody currently holds. They are things this subsystem does not do, listed so a reader can see they were considered and refused."
        >
          <ul className="measure list-disc space-y-2 pl-5 text-sm text-ground">
            {BLOCKED_ACTIONS.map((b) => (
              <li key={b}>
                <span className="font-medium text-app-ink">{b}</span> — {BLOCKED_ACTION_REASONS[b]}
              </li>
            ))}
          </ul>
        </Panel>

        {/* p44 §9 — Audit */}
        <Panel
          title="Audit"
          footnote="Every view, comment, state change and lineage fetch is written to the hash-chained audit log. This table is the state changes, readable without granting access to the log itself."
        >
          {history.length === 0 ? (
            <p className="measure text-sm text-ground/90">
              No state change has been recorded. The signal is in {signal.state.replace(/_/g, " ")},
              which it entered when the rule fired.
            </p>
          ) : (
            <ul className="divide-y divide-ground/10">
              {history.map((h) => (
                <li key={h.id} className="py-3">
                  <p className="text-sm text-ground">
                    <span className="font-medium">{h.action}</span> — {h.fromState.replace(/_/g, " ")} →{" "}
                    {h.toState.replace(/_/g, " ")}
                  </p>
                  <p className="text-xs text-olive">
                    {h.actorRole} · {h.createdAt}
                  </p>
                  {h.comment && <p className="measure mt-1 text-sm text-ground">{h.comment}</p>}
                  {h.limits && <p className="measure mt-1 text-sm text-ground">Limits: {h.limits}</p>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </ReviewPage>
  );
}
