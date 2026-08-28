import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { activePolicy } from "@/lib/clinical-policy";
import { memberTimeline } from "@/lib/clinical/timeline";
import { buildSummary, summaryCoverageNote } from "@/lib/clinical/summary";
import { buildWorkQueue } from "@/lib/clinical/work-queue";
import { gateDecisionsFor, groupGateDecisions, overrideAllowed } from "@/lib/clinical/gate-review";
import { gateOverrideAction } from "@/lib/clinical/actions";
import { GateReviewDrawer } from "@/components/clinical/GateReviewDrawer";
import { MODULES } from "@/lib/modules";
import { WorkQueueRow } from "@/components/clinical/WorkQueueRow";
import {
  PriorityBadge, FreshnessLabel, OwnerChip, ReviewBadge, EmptyState,
} from "@/components/clinical/primitives";

// Person overview (GUI and Decision-Surface Handoff §10.4).
//
// The existing person record holds the right material but stacks it in one
// vertical flow, which §3.2 names precisely: "decisions, evidence, corrections,
// and audit compete." §10.4's answer is a sticky header that always says who
// this is and what is true now, a main column that opens on change rather than
// on records, and a right rail of allowed actions.
//
// It does not duplicate the deep views. Timeline, audit, and trajectory already
// exist and are linked; this page's job is the first thirty seconds — who,
// what changed, what is mine to do — not to be a second copy of the record.

export const dynamic = "force-dynamic";

