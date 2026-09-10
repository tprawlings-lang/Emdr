import { notFound } from "next/navigation";
import Link from "next/link";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import { audit } from "@/lib/audit";
import { loadPersonHeader } from "@/lib/clinical/person-header";
import { PersonShell } from "@/components/clinical/PersonShell";
import { Panel } from "@/components/app/surfaces";
import { RecoveryTrajectoryCard } from "@/components/clinical/RecoveryTrajectoryCard";
import { TrajectoryReviewForm } from "@/components/clinical/TrajectoryReviewForm";
import {
  computeTrajectory, trajectoryLine, reviewsForPerson,
  DOMAIN_META, stateLabelFor, stateNoteFor, TRAJECTORY_POLICY, policyFor,
} from "@/lib/clinical/recovery-trajectory";
import { REVIEW_LABEL } from "@/lib/clinical/recovery-trajectory";
import type { TenantContext } from "@/lib/repository";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recovery trajectory — Steady" };

// The recovery-trajectory detail surface (expansion handoff 04 §9, §12 Phase 3).
//
// §9 asks for "native-scale lanes, goal/function lane, care/safety rails, and a
// written explanation of the state", and Phase 3's definition of done is one
// sentence: "every state opens evidence."
//
// SO THE PAGE IS A LIST OF DOMAINS, NOT A VERDICT. There is no person-level
// state anywhere on it, and there is not going to be one — §1 refuses the
// composite score, and a headline reading "declining" over a page of separate
// lanes is that score with the arithmetic hidden. What the page has instead is
// §8's sentence, which names which domains moved and over what window, and
// leaves the reader to hold two facts at once.
//
// EVERY DOMAIN THAT REACHED A STATE IS LISTED, including the ones holding
// steady. A page showing findings alone would make every visit read as bad
// news; more to the point, §4 requires the disagreement be preserved, and the
// lanes that did not move are what make the one that did legible.
//
// THE LANES THAT COULD NOT BE COMPUTED ARE LISTED TOO, with what is missing.
// A domain absent from this page and a domain with a flat course look identical
// to a reader, and only one of them is a statement about the person.
//
// NOTHING HERE IS PATIENT-FACING. §9: "do not expose 'reversing' or 'off track'
// labels without a dedicated patient-language design. Clinician v1 only." This
// route is under /clinician and behind `requireClinician`, and the vocabulary
// on it is written for somebody who can open the evidence underneath it.

