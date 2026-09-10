import { notFound } from "next/navigation";
import Link from "next/link";
import { requireClinician } from "@/lib/auth";
import { data } from "@/lib/data";
import { PLATFORM_TENANT_ID } from "@/lib/db";
import { audit } from "@/lib/audit";
import { loadPersonHeader } from "@/lib/clinical/person-header";
import { PersonShell } from "@/components/clinical/PersonShell";
import { Panel } from "@/components/app/surfaces";
import { TherapeuticLoadCard } from "@/components/clinical/TherapeuticLoadCard";
import { TherapeuticLoadReviewForm } from "@/components/clinical/TherapeuticLoadReviewForm";
import {
  computeTherapeuticLoad, loadReviewsForPerson, loadContext,
  LOAD_DECISION_LABEL, THERAPEUTIC_LOAD_POLICY,
} from "@/lib/clinical/therapeutic-load";
import type { TenantContext } from "@/lib/repository";

export const dynamic = "force-dynamic";
export const metadata = { title: "Load and readiness — Steady" };

// The therapeutic-load detail surface (expansion handoff 05 §8, §12 Phase 3).
//
// §8 asks for "load dimensions, capacity dimensions, safety constraint if any,
// recent recovery timeline, Response Fingerprint links, Return-to-Life links,
// trajectory links, limitations" — a page that shows its whole working, because
// the recommendation at the top is only worth anything if the reader can take
// it apart.
//
// THE ORDER ON THIS PAGE IS THE ORDER OF THE ALGORITHM (§6), and that is not a
// presentational choice. Safety first, and if safety is holding something the
// page stops there — §1: "if the safety engine blocks an activity, Therapeutic
// Load displays that external constraint and stops. It does not compute a
// workaround." A reader scrolling past a safety constraint to reach a load
// recommendation would be reading them as two opinions of equal standing.
//
// WHAT IS NOT ON THIS PAGE: a readiness score, a percentage, a gauge, a
// progress bar, or any other figure. §13: "no readiness number is displayed
// without explanation; preferred design is categorical evidence-backed state."
// The counts in the explanation are counts of NAMED findings, each of which
// opens its own evidence — not a total.
//
// AND NOTHING ON IT CHANGES ANYTHING. The six actions record a judgement. There
// is no button here that unlocks a module, alters a plan, or moves a gate,
// because §13 forbids the system from doing any of those autonomously and the
// safest way to keep that promise is for the capability not to exist.

const READING_LABEL: Record<string, string> = {
  high: "High",
  moderate: "Some",
  low: "Low",
  supportive: "Supports it",
  mixed: "Mixed",
  absent: "Not seen",
  not_established: "Not established",
};