export default async function PersonOverviewPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { id } = await params;
  const { done, error } = await searchParams;
  const clinician = await requireClinician();
  const c = await data();

  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? "";

  // Tenant-scoped read. A person outside this tenant is not found rather than
  // forbidden — §20.3: "Cross-tenant and unauthorized person requests return no
  // record detail", and a 403 confirms the record exists.
  const person = (await c.get(
    "SELECT id, name, tenant_id FROM users WHERE id = ? AND tenant_id = ? AND role = 'member'",
    [id, tenantId]
  )) as { id: string; name: string } | undefined;
  if (!person) notFound();

  const policy = activePolicy();
  const [queue, timeline, consent] = await Promise.all([
    buildWorkQueue({ clinicianId: clinician.id, tenantId, policy }),
    memberTimeline(person.id, { policy }),
    // Revoked consent must not read as consent, so revoked_at is filtered
    // rather than merely displayed — the header states a boundary the clinician
    // acts on, not a history of one.
    c.get(
      "SELECT granted_at FROM consents WHERE user_id = ? AND revoked_at IS NULL ORDER BY granted_at DESC LIMIT 1",
      [person.id]
    ) as Promise<{ granted_at: string } | undefined>,
  ]);

  // Gate decisions for every module, worst state first — the binding
  // constraint rather than the alphabetically-first module.
  const gates = await gateDecisionsFor({
    personId: person.id,
    moduleIds: MODULES.map((m) => m.id),
    policy,
  });

  const gateGroups = groupGateDecisions(gates);

  const summary = buildSummary(timeline);
  const mine = queue.items.filter((i) => i.personId === person.id);
  const head = mine[0] ?? null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      {/* ---- Sticky header (§10.4): identity, owner, state, freshness,
              consent boundary, contact. Sticky because these are the facts a
              clinician must not lose while scrolling a record — particularly
              the consent boundary, which governs what they may do next. ---- */}
      <header className="sticky top-0 z-10 -mx-6 border-b border-ground/10 bg-ivory/95 px-6 py-4 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="type-display text-2xl font-medium text-ground">{person.name}</h1>
              {head ? <PriorityBadge band={head.band} /> : <PriorityBadge band="none" />}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <OwnerChip name={head?.ownerName ?? null} />
              <FreshnessLabel evidenceAt={head?.evidenceAt ?? null} now={queue.computedAt} />
              {/* Consent is a boundary, so it is stated either way rather than
                  shown only when present. */}
              <span
                className={`text-xs font-medium ${consent ? "text-state-safe" : "text-state-caution"}`}
              >
                {consent ? "◆ Consent active" : "○ No consent on record"}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Link
              href={`/clinician/member/${person.id}/record`}
              className="rounded-full bg-ground px-4 py-2 text-sm font-medium text-ivory hover:bg-ground/90"
            >
              Full record
            </Link>
          </div>
        </div>
      </header>

      {/* §15.3: the mutation's result is rendered from what came back, never
          patched in optimistically by the control that submitted it. */}
      {done === "overridden" && (
        <p className="mt-4 rounded-2xl border border-state-safe/40 bg-state-safe-bg/50 px-4 py-3 text-sm text-ground">
          Override recorded with its reason and appended to this person&apos;s audit history.
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-2xl border border-state-support/40 bg-state-support-bg/50 px-4 py-3 text-sm text-ground">
          {error}
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-6">
          {/* ---- Since your last review (§10.4) ---- */}
          <section aria-labelledby="since" className="rounded-3xl border border-ground/10 bg-linen p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="since" className="type-display text-lg font-medium text-ground">
                Since your last review
              </h2>
              {/* §9.3: model-produced content is labelled by state, never by a
                  sparkle, and never styled like a system fact. This summary is
                  deterministic and citation-validated, so it is "evidence
                  checked" rather than "reviewed" — no human has approved it. */}
              <ReviewBadge state="validated" />
            </div>

            {summary.claims.length === 0 ? (
              <p className="mt-3 text-sm text-olive">
                No claim in the window met the citation contract. The timeline remains the record.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {summary.claims.map((claim, n) => (
                  <li key={n} className="text-sm text-ground/90">
                    {claim.text}{" "}
                    {/* Every claim opens its evidence (§20.3: "Person summary
                        claims open their cited evidence"). */}
                    <Link
                      href={`/clinician/member/${person.id}/record#timeline`}
                      className="text-xs text-state-info underline"
                    >
                      {claim.citations.length} cited
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {/* Omitted claims are surfaced, not swallowed — a suppressed claim
                is information about the generator. */}
            {summary.omitted.length > 0 && (
              <p className="mt-3 text-xs text-state-caution">
                {summary.omitted.length} generated claim(s) failed validation and were withheld.
              </p>
            )}
            <p className="mt-3 text-xs text-olive">{summaryCoverageNote(summary)}</p>
          </section>

          {/* ---- Active work ---- */}
          <section aria-labelledby="work">
            <h2 id="work" className="type-display text-lg font-medium text-ground">
              Active work{" "}
              <span className="text-base font-normal text-olive">({mine.length})</span>
            </h2>
            {mine.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  kind="clear"
                  title="No open work for this person"
                  detail={`The queue ran at ${queue.computedAt} under policy ${queue.policyVersion} and found nothing open. This is an empty result, not a failed load.`}
                />
              </div>
            ) : (
              <ul className="mt-3 overflow-hidden rounded-3xl border border-ground/10 bg-linen">
                {mine.map((i) => (
                  <WorkQueueRow key={i.id} item={i} now={queue.computedAt} hidePerson />
                ))}
              </ul>
            )}
          </section>

          {/* ---- Gate review (§9.2) ---- */}
          <section aria-labelledby="gates">
            <h2 id="gates" className="type-display text-lg font-medium text-ground">
              Gate review
            </h2>
            <p className="mt-1 text-sm text-olive">
              Every module decision for this person, most constrained first. Each drawer shows
              the rule, its evidence, the prior decision, and the sentence the member sees.
            </p>
            <div className="mt-3 space-y-2">
              {gateGroups.map((g) => (
                <GateReviewDrawer
                  key={g.decision.moduleId}
                  decision={g.decision}
                  moduleNames={g.moduleNames}
                  // Decided on the server. §15.2: a safety-stop override is not
                  // rendered at all, so the question is answered before the
                  // control is drawn rather than after it is pressed.
                  canOverride={overrideAllowed(g.decision)}
                  overrideAction={gateOverrideAction}
                />
              ))}
            </div>
          </section>
        </div>

        {/* ---- Right rail (§10.4): allowed actions, safety plan, team ---- */}
        <aside className="space-y-4">
          <div className="rounded-3xl border border-ground/10 bg-linen p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-olive">Allowed actions</h2>
            <div className="mt-2 flex flex-col gap-2">
              <Link href={`/clinician/member/${person.id}/record`} className="text-sm text-state-info underline">
                Review summary and record
              </Link>
              <Link href={`/clinician/member/${person.id}/record#timeline`} className="text-sm text-state-info underline">
                Unified timeline
              </Link>
              <Link href={`/review/audit?person=${person.id}`} className="text-sm text-state-info underline">
                Audit history
              </Link>
            </div>
            {/* §15.2 is explicit that an attempted safety-stop override does not
                render at all. Not disabled — absent. A disabled control teaches
                that the override exists and is merely unavailable today. */}
            <p className="mt-3 border-t border-ground/10 pt-3 text-xs text-olive">
              Ordinary overrides relax pacing only. A safety stop cannot be overridden and is
              not offered as an action.
            </p>
          </div>

          <div className="rounded-3xl border border-ground/10 bg-linen p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-olive">Care context</h2>
            <dl className="mt-2 space-y-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-olive">Owner</dt>
                <dd className="text-ground">{head?.ownerName ?? "Unassigned"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-olive">Caseload model</dt>
                <dd className="text-ground">{policy.caseload}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-olive">Policy</dt>
                <dd className="text-ground">{queue.policyVersion}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </main>
  );
}
