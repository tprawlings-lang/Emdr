import Link from "next/link";
import { ClinicalFigure, PresenceStrip } from "@/components/charts/clinical";
import { buildEngagement } from "@/lib/clinical/engagement";
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
import { PersonShell } from "@/components/clinical/PersonShell";
import { SessionPrepPanel } from "@/components/clinical/SessionPrepPanel";
import { ReturnToLifeCard, type GoalCardRow } from "@/components/clinical/ReturnToLifeCard";
import {
  ResponseFingerprintCard, type FingerprintCardRow,
} from "@/components/clinical/ResponseFingerprintCard";
import { computeFingerprints, displayable } from "@/lib/clinical/response-fingerprint";
import { computeTrajectory, trajectoryLine } from "@/lib/clinical/recovery-trajectory";
import { RecoveryTrajectoryCard, type TrajectoryCardRow } from "@/components/clinical/RecoveryTrajectoryCard";
import { CLASS_LABEL } from "@/lib/clinical/intervention-vocabulary";
import { goalProjection } from "@/lib/clinical/return-goal-projection";
import type { TenantContext } from "@/lib/repository";
import { listGoals } from "@/lib/clinical/return-to-life";
import { buildSessionPrep } from "@/lib/clinical/session-prep";
import { thoughtsSurfaceAvailable } from "@/lib/clinical/thoughts-flags";
import { loadPersonHeader } from "@/lib/clinical/person-header";
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

  const personHeader = await loadPersonHeader({ personId: id, clinicianId: clinician.id, tenantId });
  if (!personHeader) notFound();

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
  // §30.2 puts engagement in a person's current state, beside daily state,
  // symptom and function. It sits above active work because "have they been
  // here" changes how everything below it reads.
  const engagement = await buildEngagement(id, tenantId);

  const ctx: TenantContext = { tenantId, personId: clinician.id };

  // The projection deliberately carries no patient-authored text (§12), so the
  // card's titles are read from the store. Two reads rather than widening the
  // projection: a downstream engine must not receive these strings.
  const goalTitles = new Map(
    (await listGoals(ctx, id, ["active"])).map((g) => [g.id, g.title])
  );

  // Return-to-Life goals (expansion handoff 01 §9): the compact card. Read
  // through the projection rather than the store, so the overview and the
  // downstream engines see the same shape — and so a card cannot accidentally
  // render a proposed observation as a level.
  const goalSet = await goalProjection(ctx, id, { statuses: ["active"] }).catch((err) => {
    console.error("goal projection failed (non-fatal):", err);
    return null;
  });
  // The fingerprint is computed from evidence already on file; nothing is
  // synced here. The overview is a reading surface, and a page that rebuilt the
  // instance timeline on every clinician glance would make a read into a write.
  const fingerprints = await computeFingerprints(ctx, id);
  // The trajectory card (§9). Guarded on its own: the overview must survive one
  // subsystem being unreadable, and a person's record page going blank is a far
  // worse failure than a missing card.
  let trajectoryRows: TrajectoryCardRow[] = [];
  let trajectorySentence: string | null = null;
  let trajectoryPolicyVersion = "";
  try {
    const set = await computeTrajectory(ctx, id);
    trajectorySentence = trajectoryLine(set);
    trajectoryPolicyVersion = set.policyVersion;
    trajectoryRows = set.snapshots
      .filter((s) => s.state !== "insufficient_data")
      .map((s) => ({
        domainType: s.domainType,
        domainKey: s.domainKey,
        label: s.label,
        state: s.state,
        headline: s.classification.explanation[0] ?? "",
        limitations: s.classification.limitations,
      }));
  } catch (err) {
    console.error("member overview: trajectory failed:", err instanceof Error ? err.name : "unknown");
  }
  const shown = displayable(fingerprints);
  const withheldFingerprints = fingerprints.length - shown.length;
  const fingerprintRows: FingerprintCardRow[] = shown.slice(0, 3).map((f) => ({
    definitionId: f.definition.id,
    displayName: f.definition.displayName,
    classLabel: CLASS_LABEL[f.definition.interventionClass],
    patternState: f.patternState,
    supportCount: f.supportCount,
    missingFollowupCount: f.missingFollowupCount,
    mixedCount: f.mixedCount,
  }));

  const goalRows: GoalCardRow[] = (goalSet?.goals ?? []).map((g) => {
    const latest = g.levels[g.levels.length - 1] ?? null;
    const prior = g.levels.length >= 2 ? g.levels[g.levels.length - 2] : null;
    return {
      goalId: g.goalId,
      title: goalTitles.get(g.goalId) ?? "This goal",
      domain: g.domain,
      currentLevel: g.currentLevel,
      currentDescription: latest ? g.targetDescription : null,
      latest: latest ? { occurredAt: latest.occurredAt, evidenceClass: latest.evidenceClass as never } : null,
      pendingCount: g.pendingCount,
      changeSinceReview:
        prior && latest
          ? latest.level === prior.level
            ? "no change since the previous reading"
            : latest.level > prior.level
              ? "moved up since the previous reading"
              : "moved down since the previous reading"
          : null,
    };
  });

  // Session Prep (§11). Behind its own flag, and its failure never takes the
  // overview down: a brief is an aid to the record, and a record that will not
  // load because its summary threw is a worse trade than a page with no brief.
  const sessionPrep = thoughtsSurfaceAvailable("CLINICIAN_SESSION_PREP")
    ? await buildSessionPrep({ tenantId, personId: clinician.id }, id).catch((err) => {
        console.error("session prep failed (non-fatal):", err);
        return null;
      })
    : null;
  const head = mine[0] ?? null;

  return (
    <PersonShell person={personHeader} active="">
      {/* ---- Sticky header (§10.4): identity, owner, state, freshness,
              consent boundary, contact. Sticky because these are the facts a
              clinician must not lose while scrolling a record — particularly
              the consent boundary, which governs what they may do next. ---- */}
      {/* The sticky header lived here first; PersonShell was extracted from
          it so the other five tabs could carry the same facts. Keeping a second
          copy is how the two would drift — a consent boundary shown on one tab
          and not the next. */}

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

      {/* Session Prep (§11) sits at the TOP of the overview and above "since
          your last review", because it is what a clinician reads in the minute
          before a session — placing it below the record would mean scrolling
          past the record to reach the thing that summarises it. */}
      {goalRows.length > 0 && (
        <div className="mt-6">
          <ReturnToLifeCard personId={id} goals={goalRows} />
        </div>
      )}

      {/* Observed responses (§9). Beside the life goals rather than under the
          record, because the question it answers — what has tended to help this
          person — is read before a session, not looked up during one. It is
          rendered only when there is something to say: an empty card on every
          overview teaches a clinician to stop reading the space. */}
      {(fingerprintRows.length > 0 || withheldFingerprints > 0) && (
        <div className="mt-6">
          <ResponseFingerprintCard
            personId={id}
            rows={fingerprintRows}
            withheldCount={withheldFingerprints}
          />
        </div>
      )}

      {/* Recovery trajectory (handoff 04 §9's "compact trajectory card with
          domain badges and a longitudinal chart link"). After the responses,
          because it is the layer above them: it reads the measures, the goals
          and the session record and says whether the course has changed.
          Rendered only when a domain reached a state — an empty card on every
          overview teaches a clinician to stop reading the space, and there is a
          screen that explains the emptiness properly when they want it. */}
      {trajectoryRows.length > 0 && (
        <div className="mt-6">
          <RecoveryTrajectoryCard
            personId={id}
            rows={trajectoryRows}
            line={trajectorySentence}
            policyVersion={trajectoryPolicyVersion}
            emptyNote={null}
          />
        </div>
      )}

      {sessionPrep && (
        <div className="mt-6">
          <SessionPrepPanel prep={sessionPrep} personId={id} />
        </div>
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

          {/* ---- Engagement (§29's clinician inventory) ---- */}
          {engagement && (
            <section aria-labelledby="engagement">
              <h2 id="engagement" className="type-display text-lg font-medium text-ground">
                Engagement
              </h2>
              <div className="mt-3 rounded-3xl border border-ground/10 bg-linen p-5">
                <ClinicalFigure
                  title="Days present, most recent last"
                  summary={`Check-in and session days across the last ${engagement.windowDays} days: ${engagement.checkedInDays} of ${engagement.availableDays} enrolled days with a check-in and ${engagement.sessionDays} with a session.`}
                  footnote={[
                    `Last ${engagement.windowDays} days.`,
                    `${engagement.checkedInDays} of ${engagement.availableDays} enrolled days carry a check-in; ${engagement.sessionDays} carry a session.`,
                    engagement.partialWindow
                      ? `This person's record began part-way through the window, so ${engagement.availableDays} of the ${engagement.windowDays} days were available to them.`
                      : null,
                    "Days present, not adherence. No rate is computed and no threshold applies.",
                  ].filter(Boolean).join(" ")}
                >
                  <PresenceStrip days={engagement.days} />

                  <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-sm">
                    <p className="text-ground">
                      <span className="text-olive">Last check-in</span>{" "}
                      {engagement.daysSinceCheckIn === null
                        ? "never"
                        : engagement.daysSinceCheckIn === 0
                          ? "today"
                          : `${engagement.daysSinceCheckIn} d ago`}
                    </p>
                    {engagement.longestGap && engagement.longestGap.days > 1 && (
                      <p className="text-ground">
                        <span className="text-olive">Longest gap</span>{" "}
                        {engagement.longestGap.days} days
                        <span className="text-olive">
                          {" "}({engagement.longestGap.from} to {engagement.longestGap.to})
                        </span>
                      </p>
                    )}
                  </div>

                  {/* The interpretive load this chart carries, said once, on
                      the screen. A clinician reading a gap as non-compliance
                      is the failure mode; the person least likely to check in
                      is often the one having the hardest time. */}
                  <p className="measure mt-4 border-t border-ground/10 pt-3 text-sm text-olive">
                    A gap is a reason to ask, not a compliance failure. Members are asked to
                    check in on the days they can, and the person least able to is often the
                    one having the hardest week.
                  </p>
                </ClinicalFigure>
              </div>
            </section>
          )}

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
    </PersonShell>
  );
}
