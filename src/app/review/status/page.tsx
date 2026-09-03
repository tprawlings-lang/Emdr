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
      </div>
    </ReviewPage>
  );
}
