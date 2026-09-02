import Link from "next/link";
import { ReviewPage } from "@/components/clinical/ReviewPage";
import { Panel, Note, WithNote, Callout } from "@/components/app/surfaces";
import { requireReviewAccess } from "@/lib/auth";
import { detectSignals, listSignals } from "@/lib/planning/service";
import { PLANNING_TENANT_ID, populationTenantIds, readableSignalTenants } from "@/lib/planning/scope";
import { REQUIRED_PHRASE } from "@/lib/planning/signal";
import { PLANNING_OWNER, RULE_VERSION } from "@/lib/planning/policy";
import { RULES } from "@/lib/planning/rules";
import { ladder, CURRENT_LEVEL } from "@/lib/planning/ladder";

export const dynamic = "force-dynamic";
export const metadata = { title: "Planning signals — Steady Review" };

// Planning signals (handoff 07 §3.4 p34, §3.5 p35, §4.5 p44).
//
// THE WITHHELD RULES ARE THE POINT OF THIS SCREEN, as much as the signals are.
// p34's table has a "no output when" column beside every rule, and a console
// that lists only what fired makes "no signal" and "the rule was suppressed
// because the cell is too small" look identical — which is how a reader
// concludes that a system found nothing when it was in fact unable to look.
//
// So this page shows both halves: what fired, and every rule that did not,
// with p34's own reason. Three of the seven produce nothing in this deployment
// and each one names the input it does not have.

export default async function PlanningSignalsPage() {
  const user = await requireReviewAccess();
  const tenants = readableSignalTenants(user.role);

  // Detection is idempotent — signal ids derive from the rule, the cohort and
  // the dataset version — so running it on a page load re-raises nothing and
  // adds nothing. A signal a reviewer has already moved keeps its state and
  // its frozen evidence.
  const detection = tenants.length > 0
    ? await detectSignals(populationTenantIds(), PLANNING_TENANT_ID, user.role)
    : null;
  const signals = tenants.length > 0 ? await listSignals(tenants, user.role) : [];

  const withheldByRule = new Map<string, { reason: string; count: number }>();
  for (const w of detection?.withheld ?? []) {
    const seen = withheldByRule.get(w.ruleId);
    if (seen) seen.count += 1;
    else withheldByRule.set(w.ruleId, { reason: w.reason, count: 1 });
  }

  return (
    <ReviewPage
      title="Planning signals"
      lede="Aggregate hypotheses raised by the deterministic rules, with the evidence behind each one and the rules that produced nothing."
      layer="evidence"
      here="/review/planning"
    >
      <div className="space-y-6">
        <Callout tone="review" label="What a planning signal is">
          <p className="measure">{REQUIRED_PHRASE}</p>
        </Callout>

        {tenants.length === 0 ? (
          <Panel title="Not available to this role">
            <p className="measure text-ground/90">
              Planning review is open to the reviewer and demo admin roles. p50 gives the
              organization and payer roles a subset view, and it is not built: every cohort
              declared so far spans several organizations, so there is nothing for a
              single-tenant subset to be a subset of.
            </p>
          </Panel>
        ) : detection?.releaseBlocked ? (
          <div role="alert" className="rounded-2xl border border-state-support/50 bg-state-support-bg/60 px-5 py-4">
            <p className="text-sm font-semibold text-ground">Planning release is blocked.</p>
            <p className="measure mt-1 text-sm text-ground">
              The DATA_QUALITY rule fired, and p34 marks it never bypassed. No other rule was
              evaluated: an environment that does not meet its own data-quality limits cannot
              release planning output computed from it.
            </p>
          </div>
        ) : null}

        {tenants.length > 0 && (
          <WithNote
            note={
              <Note
                title="Where these can and cannot go"
                tone="review"
                owner={`${PLANNING_OWNER.name} — thresholds approved ${PLANNING_OWNER.approvedAt}`}
                boundary="No signal here routes a person, changes a safety gate or restricts access. Those actions do not exist in this subsystem, and the planning code cannot reach the systems that hold them."
              >
                <p>
                  Every statement is at level {CURRENT_LEVEL} of p36&rsquo;s release ladder
                  ({ladder(CURRENT_LEVEL).name}), so the permitted wording is
                  &ldquo;{ladder(CURRENT_LEVEL).permittedWording}&rdquo; and nothing more.
                  Rule set {RULE_VERSION}.
                </p>
              </Note>
            }
          >
            <Panel
              title={`Signals (${signals.length})`}
              footnote="Evidence is frozen at detection. A later reading that disagrees is a new signal under a new dataset version, not an edit to this one."
            >
              {signals.length === 0 ? (
                <p className="measure text-sm text-ground/90">
                  No rule produced a signal on this dataset. That is an answer, not an empty
                  state — the table below says which rules were evaluated and which could not be.
                </p>
              ) : (
                <ul className="divide-y divide-ground/10">
                  {signals.map((s) => (
                    <li key={s.signal_id} className="py-3">
                      <Link
                        href={`/review/planning/${s.signal_id}`}
                        className="text-sm font-medium text-app-ink hover:underline"
                      >
                        {s.signal_type} — {s.cohort_ref}
                      </Link>
                      <p className="measure mt-1 text-sm text-ground">{s.statement}</p>
                      <p className="mt-1 text-xs text-olive">
                        State: {s.state.replace(/_/g, " ")} · rule {s.rule_version} · detected{" "}
                        {s.detected_at}
                        {/* Which reading point produced it. A milestone walk
                            leaves its findings behind, and without this they
                            sit in the list looking like today's. */}
                        {s.reading_point && (
                          <> · <span className="font-medium">read at the {s.reading_point.replace(/-/g, " ")}</span></>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </WithNote>
        )}

        {tenants.length > 0 && (
          <Panel
            title="Every rule, and what it did"
            footnote="p34's seven rules. The right-hand column is the rule's own no-output condition, evaluated against this deployment rather than described."
          >
            <ul className="divide-y divide-ground/10">
              {RULES.map((r) => {
                const fired = signals.filter((s) => s.signal_type === r.id).length;
                const w = withheldByRule.get(r.id);
                return (
                  <li key={r.id} className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr] sm:gap-4">
                    <div>
                      <p className="text-sm font-medium text-app-ink">{r.label}</p>
                      <p className="text-xs text-olive">{r.id}</p>
                    </div>
                    <div>
                      <p className="measure text-sm text-ground">{r.trigger}</p>
                      {/* BOTH HALVES, when there are both. A rule can fire on
                          one cohort and be withheld on another — REGION_CAPACITY
                          fires on a strained region and withholds on one whose
                          slot feed froze — and showing only the firing hides the
                          more interesting half. The first version did exactly
                          that and the stale-feed finding was invisible on the
                          screen built to surface it. */}
                      <p className="mt-1 text-xs text-olive">
                        {fired > 0
                          ? `${fired} signal${fired === 1 ? "" : "s"} — output: ${r.output}`
                          : w
                            ? `No output in ${w.count} cohort${w.count === 1 ? "" : "s"}: ${w.reason}`
                            : "Evaluated; the trigger did not hold."}
                      </p>
                      {fired > 0 && w && (
                        <p className="measure mt-1 text-xs text-olive">
                          No output in {w.count} other cohort{w.count === 1 ? "" : "s"}: {w.reason}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
      </div>
    </ReviewPage>
  );
}