export default async function MemberLoadPage({
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

  // Computed on read, stored when a clinician records a decision. A snapshot
  // written on every render would turn the table into a log of page views.
  const snapshot = await computeTherapeuticLoad(ctx, id);
  const context = loadContext(snapshot);
  const reviews = await loadReviewsForPerson(ctx, id);
  const latestReview = reviews[0] ?? null;

  await audit({
    actorId: clinician.id, actorRole: "clinician", family: "clinical",
    type: "therapeutic_load_opened", target: id,
    detail: { state: snapshot.state, policyVersion: snapshot.policyVersion },
  });

  return (
    <PersonShell person={header} active="/load" title="Load and readiness">
      <Panel title="How much the work appears to be costing, and what they are recovering from">
        <TherapeuticLoadCard
          personId={id}
          state={snapshot.state}
          bullets={context.bullets.map((b) => {
            const [label, ...rest] = b.split(": ");
            return { label, detail: rest.join(": ") };
          })}
          limitations={[]}
          policyVersion={snapshot.policyVersion}
          safetyHeadline={snapshot.safetyConstraint?.headline ?? null}
          safeAlternative={snapshot.safetyConstraint?.safeAlternative ?? null}
          href={`/clinician/member/${id}/safety`}
          linkLabel="Open the safety screen, where access is actually decided"
          boundary={false}
        />
        {/* On a safety hold the card above already carries the constraint in
            the safety engine's own words, and the panel below says why nothing
            else was computed. Repeating the explanation here said the same
            thing a third time on one screen — which is how a sentence that
            matters becomes one a reader learns to skip. */}
        {snapshot.state !== "blocked_by_safety" && (
          <ul className="mt-4 space-y-1">
            {snapshot.explanation.map((line) => (
              <li key={line} className="measure text-sm text-app-ink">{line}</li>
            ))}
          </ul>
        )}
        {snapshot.unavailable.length > 0 && (
          <p className="measure mt-3 text-xs text-olive">
            Could not read: {snapshot.unavailable.join(", ")}. This reading rests on a partial
            picture, and those inputs are missing because Steady could not load them rather than
            because there is nothing in them.
          </p>
        )}
        <div className="mt-4">
          {latestReview ? (
            <p className="measure text-xs text-olive">
              You recorded: {LOAD_DECISION_LABEL[latestReview.decision]}
              {latestReview.note ? ` — ${latestReview.note}` : ""} (
              {latestReview.createdAt.slice(0, 10)}). The reading is still shown as Steady computes
              it; recording a view of it did not change anything about this person&rsquo;s care.
            </p>
          ) : (
            <TherapeuticLoadReviewForm personId={id} />
          )}
        </div>
      </Panel>

      {/* §6's step 1, made visible: when safety is holding something there are
          no dimensions to show, because none were computed. Rendering an empty
          section instead would read as "nothing found". */}
      {snapshot.state === "blocked_by_safety" ? (
        <Panel title="Why there is nothing else here" className="mt-6">
          <p className="measure text-sm text-ground">
            Steady reads the safety decision first and stops. It has not computed load dimensions,
            capacity dimensions, or a recommendation, because a recommendation produced alongside a
            safety hold would be a second opinion about a question the safety engine has already
            answered.
          </p>
          <p className="mt-3 text-sm">
            <Link href={`/clinician/member/${id}/safety`} className="underline">
              Open the safety screen
            </Link>
          </p>
        </Panel>
      ) : (
        <>
          {snapshot.load.length > 0 && (
            <Panel title="What the work appears to be costing" className="mt-6">
              <p className="measure text-sm text-ground">
                {/* The seven dimensions, in the reader's words rather than by
                    section number. */}
                Seven separate readings, each on its own evidence. Nothing here is weighted or
                added up — &ldquo;not established&rdquo; means nobody has the evidence for that
                one, which is not the same as it coming back clear.
              </p>
              <ul className="mt-3 space-y-2">
                {snapshot.load.map((d) => (
                  <li key={d.key} data-testid="load-dimension" className="rounded-xl border border-ground/10 px-3 py-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-medium text-app-ink">{d.label}</span>
                      <span className="rounded-full bg-app-accent/40 px-2 py-0.5 text-xs text-app-ink">
                        {READING_LABEL[d.reading] ?? d.reading}
                      </span>
                    </div>
                    <p className="measure mt-1 text-xs text-olive">{d.detail}</p>
                    <p className="text-xs text-olive">
                      {d.evidenceIds.length} record{d.evidenceIds.length === 1 ? "" : "s"} behind
                      this.
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {snapshot.capacity.length > 0 && (
            <Panel title="What they appear to be recovering from it with" className="mt-6">
              <ul className="mt-1 space-y-2">
                {snapshot.capacity.map((d) => (
                  <li key={d.key} data-testid="capacity-dimension" className="rounded-xl border border-ground/10 px-3 py-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-medium text-app-ink">{d.label}</span>
                      <span className="rounded-full bg-app-accent/40 px-2 py-0.5 text-xs text-app-ink">
                        {READING_LABEL[d.reading] ?? d.reading}
                      </span>
                    </div>
                    <p className="measure mt-1 text-xs text-olive">{d.detail}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {snapshot.progressionBlockers.length > 0 && (
            <Panel title="What rules out a progression suggestion" className="mt-6">
              {/* §7's conservative rules, each named. A clinician who disagrees
                  with the reading should be able to see which rule produced it
                  rather than having to guess at a policy. */}
              <ul className="space-y-1">
                {snapshot.progressionBlockers.map((b) => (
                  <li key={b} className="measure text-sm text-app-ink">{b}</li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}

      <Panel title="Where the evidence lives" className="mt-6">
        <ul className="space-y-1 text-sm">
          <li>
            <Link href={`/clinician/member/${id}/sessions`} className="underline">Sessions and post-session checks</Link>
          </li>
          <li>
            <Link href={`/clinician/member/${id}/responses`} className="underline">Observed responses</Link>
          </li>
          <li>
            <Link href={`/clinician/member/${id}/trajectory`} className="underline">Recovery trajectory</Link>
          </li>
          <li>
            <Link href={`/clinician/member/${id}/goals`} className="underline">Life goals</Link>
          </li>
          <li>
            <Link href={`/clinician/member/${id}/safety`} className="underline">Safety — where access is decided</Link>
          </li>
        </ul>
        {snapshot.limitations.map((l) => (
          <p key={l} className="measure mt-3 text-xs text-olive">{l}</p>
        ))}
      </Panel>

      <Panel title="What this page does not do" className="mt-6">
        <ul className="measure space-y-2 text-sm text-ground">
          <li>
            It does not decide access. The safety engine does that, on its own deterministic rules,
            and nothing here can clear, weaken, bypass, or work around one of its decisions.
          </li>
          <li>
            It does not produce a readiness score. Every state is a phrase with named evidence
            under it; the counts in the explanation are counts of findings, not a total.
          </li>
          <li>
            It does not start, unlock, or schedule anything. &ldquo;Evidence to review whether the
            next step fits&rdquo; means there is enough here for you to look — not that Steady
            thinks somebody should be progressed.
          </li>
          <li>
            It does not initiate trauma reprocessing, and it cannot. That is outside this
            deployment&rsquo;s scope and outside this engine&rsquo;s reach.
          </li>
          <li>
            It does not treat a missing follow-up as a good one. A session nobody asked about is
            listed as unasked, under policy {THERAPEUTIC_LOAD_POLICY.version}.
          </li>
        </ul>
      </Panel>
    </PersonShell>
  );
}
