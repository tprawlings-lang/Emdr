import Link from "next/link";
import { ReviewPage } from "@/components/clinical/ReviewPage";
import { Panel, Note, WithNote, Callout } from "@/components/app/surfaces";
import { requireReviewAccess } from "@/lib/auth";
import { readServiceStatus } from "@/lib/site/service-status";
import { demoHealth } from "@/lib/demo-reset";
import { getDb } from "@/lib/db";
import { DEMO_SEED_VERSION } from "@/lib/demo-seed";
import { DATASET_VERSION } from "@/lib/demo-population-manifest";
import { RULE_VERSION, THRESHOLD_VERSION } from "@/lib/planning/policy";
import { SAFETY_CONFIG_VERSION } from "@/lib/safety/governance";
import { POLICY_REGISTRY } from "@/lib/clinical/policy-registry";
import {
  ALL_COMMAND_CENTER_FLAGS, commandCenterFlagEnabled,
  commandCenterSurfaceAvailable, commandCenterFlagRequires,
} from "@/lib/clinical/command-center-flags";
import { registeredProviders } from "@/lib/clinical/attention-providers/registry";
import "@/lib/clinical/attention-providers/providers";
import { PROVIDER_CONTRACT_VERSION } from "@/lib/clinical/attention-providers/contract";
import {
  ROUTE_REGISTER, RECONCILED, PROMOTED_UNAVAILABLE, byState, stateCounts,
  REGISTER_DATE, REGISTER_COMMIT, SOURCE_BASELINE, STATE_LABEL, STATE_NOTE,
  type CapabilityState,
} from "@/lib/app/route-register";
import { MEMBER_SCORE_EXCEPTION } from "@/lib/experience/member-projection";
import { AWAITING_CLINICAL_REVIEW, mayEnterTaskQueue } from "@/lib/clinical/clinical-review-gate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Service status — Steady Review" };

// Service status (§26 p44: "/review/status — See health and safe fallback —
// service health, version, degradation and the safe fallback").
//
// EVERYTHING HERE IS MEASURED, and none of it is new measurement. The two
// sources already existed and are used unchanged: `readServiceStatus()` probes
// the database and reports what a member can and cannot do, and `demoHealth()`
// checks the environment's own invariants. This screen is the reviewer's read
// of both, in one place, with the versions that say WHICH build produced them.
//
// A status page listing hand-written rows of "operational" is a claim about a
// system by somebody who was not looking at it. That is why nothing on this
// page is a constant except the version strings, which are the one thing that
// genuinely is one.
//
// WHAT A REVIEWER IS BEING ASKED. Not "is it up" — a reviewer can see that
// from the fact that this rendered. It is: when something IS down, does this
// product fail into a safe place, and does it say so honestly? So the safe
// fallback is stated as prominently as the health, and the two functions that
// must survive every failure are named as such rather than left to be inferred
// from a row of green.