export default async function MemberTrajectoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const clinician = await requireClinician();
  const { id } = await params;
  const c = await data();

  const me = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  const tenantId = me?.tenant_id ?? PLATFORM_TENANT_ID;
  const ctx: TenantContext = { tenantId, personId: clinician.id };

  const header = await loadPersonHeader({ personId: id, clinicianId: clinician.id, tenantId });
  if (!header) notFound();

  // Computed on read, stored only when somebody acts. A snapshot written on
  // every render would turn the snapshot table into a log of page views, each
  // row with a slightly different cutoff, and §13's "reproducible from
  // evidence, cutoff, and policy version" would become true but useless.
  const set = await computeTrajectory(ctx, id);
  const reviews = await reviewsForPerson(ctx, id);
  const reviewBySnapshot = new Map(reviews.map((r) => [r.snapshotId, r]));

  const stated = set.snapshots.filter((s) => s.state !== "insufficient_data");
  const uncomputed = set.snapshots.filter((s) => s.state === "insufficient_data");

  await audit({
    actorId: clinician.id, actorRole: "clinician", family: "clinical",
    type: "recovery_trajectory_opened", target: id,
    // Counts and versions only. A domain name is a clinical label, and §18
    // keeps those out of anything that leaves the record.
    detail: {
      domains: set.snapshots.length,
      stated: stated.length,
      policyVersion: set.policyVersion,
    },
  });

  return (
    <PersonShell person={header} active="/trajectory" title="Recovery trajectory">
      {/* The boundary sentence is the card's, printed once. This page also
          closes with "What this page does not do", and a screen that states
          its limits three times in three places teaches the reader to skip
          all three. */}
      <Panel title="What has changed, domain by domain">
        <RecoveryTrajectoryCard
          personId={id}
          line={trajectoryLine(set)}
          policyVersion={set.policyVersion}
          rows={stated.map((s) => ({
            domainType: s.domainType,
            domainKey: s.domainKey,
            label: s.label,
            state: s.state,
            headline: s.classification.explanation[0] ?? "",
            limitations: s.classification.limitations,
          }))}
          emptyNote={
            stated.length > 0
              ? null
              : set.snapshots.length === 0
                ? "Nothing has been recorded for this person that a trajectory could be computed from — no check-ins, no scored measures, no goal observations. That is a fact about the record, not about their course."
                : `${set.snapshots.length} domain${set.snapshots.length === 1 ? " has" : "s have"} readings, none with enough comparable observations yet. Nothing here says the course is flat.`
          }
          href={`/clinician/member/${id}/record`}
          linkLabel="Open the longitudinal record these were read from"
        />
        {set.unavailable.length > 0 && (
          <p className="measure mt-3 text-xs text-olive">
            {/* Partial coverage said out loud. A page missing a lane it could
                not read looks exactly like a person with a thinner record. */}
            Could not read: {set.unavailable.join(", ")}. Those domains are missing from this page
            because Steady could not load them, not because there is nothing in them.
          </p>
        )}
      </Panel>

      {/* Every state opens its evidence and its window — Phase 3's whole
          definition of done. One disclosure per domain rather than a wall of
          numbers: the reader who wants the calculation can have it, and the
          reader who does not is not made to scroll past it. */}
      {stated.length > 0 && (
        <div className="mt-6 space-y-4">
          {stated.map((s) => {
            const spec = policyFor(s.domainType, s.domainKey);
            const review = reviewBySnapshot.get(s.id);
            const cls = s.classification;
            return (
              <Panel key={s.id} title={`${s.label} — ${stateLabelFor(s.domainType, s.state)}`}>
                <p className="measure text-sm text-ground">{stateNoteFor(s.domainType, s.state)}</p>
                <p className="text-xs text-olive">
                  {DOMAIN_META[s.domainType].label} · {DOMAIN_META[s.domainType].note}
                </p>

                <ul className="mt-3 space-y-1">
                  {cls.explanation.map((line) => (
                    <li key={line} className="measure text-sm text-app-ink">{line}</li>
                  ))}
                </ul>

                <details className="mt-3 rounded-2xl border border-ground/10 bg-linen px-4 py-3">
                  <summary className="cursor-pointer text-sm text-app-ink">
                    The windows this was computed from
                  </summary>
                  <div className="mt-3 space-y-2 text-xs text-ground">
                    <p>
                      Window length {spec?.windowDays ?? "—"} days · at least{" "}
                      {spec?.minObservations ?? "—"} observations spanning{" "}
                      {spec?.minSpanDays ?? "—"} days · meaningful change{" "}
                      {spec?.meaningfulDelta ?? "—"} on the {s.unit} scale · noise below{" "}
                      {spec?.noiseDelta ?? "—"}.
                    </p>
                    <p>
                      Recent window {cls.current.from.slice(0, 10)} to {cls.current.to.slice(0, 10)}:{" "}
                      {cls.current.n} observation{cls.current.n === 1 ? "" : "s"}
                      {cls.current.median !== null && `, middle reading ${cls.current.median}`}
                      {cls.current.min !== null && `, between ${cls.current.min} and ${cls.current.max}`}.
                    </p>
                    {cls.comparison ? (
                      <p>
                        Window before, {cls.comparison.from.slice(0, 10)} to{" "}
                        {cls.comparison.to.slice(0, 10)}: {cls.comparison.n} observation
                        {cls.comparison.n === 1 ? "" : "s"}
                        {cls.comparison.median !== null && `, middle reading ${cls.comparison.median}`}.
                      </p>
                    ) : (
                      <p>There is no comparable window before this one.</p>
                    )}
                    {cls.limitations.map((l) => (
                      <p key={l} className="measure text-olive">{l}</p>
                    ))}
                    <p className="text-olive">
                      {cls.current.evidenceIds.length} record
                      {cls.current.evidenceIds.length === 1 ? "" : "s"} in the recent window, under
                      policy {s.policyVersion}, as of {s.evidenceCutoff.slice(0, 19).replace("T", " ")}.
                    </p>
                    <p>
                      <Link href={`/clinician/member/${id}/record`} className="underline">
                        Open the longitudinal record
                      </Link>
                      {s.domainType === "function" && (
                        <>
                          {" · "}
                          <Link href={`/clinician/member/${id}/goals`} className="underline">
                            Open the goal
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                </details>

                {/* §5's review. A disagreement is recorded BESIDE the state, not
                    over it — the state stays on the page, which is the point:
                    the record should show that Steady read it this way and that
                    a clinician did not agree. */}
                {review ? (
                  <p className="measure mt-3 text-xs text-olive">
                    You recorded: {REVIEW_LABEL[review.reviewState]}
                    {review.note ? ` — ${review.note}` : ""} ({review.createdAt.slice(0, 10)}).
                    The state is still shown as Steady computes it.
                  </p>
                ) : (
                  <div className="mt-3">
                    <TrajectoryReviewForm personId={id} snapshotId={s.id} />
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}

      {uncomputed.length > 0 && (
        <Panel title="Domains with readings but nothing to compare" className="mt-6">
          <p className="measure text-sm text-ground">
            These have data and no state. That is a statement about how much has been recorded, not
            about whether anything is moving.
          </p>
          <ul className="mt-3 space-y-2">
            {uncomputed.map((s) => (
              <li key={s.id} className="measure text-sm text-app-ink">
                <span className="font-medium">{s.label}</span>{" "}
                <span className="text-xs text-olive">{DOMAIN_META[s.domainType].label}</span>
                <span className="block text-xs text-olive">
                  {s.classification.explanation[0] ?? ""}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="What this page does not do" className="mt-6">
        <ul className="measure space-y-2 text-sm text-ground">
          <li>
            It does not produce a recovery score. There is no number here that combines two
            domains, because no exchange rate exists between sleeping better and going out less.
          </li>
          <li>
            It does not predict anything. Every state describes readings that have already been
            recorded, which is what makes it something you can open and disagree with.
          </li>
          <li>
            It does not say why anything moved. Things that happened in the same period are
            context, and context is not cause.
          </li>
          <li>
            It does not compare this person to anyone else. Every window here is their own earlier
            course, under policy {TRAJECTORY_POLICY.version}.
          </li>
          <li>
            It does not decide safety. Safety stops are decided by rules on the safety screen and
            nothing on this page can change, clear, or add to them.
          </li>
        </ul>
      </Panel>
    </PersonShell>
  );
}
