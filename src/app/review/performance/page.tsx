import { ReviewPage } from "@/components/clinical/ReviewPage";
import { Panel, Callout, SummaryCards } from "@/components/app/surfaces";
import { requireReviewAccess } from "@/lib/auth";
import { BUDGETS, MIN_SAMPLES, type BudgetClass } from "@/lib/performance/budget";
import { PERFORMANCE_RUN } from "@/lib/performance/run.generated";

export const dynamic = "force-dynamic";
export const metadata = { title: "Performance budgets — Steady Review" };

// Per-surface performance budgets and the last run against them
// (handoff 06 §31.2, wave 6).
//
// The load gate this codebase already has measures ONE path — the public home
// page — under concurrency, and answers "does the server stand up". That is a
// different question from "is this screen fast enough for what somebody is
// doing on it", and averaging the two answers neither.
//
// SO THE BUDGETS ARE CLINICAL STATEMENTS, not technical ones, and the classes
// are named for who is waiting and why. Grounding gets the tightest number in
// the product and carries the least data, which is the right way round:
// somebody opens it because they are activated. An aggregate console genuinely
// aggregates and nobody opens one mid-crisis, so it gets a looser number — as a
// stated allowance, not an observed figure rounded up until it passed.
//
// AND THE MEASUREMENT CARRIES ITS CONDITIONS. A number with no conditions is a
// number somebody will quote in a year. What was measured, when, against what
// build, and with how many samples are all on the screen, because a p95 over
// five samples is the largest of five and not a percentile at all.

const CLASS_ORDER: BudgetClass[] = ["support", "decision", "record", "aggregate", "review"];

export default async function PerformanceBudgetsPage() {
  await requireReviewAccess();

  const run = PERFORMANCE_RUN;
  const within = run.measurements.filter((m) => m.withinBudget).length;
  const measured = new Set(run.measurements.map((m) => m.cls));
  const unmeasured = CLASS_ORDER.filter((c) => !measured.has(c));

  return (
    <ReviewPage
      title="Performance budgets"
      lede="What each surface is allowed to take, why, and what it took when it was last measured."
    >
      <SummaryCards
        cards={[
          {
            label: "Surfaces measured",
            value: String(run.measurements.length),
            detail: `${MIN_SAMPLES}+ samples each, at the 95th percentile`,
          },
          {
            label: "Within budget",
            value: `${within} of ${run.measurements.length}`,
            detail: run.breaches.length === 0 ? "no breach in the last run" : "see the breaches below",
          },
          {
            label: "Budget classes",
            value: `${measured.size} of ${CLASS_ORDER.length}`,
            detail: unmeasured.length === 0 ? "every class has a measurement" : "one class has none",
          },
        ]}
      />

      <Callout tone="info" label="When this was measured, and against what">
        {run.takenAt.slice(0, 16).replace("T", " ")} UTC — {run.conditions}. These are
        server response times on one machine with no other load; they are a regression
        baseline, not a statement about a deployed instance.
      </Callout>

      {run.breaches.length > 0 && (
        <Callout tone="caution" label="Breaches in the last run">
          {run.breaches.join(" · ")}
        </Callout>
      )}

      <Panel
        title="The budgets"
        footnote="Set at the 95th percentile. A median budget is one most people meet and the worst day misses, which is the day that matters."
      >
        <div className="space-y-3">
          {CLASS_ORDER.map((cls) => {
            const b = BUDGETS[cls];
            const rows = run.measurements.filter((m) => m.cls === cls);
            return (
              <div key={cls} className="rounded-xl border border-ground/10 bg-app-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold capitalize">{cls}</p>
                  <span className="text-xs text-ground/60">
                    p{b.percentile} under <span className="tabular-nums">{b.ttfbMs} ms</span>
                  </span>
                </div>
                <p className="measure mt-1 text-xs text-ground/80">{b.why}</p>
                {rows.length === 0 ? (
                  <p className="mt-2 text-xs text-ground/60">
                    No surface of this class was measured in the last run, so this budget is
                    declared and unverified.
                  </p>
                ) : (
                  <table className="mt-3 w-full text-left text-xs">
                    <thead className="uppercase text-ground/60">
                      <tr>
                        <th scope="col" className="py-1">Surface</th>
                        <th scope="col" className="py-1 text-right">p95</th>
                        <th scope="col" className="py-1 text-right">fastest</th>
                        <th scope="col" className="py-1 text-right">slowest</th>
                        <th scope="col" className="py-1 text-right">samples</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((m) => (
                        <tr key={m.path} className="border-t border-ground/5">
                          <th scope="row" className="py-1 text-left font-normal"><code>{m.path}</code></th>
                          <td className={`py-1 text-right tabular-nums ${m.withinBudget ? "" : "font-medium text-state-serious"}`}>
                            {m.p95Ms} ms
                          </td>
                          <td className="py-1 text-right tabular-nums text-ground/60">{m.samples[0]} ms</td>
                          <td className="py-1 text-right tabular-nums text-ground/60">
                            {m.samples[m.samples.length - 1]} ms
                          </td>
                          <td className="py-1 text-right tabular-nums text-ground/60">{m.samples.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="What this does not measure">
        <ul className="measure space-y-2 text-sm text-ground/80">
          <li>
            <span className="font-medium">Anything a browser does after the response.</span>{" "}
            The budget is time to the server&apos;s first byte, so a page that arrives fast and
            paints slowly passes this and would still feel slow.
          </li>
          <li>
            <span className="font-medium">Concurrency.</span> One client, one request at a
            time. The load gate beside this one fires concurrency at the home page and
            reports a separate ceiling; neither substitutes for the other.
          </li>
          <li>
            <span className="font-medium">A deployed instance.</span> These numbers come from
            a local production build against SQLite. A smaller instance with a network database
            will be slower, and treating these as capacity figures would be a mistake.
          </li>
          <li>
            <span className="font-medium">Most of the product.</span> Ten surfaces, one per
            class per role, chosen for what somebody is doing on them. A gate that timed every
            route would take long enough that nobody would run it.
          </li>
        </ul>
      </Panel>
    </ReviewPage>
  );
}