export default async function ReviewStatusPage() {
  const user = await requireReviewAccess();
  const status = await readServiceStatus();
  const health = demoHealth(getDb());

  return (
    <ReviewPage
      layer="evidence"
      here="/review/status"
      title="Service status"
      lede="What is working now, what a person can still reach if it is not, and which build produced this answer."
    >
      <div className="space-y-6">
        {status.degraded && (
          <Callout tone="caution" label="Something is not fully available">
            <p className="measure">
              The rows below say which functions, and what a person can do instead. Grounding
              and crisis resources are not among them and cannot be: they render without an
              account, a network round-trip or a database.
            </p>
          </Callout>
        )}

        <WithNote
          note={
            <Note
              tone="info"
              title="What this page is not"
              owner={user.name}
              boundary="Measured at the moment you loaded it, not monitored. A function reading available here was available for one probe, which is not the same as an uptime record."
            >
              <p>
                Each row is probed rather than asserted. A status page listing hand-written
                rows of &ldquo;operational&rdquo; is a claim about a system by somebody who
                was not looking at it.
              </p>
            </Note>
          }
        >
          <Panel
            title="Functions"
            footnote={`Checked ${status.checkedAt}. Two rows are marked always available: grounding and crisis must survive a write, subscription, sync or service failure, so a build in which either could read as blocked would mean that requirement had already been broken somewhere else.`}
          >
            <ul className="divide-y divide-ground/5">
              {status.functions.map((f) => (
                <li key={f.name} className="grid gap-1 py-3 sm:grid-cols-[14rem_1fr] sm:gap-4">
                  <div>
                    <span className="text-sm font-medium text-app-ink">{f.name}</span>
                    {f.alwaysAvailable && (
                      <span className="mt-0.5 block text-xs text-state-safe">
                        Must survive every failure
                      </span>
                    )}
                  </div>
                  <div>
                    {/* The state in a word AND a glyph, never colour alone. */}
                    <span
                      className={`text-sm font-medium ${
                        f.state === "available"
                          ? "text-state-safe"
                          : f.state === "degraded"
                            ? "text-state-caution"
                            : "text-state-support"
                      }`}
                    >
                      <span aria-hidden>
                        {f.state === "available" ? "◆" : f.state === "degraded" ? "○" : "▲"}
                      </span>{" "}
                      {f.state}
                    </span>
                    <p className="measure mt-0.5 text-sm text-ground">{f.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </WithNote>

        <Panel
          title="The safe fallback"
          footnote="Reachable from here, and from every screen in the product, whatever else is failing."
        >
          <p className="measure text-sm text-ground">
            When something is down, the product does not present a blank screen or a spinner
            that never resolves. It says which function is affected, what is still reachable,
            and it keeps grounding and crisis open — because those are the two that must not
            depend on anything.
          </p>
          <p className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/status/degraded" className="text-sm font-medium text-state-info underline">
              The page a person sees
            </Link>
            <Link href="/crisis" className="text-sm font-medium text-state-info underline">
              Crisis resources
            </Link>
            <Link href="/app/ground" className="text-sm font-medium text-state-info underline">
              Grounding
            </Link>
          </p>
        </Panel>

        {/* The rule is handoff 09 §10.1 — a feature may plug into the clinician
            task-provider contract only after its own clinical review. The
            reference stays in this comment; the footnote says the thing in the
            reader's words, because tests/clinician-screens.test.ts holds every
            surface to that and is right to. */}
        <Panel
          title="Held until a clinical review"
          footnote="A feature can put work into a clinician's queue only after a clinical review says a clinician may act on what it reports. Listed here so an empty queue can be told apart from a broken one."
        >
          <p className="measure text-sm text-ground">
            These features are built and their screens are reachable. What is held is narrower:
            they do not put rows into a clinician&rsquo;s queue, because the review that
            establishes a clinician may act on their readings has not been recorded. A review is
            recorded here only with the name of who did it and where the evidence lives.
          </p>
          <ul className="mt-3 divide-y divide-ground/5">
            {AWAITING_CLINICAL_REVIEW.filter((f) => !mayEnterTaskQueue(f.review)).map((f) => (
              <li key={f.feature} className="py-2.5">
                <p className="text-sm font-medium text-ground">{f.feature}</p>
                <p className="measure mt-1 text-sm text-ground/70">{f.review.withholds}</p>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title="Environment invariants"
          footnote="From the same health check the demo tooling runs. These are properties of the environment rather than of the service — a failure here means the data is wrong, not that the product is down."
        >
          <ul className="divide-y divide-ground/5">
            {health.checks.map((c) => (
              <li key={c.name} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
                <span className="text-sm text-ground">{c.name}</span>
                <span className={`text-sm ${c.ok ? "text-state-safe" : "text-state-support"}`}>
                  <span aria-hidden>{c.ok ? "◆" : "▲"}</span> {c.detail}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title="Versions"
          footnote="Which build produced everything above. A status with no version is an answer with no question attached — it cannot be compared to the last time somebody looked."
        >
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {[
              ["Demo seed", DEMO_SEED_VERSION],
              ["Fabricated population", DATASET_VERSION],
              ["Planning rules", RULE_VERSION],
              ["Planning thresholds", THRESHOLD_VERSION],
              ["Safety configuration", SAFETY_CONFIG_VERSION],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ground/5 py-1.5">
                <dt className="text-sm text-olive">{label}</dt>
                <dd className="font-mono text-xs text-ground">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="measure mt-3 text-xs text-olive">
            The safety configuration is provisional and carries no clinician sign-off. Nothing
            on this page changes that.
          </p>
        </Panel>

        {/* The policy registry (expansion handoff 03, Phase 6).
            By the end of the intelligence series a single Command Center row
            can rest on ten independently versioned rules, and a clinician
            asking "under what rules was this decided?" would otherwise have to
            be told ten separate answers by ten separate screens. This is the
            one place the whole set is enumerable. */}
        <Panel
          title="Clinical intelligence policies"
          footnote="Each version is the owning module's own constant, not a copy kept here — a registry holding its own would be one more thing to keep in sync, and the first to go stale."
        >
          <p className="measure text-sm text-ground">
            Every versioned rule a Command Center row can rest on. A pattern, a brief or an
            acknowledgement records the versions it was made under, and these are what those
            strings refer to.
          </p>
          <dl className="mt-3">
            {POLICY_REGISTRY.map((policy) => (
              <div
                key={policy.id}
                className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 border-b border-ground/5 py-2"
              >
                <dt className="text-sm text-ground">{policy.label}</dt>
                <dd className="font-mono text-xs text-ground">{policy.version}</dd>
                <dd className="col-span-2">
                  <p className="measure text-xs text-olive">{policy.decides}</p>
                  <p className="font-mono text-[11px] text-olive">{policy.module}</p>
                </dd>
              </div>
            ))}
          </dl>
        </Panel>

        {/* The route register (handoff 09 Package 0).
            §1.1 rules that unavailable capabilities are omitted from primary
            navigation and that an honest capability notice stays "reachable
            through a secondary product-status location". This screen is that
            location, so the register is shown here rather than only living in
            a file — a reviewer asking "what actually works?" should not have to
            read 128 page components to find out, and neither should anybody
            deciding what to build next. */}
        <Panel
          title="What actually works"
          footnote={`Compiled ${REGISTER_DATE} against ${REGISTER_COMMIT.slice(0, 7)}. A test fails the build if a route exists without an entry, if an entry describes a route that does not, or if a route recorded as working has quietly become a capability notice — so this table cannot go stale without somebody being told.`}
        >
          <p className="measure text-sm text-ground">
            Every route in the product, with what a person comes to it to do and whether it does
            it. {ROUTE_REGISTER.length} routes.
          </p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            {(Object.entries(stateCounts()) as Array<[CapabilityState, number]>)
              .filter(([, n]) => n > 0)
              .map(([state, n]) => (
                <div
                  key={state}
                  className="grid grid-cols-[1fr_auto] items-baseline gap-x-2 rounded-2xl border border-ground/10 bg-linen px-4 py-3"
                >
                  <dt className="text-sm font-medium text-app-ink">{STATE_LABEL[state]}</dt>
                  <dd className="font-mono text-sm text-ground">{n}</dd>
                  <dd className="measure col-span-2 mt-1 text-xs text-olive">{STATE_NOTE[state]}</dd>
                </div>
              ))}
          </dl>

          {/* The capability-absent routes, named. These are the pages §1.1
              keeps out of primary navigation, and this is where they stay
              reachable. */}
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-olive">
            Capabilities this build does not have
          </h3>
          <dl className="mt-2">
            {byState("unavailable").map((r) => (
              <div
                key={r.path}
                className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 border-b border-ground/5 py-2"
              >
                <dt className="font-mono text-xs text-ground">{r.path}</dt>
                <dd className="text-xs text-olive">{r.audience}</dd>
                <dd className="col-span-2">
                  <p className="measure text-xs text-app-ink">{r.job}</p>
                  <p className="measure text-xs text-olive">{r.evidence}</p>
                </dd>
              </div>
            ))}
          </dl>

          {PROMOTED_UNAVAILABLE.length > 0 && (
            <>
              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-olive">
                Navigation still promotes these
              </h3>
              <p className="measure mt-1 text-xs text-olive">
                {/* Recorded rather than repaired, on purpose: Package 0's exit
                    evidence is "no product behavior change". A register that
                    quietly fixed what it found could not be used to size the
                    work. */}
                A navigation item is a promise. These are recorded with the package that closes
                each, and a new one fails the build rather than joining the list quietly.
              </p>
              <ul className="mt-2 space-y-2">
                {PROMOTED_UNAVAILABLE.map((p) => (
                  <li key={p.path} className="rounded-2xl border border-amber-200 bg-amber-50/40 px-4 py-3">
                    <p className="font-mono text-xs text-ground">{p.promotedBy} &rarr; {p.path}</p>
                    <p className="measure mt-1 text-xs text-olive">{p.due}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        {/* The member score boundary and its one exception.
            §3's boundary is the strongest rule in handoff 09 and the one a
            buyer will push on — §2.2's Finding 4: "as Steady moves toward
            payers, health systems, and risk-bearing primary care, buyers will
            ask for exactly the quantification the member surface forbids." So
            the exception is on the reviewer's own screen, with the authority
            behind it named, rather than recorded only in a file. */}
        <Panel
          title="What a member is never shown"
          footnote="A member projection cannot carry a score, a band, a rule identifier, a threshold, a track name, a withheld count or a composite recovery figure — at any depth. Enforced by an allow-list rather than a deny-list: the question is not whether a field is forbidden, it is whether it was decided."
        >
          <p className="measure text-sm text-ground">
            Every field a member surface may carry is written down, and a projection carrying
            anything else fails the build. There is one exception, and it is settled rather than
            outstanding.
          </p>
          <div className="mt-3 rounded-2xl border border-ground/10 bg-linen px-4 py-3">
            <p className="text-sm font-medium text-app-ink">
              {MEMBER_SCORE_EXCEPTION.route}{" "}
              <span className="font-mono text-xs text-olive">{MEMBER_SCORE_EXCEPTION.projection}</span>
            </p>
            <p className="measure mt-1 text-xs text-olive">{MEMBER_SCORE_EXCEPTION.rationale}</p>
            <dl className="mt-3 space-y-2">
              {([
                ["Its own projection", MEMBER_SCORE_EXCEPTION.ownProjection],
                ["Its own contract test", MEMBER_SCORE_EXCEPTION.ownContractTest],
                ["A recorded decision", MEMBER_SCORE_EXCEPTION.recordedClinicalDecision],
              ] as const).map(([label, req]) => (
                <div key={label}>
                  <dt className="text-xs font-medium text-app-ink">
                    {label} — {req.met ? "met" : "not met"}
                    {"authority" in req && req.authority ? ` (${req.authority})` : ""}
                  </dt>
                  <dd className="measure text-xs text-olive">{req.evidence}</dd>
                </div>
              ))}
            </dl>
            <p className="measure mt-3 text-xs text-olive">{MEMBER_SCORE_EXCEPTION.ruling}</p>
          </div>
        </Panel>

        {/* The reconciliation. Both governing documents carry status registers
            that were accurate when written and are now two feature commits
            stale, and both say so in their own words. This is the correction,
            on the screen a reviewer already opens to check what is true. */}
        <Panel
          title="Where the governing documents disagree with the code"
          footnote={`Both handoff 09 and the Astra product experience review were written against ${SOURCE_BASELINE.slice(0, 7)}. Neither claims to be current; both instruct an engineer to reconcile later commits before assigning work. This is that reconciliation, and the code is the authority.`}
        >
          <dl className="space-y-3">
            {RECONCILED.map((r) => (
              <div key={r.claim} className="rounded-2xl border border-ground/10 bg-linen px-4 py-3">
                <dt className="measure text-sm text-olive">
                  <span className="font-medium text-app-ink">Document says:</span> {r.claim}
                </dt>
                <dd className="measure mt-1 text-sm text-app-ink">
                  <span className="font-medium">Actually:</span> {r.actual}
                </dd>
                <dd className="mt-1 font-mono text-xs text-olive">{r.evidence}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        {/* The provider registry and its published contract (§10, Phase 6).
            A reviewer asking "what can raise a work item, and under what
            rules?" would otherwise have to read the code. The contract is the
            promise handoffs 04 and 05 are written against; a provider that
            breaks it fails the build, and this is where a reviewer can see the
            set that currently passes. */}
        <Panel
          title="Attention providers"
          footnote={`Governed by ${PROVIDER_CONTRACT_VERSION}. A provider may raise review-worthy work; only the safety engine creates safety authority, and no provider decides queue position, owner, due date or next action.`}
        >
          <p className="measure text-sm text-ground">
            Everything that can put a non-safety row on a clinician&rsquo;s Command Center. Each is
            deterministic, versioned, and checked against the published contract by the test suite.
          </p>
          <dl className="mt-3">
            {registeredProviders().map((provider) => (
              <div
                key={provider.id}
                className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 border-b border-ground/5 py-2"
              >
                <dt className="font-mono text-xs text-ground">{provider.id}</dt>
                <dd className="font-mono text-xs text-ground">{provider.version}</dd>
                <dd className="measure col-span-2 text-xs text-olive">{provider.purpose}</dd>
              </div>
            ))}
          </dl>
          <p className="measure mt-3 text-xs text-olive">
            Handoffs 04 and 05 add a recovery-trajectory provider and a therapeutic-load provider
            to this list without changing anything about how the queue is ordered.
          </p>
        </Panel>

        {/* Rollout state (Appendix B). A flag whose own switch is on but whose
            phase is not available reads as broken rather than as not-finished,
            so the dependency is shown beside the switch rather than left to be
            inferred from a surface that quietly does not appear. */}
        <Panel
          title="Command Center rollout"
          footnote="Turning a surface off does not delete signal, action or evidence history. A tenant may override any of these for their own environment; this column is the deployment-wide answer."
        >
          <dl className="mt-1">
            {ALL_COMMAND_CENTER_FLAGS.map((flag) => {
              const own = commandCenterFlagEnabled(flag);
              const available = commandCenterSurfaceAvailable(flag);
              const requires = commandCenterFlagRequires(flag);
              return (
                <div
                  key={flag}
                  className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 border-b border-ground/5 py-2"
                >
                  <dt className="font-mono text-xs text-ground">{flag}</dt>
                  {/* Not colour alone (§19): the word is the state. */}
                  <dd className="text-xs text-olive">
                    {available ? "available" : own ? "switched on, but blocked" : "off"}
                  </dd>
                  {requires && (
                    <dd className="col-span-2 text-xs text-olive">
                      Rests on <span className="font-mono">{requires}</span>
                      {!available && own ? " — which is off, so this surface stays closed." : ""}
                    </dd>
                  )}
                </div>
              );
            })}
          </dl>
        </Panel>
      </div>
    </ReviewPage>
  );
}
