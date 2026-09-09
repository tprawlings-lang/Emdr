import Link from "next/link";
import { ReviewPage } from "@/components/clinical/ReviewPage";
import { Panel, Callout, RecordRows } from "@/components/app/surfaces";
import { requireReviewAccess } from "@/lib/auth";
import {
  REGISTRY_FIELDS, FIELD_REQUIREMENT, REGISTERED_MODELS, EMPTY_REGISTRY_NOTE,
  SHADOW_MAY_REACH, SHADOW_MAY_NOT_REACH, RELEASE_REVIEWS, outstandingReviews,
  mayRun, missingFields,
} from "@/lib/governance/model-registry";
import { RACE_CORRECTION_PROHIBITED } from "@/lib/governance/fairness-audit";

export const dynamic = "force-dynamic";
export const metadata = { title: "Model registry — Steady Review" };

// The model registry shell (handoff 07 §3.8 p37–38, G13; Wave 7).
//
// THE REGISTRY IS EMPTY AND THAT IS THE ANSWER THIS SCREEN GIVES. There is no
// model in this build: the planning engine evaluates fixed rules against
// recorded data and produces no model output, by design. A screen that rendered
// nothing would read as one that failed to load, so this one says which of the
// two it is — §9's coverage model exists precisely so an empty list and a
// broken one can be told apart.
//
// WHY BUILD IT BEFORE THE FIRST MODEL. §7 names "unregistered model execution"
// as the thing this wave prohibits. A prohibition written after the first model
// exists is written against a working system by somebody who wants it to keep
// working; written before, it is just the cost of entry. The requirements below
// are what a model would have to answer to run at all, and `mayRun` is the
// predicate a runner would have to call rather than a paragraph it could
// disregard.

export default async function ModelRegistryPage() {
  await requireReviewAccess();

  const registered = REGISTERED_MODELS;
  // Nothing is registered, so nothing may run. Computed rather than asserted,
  // so this screen tells the truth on the day something is registered.
  const runnable = registered.filter((m) => mayRun(m)).length;
  const release = outstandingReviews({ completed: [] });

  return (
    <ReviewPage
      layer="evidence"
      here="/review/models"
      title="Model registry"
      lede="What a model must declare before it may run, and what a shadow output may reach."
    >
      {/* Text, not a paragraph: Callout supplies the <p> itself. */}
      <Callout tone="info" label="Nothing is registered, and nothing is running">
        {EMPTY_REGISTRY_NOTE}
      </Callout>

      <Panel
        title="What is registered"
        footnote="An empty registry is a reportable state, not a blank screen. The count is computed from the registry rather than written here, so this panel stops saying zero the moment it stops being true."
      >
        <RecordRows
          rows={[
            { label: "Models registered", value: String(registered.length) },
            { label: "Models permitted to run", value: String(runnable) },
            {
              label: "Models producing output used for care",
              value: "0 — and no registered model may, until all four reviews below are complete",
            },
          ]}
        />
      </Panel>

      <Panel
        title="What a model must declare before it may run"
        footnote="All of them, not most of them. A registration missing any field is refused rather than accepted with gaps — optional fields with sensible defaults are how a model gets registered with nine of the eleven answers."
      >
        <dl className="mt-1">
          {REGISTRY_FIELDS.map((f) => (
            <div
              key={f}
              className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 border-b border-ground/5 py-2.5"
            >
              <dt className="font-mono text-xs text-ground">{f.replace(/_/g, " ")}</dt>
              <dd className="text-xs text-olive">required</dd>
              <dd className="measure col-span-2 mt-1 text-sm text-app-ink">
                {FIELD_REQUIREMENT[f]}
              </dd>
            </div>
          ))}
        </dl>
        <p className="measure mt-3 text-xs text-olive">
          An empty registration is missing {missingFields({}).length} of{" "}
          {REGISTRY_FIELDS.length} fields and may not run. That sentence is produced by the
          same function a runner would call.
        </p>
      </Panel>

      <Panel
        title="Where a shadow output may go"
        footnote="Shadow means shadow. The permitted list is exhaustive rather than illustrative, so a surface added next month is refused by default instead of permitted by omission."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-olive">May reach</h3>
            <ul className="mt-2 space-y-1.5">
              {SHADOW_MAY_REACH.map((d) => (
                <li key={d} className="text-sm text-ground">
                  <span aria-hidden>◆</span> {d.replace(/_/g, " ")}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-olive">
              May not reach
            </h3>
            <ul className="mt-2 space-y-1.5">
              {SHADOW_MAY_NOT_REACH.map((d) => (
                <li key={d} className="text-sm text-ground">
                  <span aria-hidden>▲</span> {d.replace(/_/g, " ")}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>

      <Panel
        title="What has to happen before a shadow output stops being one"
        footnote="Four reviews, all of them. The registry names which are outstanding rather than only reporting that the answer is no."
      >
        <ul className="divide-y divide-ground/5">
          {RELEASE_REVIEWS.map((r) => (
            <li key={r} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2.5">
              <span className="text-sm text-ground">{r} review</span>
              <span className="text-sm text-state-caution">
                <span aria-hidden>▲</span>{" "}
                {release.includes(r) ? "outstanding" : "complete"}
              </span>
            </li>
          ))}
        </ul>
        <p className="measure mt-3 text-sm text-ground">
          Until all four are complete, a registered model&rsquo;s output is not shown to a
          member and is not used for care.
        </p>
      </Panel>

      <Panel
        title="Protected attributes and correction factors"
        footnote="The prohibition is recorded here because this is where a model's features would be declared, which is the one place a correction factor could enter without anyone noticing."
      >
        <p className="measure text-sm text-ground">
          Race correction factors are prohibited{RACE_CORRECTION_PROHIBITED ? "" : " — AND THIS BUILD DOES NOT ENFORCE IT"}.
          Protected attributes may be used to audit access and verify representation, and never
          to adjust an output or to restrict or select anyone&rsquo;s care. A registration whose
          features apply an adjustment to a protected attribute is a defect, not a
          configuration.
        </p>
        <p className="measure mt-2 text-xs text-olive">
          The audit that uses these attributes as intended is{" "}
          <Link href="/review/fairness" className="underline">the fairness audit</Link>.
        </p>
      </Panel>
    </ReviewPage>
  );
}
