import { AppShell } from "@/components/app/AppShell";
import { Panel, Note, WithNote, SummaryCards } from "@/components/app/surfaces";
import { requireDemoAdmin } from "@/lib/auth";
import { walkthroughCount, WALKTHROUGH_LIMIT } from "@/lib/demo/walkthrough";
import { enrolledCount, ENROLLMENT_LIMIT } from "@/lib/enrollment/gate";
import { NewPatient } from "@/components/demo/NewPatient";
import { assignableClinicians } from "@/lib/demo/new-patient-store";
import { logout } from "@/lib/actions";
import { DEMO_ROLES } from "@/lib/roles";
import { data } from "@/lib/data";
import { replayScenarios } from "@/lib/safety/scenarios";
import { ADMIN_RAIL } from "@/lib/app/rails";
import { getDb, PLATFORM_TENANT_ID } from "@/lib/db";
import { runQualityChecks, qualitySummary } from "@/lib/demo-quality";
import { MILESTONES, readClock } from "@/lib/demo-clock";
import { advanceDemoClock } from "@/lib/demo-clock-actions";
import {
  resetDemoEnvironment, applyDemoDataScenario, exportDemoQaReport,
} from "@/lib/demo-reset-actions";
import { qaRows, qaSummary, QA_EXPORT_SURFACE } from "@/lib/demo/qa-export";
import {
  RESET_BUDGET_MS, nightlyResetConfig, nextRunAt,
} from "@/lib/demo/nightly-reset";
import { listExports } from "@/lib/intelligence/export";
import {
  DATA_SCENARIOS, appliedScenarios, resolveCohort,
} from "@/lib/demo/data-scenario";
import { validateProjections, validationRemedy } from "@/lib/demo/projection-hashes";
import { environmentStatus } from "@/lib/demo/preflight";
import { resetScope } from "@/lib/demo/environment-lock";
import { EnvironmentHealth } from "@/components/demo/EnvironmentHealth";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demo administration — Steady" };

// Demo administration (handoff 07 §1.5, p9; role scope §1.2, p6).
//
// p6 grants this role everything inside the fabricated environment — every
// tenant, person, event, reset and QA control — and nothing outside it. The
// breadth is the point AND the risk, which is why the warning below is on the
// screen rather than in a comment:
//
//   PRODUCTION ADMINISTRATION MUST USE PURPOSE-LIMITED PERMISSIONS AND
//   BREAK-GLASS ACCESS. DO NOT CARRY THE DEMO ADMIN'S BLANKET VISIBILITY INTO
//   PRODUCTION.
//
// p9 specifies six controls: reset dataset, advance clock, inject scenario,
// validate projections, credential status, export QA report. Only the ones
// that exist are rendered as controls. The rest are named with what they need,
// because a disabled button a presenter might click during a demonstration is
// worse than a sentence saying the control is not built.

export default async function AdminDemoPage() {
  const user = await requireDemoAdmin();
  const clock = await readClock();
  const c = await data();

  const counts = (await c.get(
    `SELECT
       (SELECT COUNT(*) FROM tenants)             AS tenants,
       (SELECT COUNT(*) FROM persons)             AS persons,
       (SELECT COUNT(*) FROM longitudinal_events) AS events,
       (SELECT COUNT(*) FROM audit_log)           AS audit`,
    [],
  )) as { tenants: number; persons: number; events: number; audit: number };

  // Onboarding walkthroughs are the one kind of fabricated person a VISITOR
  // creates rather than the seed. Counted beside the seeded totals so a
  // presenter can see the environment filling up before the cap refuses,
  // rather than discovering it when the button says no.
  const walkthroughs = await walkthroughCount();
  // People who filled in the enrollment form. NOT fabricated data, and a
  // reset deletes them anyway — so the number is on the reset panel, where
  // the decision is made, rather than only in the manifest.
  const enrolled = await enrolledCount();

  const scenarios = replayScenarios();
  const failing = scenarios.filter((s) => !s.pass).length;

  // Handoff 09 §7.3: "Lead with environment health and failed preflight."
  // Computed once and rendered at the top; the panels below stay because they
  // are the detail behind it, not a second opinion about it.
  const status = environmentStatus(getDb());
  const scope = resetScope();
  const applied = appliedScenarios();
  const validation = validateProjections(getDb());
  const remedy = validationRemedy(validation);
  const qaAll = qaRows(getDb());
  const qa = qaSummary(qaAll);
  const qaRowCount = qaAll.length;
  const qaHistory = (await listExports(PLATFORM_TENANT_ID)).filter(
    (e) => e.surface === QA_EXPORT_SURFACE
  );
  const nightly = nightlyResetConfig();
  const nextNightly = nextRunAt(new Date(), nightly.hourUtc);

  // p29's data-quality manifest, computed NOW against the live database. A
  // manifest recorded at build time reports the state of the last good build,
  // which is the one thing a presenter does not need to know.
  const quality = runQualityChecks(getDb());
  const q = qualitySummary(quality);

  return (
    <AppShell
      role="Steady Demo"
      title="Demo administration"
      active="overview"
      railHref={ADMIN_RAIL}
      railFooter={
        <form action={logout}>
          <button className="hover:underline">Sign out</button>
        </form>
      }
    >
      <div className="space-y-6">
        {/* Handoff 09 §7.3, and the order is the instruction: environment
            health and failed preflight FIRST. This panel used to sit below a
            role warning, three summary cards and a safety row — so a presenter
            checking whether they could start read four things before the one
            that answers the question. */}
        <EnvironmentHealth status={status} lock={scope.activeWalkthrough} />

        <p className="text-sm text-olive">
          <Link href="/demo/scenarios" className="text-state-info underline">
            Guided walkthroughs
          </Link>{" "}
          run against this environment and refuse to start while it is not ready.
        </p>

        <div
          role="note"
          className="rounded-2xl border border-state-support/50 bg-state-support-bg/50 px-5 py-4"
        >
          <p className="text-sm font-semibold text-ground">
            This role is broad on purpose, and only here.
          </p>
          <p className="measure mt-1 text-sm text-ground">
            It can inspect every fabricated tenant, person, event and projection in this
            environment. That is safe because nothing in it is real. Production administration
            must use purpose-limited permissions and break-glass access — this account&rsquo;s
            blanket visibility must never be carried across.
          </p>
        </div>

        <SummaryCards
          cards={[
            { label: "Tenants", value: String(counts.tenants) },
            { label: "Fabricated people", value: counts.persons.toLocaleString() },
            { label: "Ledger events", value: counts.events.toLocaleString() },
          ]}
        />

        <WithNote
          note={
            <Note
              title="Why the safety row is here"
              boundary="A green row proves this build runs the production gate engine on ten fixed inputs. It is not evidence that the thresholds are clinically correct, and it says nothing about any real person."
              owner="Clinical review"
            >
              <p>
                Handoff 07 blocks release on a demo bypass or a relaxed safety rule, so the check
                belongs where a presenter will see it before starting, not only in a test report
                nobody opens during a meeting.
              </p>
            </Note>
          }
        >
          <Panel
            title="Environment state"
            footnote="Counted now, from the live database. Nothing on this panel is cached."
          >
            <dl className="divide-y divide-ground/5">
              <Row
                label="Safety scenarios"
                value={failing === 0 ? `✓ ${scenarios.length} of ${scenarios.length} match` : `✕ ${failing} not matching`}
                detail="Fixed scenarios replayed through the live gate engine."
                href="/review/safety"
                bad={failing > 0}
              />
              <Row
                label="Audit chain"
                value={`${counts.audit.toLocaleString()} entries`}
                detail="Hash-chained and append-only; verified by npm run test:safety."
                href="/review/audit"
              />
              <Row
                label="Demo roles"
                value={`${DEMO_ROLES.length} defined`}
                detail={DEMO_ROLES.map((r) => r.label).join(" · ")}
              />
            </dl>
          </Panel>
        </WithNote>

        {/* Creating a patient from nothing, which the seeded population cannot
            do. The seed writes the OUTCOME of onboarding — the same cast, the
            same history, every reset — so nobody in it has ever answered the
            fitness screener, worked through 59 baseline items, or arrived in a
            caseload as somebody new. */}
        <Panel
          title="Create a new patient"
          footnote="A fabricated person, taken as far through onboarding as you choose, in this tenant — which is what puts them in the clinician's caseload. Everything is written through the same functions a member's own answers go through, so the result is a state the product can actually produce."
        >
          <NewPatient clinicians={await assignableClinicians()} />
        </Panel>

        <Panel
          title="Data quality"
          footnote="Handoff 07 p29. Computed now, against the live database — not recorded at build time. p29 blocks external demonstrations when the latest reset or projection verification failed, and a presenter must never repair the demo by editing rows directly."
        >
          {q.ok ? (
            <p className="measure text-sm text-ground">
              All {q.passed} checks pass on this dataset.
            </p>
          ) : (
            <p role="alert" className="measure text-sm font-semibold text-state-support">
              {q.failed} of {quality.length} checks fail. This dataset is not fit to
              demonstrate: fix the generator and reset, and do not edit rows to make the
              numbers agree.
            </p>
          )}
          <ul className="mt-3 divide-y divide-ground/5">
            {quality.map((c) => (
              <li key={c.check} className="grid gap-1 py-2 sm:grid-cols-[15rem_1fr] sm:gap-4">
                <span className="text-sm text-app-ink">{c.check}</span>
                <span className="text-xs">
                  <span className={c.pass ? "text-state-safe" : "font-semibold text-state-support"}>
                    {c.pass ? "\u2713" : "\u2715"} {c.actual}
                  </span>
                  <span className="ml-2 text-olive">expected {c.expected}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        {/* p9's second control, built. Advance clock. */}
        <WithNote
          note={
            <Note
              tone={clock.live ? "info" : "caution"}
              title={clock.live ? "The clock is live" : "The clock is moved"}
              owner="Demo admin"
              boundary="The clock moves the READING, never the record. Audit entries, session issue and expiry, and rate limits stay on the real clock — a demo control that could backdate an audit row or extend a session would be a governance hole with a friendly name."
            >
              <p>
                {clock.live
                  ? "Every console reads today. Moving the clock re-reads the same fixed dataset from an earlier point in the fabricated year."
                  : `Every console is reading ${clock.now.toISOString().slice(0, 10)}` +
                    (clock.reason ? `. Reason given: “${clock.reason}”.` : ".")}
              </p>
            </Note>
          }
        >
          <Panel
            title="Advance clock"
            footnote="A milestone, not an arbitrary date (p9). The dataset does not move; the point you are reading it from does. A reset returns the clock to live."
          >
            <form action={advanceDemoClock} className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-app-ink">Milestone</legend>
                {[{ id: "live", label: "Live — read today", shows: "The clock is the real one." },
                  ...MILESTONES].map((m) => (
                  <label key={m.id} className="flex items-start gap-3 text-sm">
                    <input
                      type="radio"
                      name="milestone"
                      value={m.id}
                      defaultChecked={clock.live ? m.id === "live" : clock.milestone?.id === m.id}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium text-app-ink">{m.label}</span>
                      <span className="measure block text-xs text-olive">{m.shows}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <label className="block text-sm">
                <span className="font-medium text-app-ink">Reason</span>
                <input
                  name="reason"
                  required
                  minLength={4}
                  placeholder="Investor walkthrough — show the half-year view"
                  className="mt-1 w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
                />
                <span className="mt-1 block text-xs text-olive">
                  Recorded with the change. A clock moved for no stated purpose is a clock nobody
                  can explain when a screen looks wrong an hour later.
                </span>
              </label>
              <button className="rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-app-ink hover:opacity-90">
                Set the clock
              </button>
            </form>
          </Panel>
        </WithNote>

        <Panel
          title="Reset dataset"
          footnote="p9's first control. Removes every row of synthetic activity and rebuilds the versioned baseline through the same path a fresh environment uses, so a reset and a first boot can never produce subtly different datasets."
        >
          <p className="measure text-sm text-ground">
            Use this when the data-quality manifest above fails. p29 is explicit that a
            presenter <strong>must never repair the demo by editing database rows</strong>, and
            until this control existed the page could tell you the environment was unfit and
            offer you nothing to do about it — which left a shell on the instance as the only
            remedy, and that is exactly the access p29 is trying not to hand out.
          </p>
          <p className="measure mt-2 text-sm text-olive">
            Everything fabricated goes: accounts, history, projections and signals. Reviewer
            change requests and the approved planning thresholds survive, because neither is
            fabricated member data. Anything a person originated here is not rebuilt by this and
            is not fabricated data — the manifest reports how many such people exist above.
          </p>
          {/* Onboarding walkthroughs are the one kind of fabricated person a
              VISITOR creates rather than the seed, so the count moves with what
              people did in this environment and the seeded totals do not.
              Beside the reset rather than in the summary above, for two
              reasons: `SummaryCards` takes three and refuses a fourth — which
              is the right rule, a fourth headline is not a headline — and this
              is only ever read when deciding whether to reset. */}
          <p className="measure mt-4 text-sm text-olive">
            <span className="font-semibold text-ground">
              Enrollment: {enrolled} of {ENROLLMENT_LIMIT} places used
            </span>{" "}
            — accounts created through the access-coded signup form. Real people, so they are
            reported here and never counted as fabricated population.
          </p>

          {walkthroughs > 0 && (
            <p className="measure mt-4 rounded-2xl border border-ground/10 bg-app-surface px-4 py-3 text-sm text-ground">
              <span className="font-semibold">
                Onboarding walkthroughs: {walkthroughs} of {WALKTHROUGH_LIMIT}
              </span>{" "}
              <span className="text-olive">
                fabricated people created from the sign-in screen&rsquo;s walkthrough. A reset
                clears them. At {WALKTHROUGH_LIMIT} the control refuses until one happens.
              </span>
            </p>
          )}

          {/* §7.3: "Before reset, show scope, active sessions, and effect."
              Stated from `resetScope()` rather than written here, so the two
              lists and the destructive call cannot describe different
              operations. */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-ground/10 bg-app-surface px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-olive">What goes</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ground">
                {scope.clears.map((x) => <li key={x}>{x}</li>)}
              </ul>
            </div>
            <div className="rounded-2xl border border-ground/10 bg-app-surface px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-olive">What survives</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ground">
                {scope.preserves.map((x) => <li key={x}>{x}</li>)}
              </ul>
            </div>
          </div>

          {scope.activeWalkthrough && (
            <div role="alert" className="mt-4 rounded-2xl border border-state-support/60 bg-state-support-bg/50 px-4 py-3">
              <p className="text-sm font-semibold text-ground">
                A walkthrough is running right now.
              </p>
              <p className="measure mt-1 text-sm text-ground">
                {scope.activeWalkthrough.heldByName ?? scope.activeWalkthrough.heldBy} started
                &ldquo;{scope.activeWalkthrough.scenarioId}&rdquo;{" "}
                {scope.activeWalkthrough.minutesHeld} minutes ago
                {scope.activeWalkthrough.stale && ", which is long enough that they have probably finished"}.
                Resetting now changes the dataset under their screen mid-sentence. This is
                refused unless you deliberately interrupt, and the reason you give is recorded
                where they will see it.
              </p>
            </div>
          )}

          {enrolled > 0 && (
            <div className="mt-4 rounded-2xl border border-support/40 bg-support/10 px-4 py-3">
              <p className="text-sm font-semibold text-support-deep">
                {enrolled} enrolled {enrolled === 1 ? "person" : "people"} would be deleted
              </p>
              <p className="measure mt-1 text-sm text-ground">
                These are people who filled in the enrollment form — real names, real
                addresses, and their own answers to the safety screener and the daily
                check-in. A reset removes them and everything they wrote, with no undo, and
                reports success. Nothing in the rebuilt baseline will record that they were
                here.
              </p>
              <p className="measure mt-2 text-sm text-olive">
                Export anything you still need first. The reset is refused until the box below
                is ticked, and ticking it is recorded against your account.
              </p>
            </div>
          )}

          <form action={resetDemoEnvironment} className="mt-4 space-y-4">
            {enrolled > 0 && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="discardEnrolled" className="mt-1" />
                <span className="font-medium text-app-ink">
                  Delete the {enrolled} enrolled {enrolled === 1 ? "person" : "people"} and
                  everything they entered
                </span>
              </label>
            )}
            {scope.activeWalkthrough && (
              <>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="interrupt" className="mt-1" />
                  <span className="font-medium text-app-ink">
                    Interrupt the walkthrough in progress
                  </span>
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-app-ink">What to tell the other operator</span>
                  <input
                    name="interruptReason"
                    minLength={4}
                    placeholder="Dataset is failing the manifest — rebuilding before the 3pm session"
                    className="mt-1 w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
                  />
                </label>
              </>
            )}
            <label className="block text-sm">
              <span className="font-medium text-app-ink">Reason</span>
              <input
                name="reason"
                required
                minLength={4}
                placeholder="Manifest failing after deploy — rebuild from the current seed"
                className="mt-1 w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-olive">
                p9&rsquo;s own guard. Recorded with the reset, along with the rows removed and the
                baseline hash — which is what makes two resets comparable, and what a reviewer
                checks when told the environment was rebuilt between two sessions.
              </span>
            </label>
            <button className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-app-surface hover:opacity-90">
              Reset the dataset
            </button>
          </form>
        </Panel>

        <Panel
          title="Validate projections"
          footnote="p9's fifth control. Two questions, asked separately because they fail separately: are the projections consistent with their own events, and is this the dataset that was published?"
        >
          <p className="measure text-sm text-ground">
            The hashes below are recorded in the seed manifest for{" "}
            <code className="text-xs">{validation.datasetVersion}</code> and compared against the
            live tables. This catches a drift the replay cannot: a generator change moves both
            halves at once, so live and rebuilt agree while neither is the published dataset.
            A hand-edited row and a half-finished rebuild are caught the same way.
          </p>
          <p className="measure mt-2 text-sm text-olive">
            It does <strong>not</strong> catch an applied data bundle. A bundle writes to the
            event spine and touches no projected table, so every hash still matches — correctly,
            because the projections are the published ones until something rebuilds them. What
            an altered population is recorded by is the bundle list above, and the QA report
            carries the same list as a section of its own.
          </p>

          {validation.ok ? (
            <p className="measure mt-3 rounded-2xl border border-state-safe/50 bg-state-safe-bg/40 px-4 py-3 text-sm text-ground">
              Every projected table matches the hash recorded for this dataset version. That
              says the data is the published one; it does not say the projections agree with
              their own events, which is the separate check on the{" "}
              <Link href="/review/release" className="underline">release console</Link>.
            </p>
          ) : (
            <div role="alert" className="measure mt-3 rounded-2xl border border-state-caution/60 bg-state-caution-bg/50 px-4 py-3">
              <p className="text-sm font-semibold text-ground">
                This dataset does not match the seed manifest.
              </p>
              {/* THE REMEDY, NEXT TO THE FAILURE. The two remedies are
                  opposite — regenerate, or reset — and choosing between them is
                  the whole of the operator's decision. A check whose failure
                  has no stated remedy is one people learn to click past. */}
              <p className="mt-1 text-sm text-ground">{remedy}</p>
            </div>
          )}

          <dl className="mt-4 divide-y divide-ground/5">
            {validation.checks.map((c) => (
              <div key={c.table} className="grid gap-1 py-2 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-sm font-medium text-app-ink">{c.table}</dt>
                <dd className="min-w-0 break-words text-sm text-ground">
                  {c.verdict === "matches" && (
                    <span className="text-state-safe">◆ matches</span>
                  )}
                  {c.verdict === "differs" && (
                    <span className="text-state-caution">▲ differs</span>
                  )}
                  {c.verdict === "not_recorded" && (
                    <span className="text-olive">○ no hash recorded</span>
                  )}
                  <span className="text-olive"> · {c.rows} rows</span>
                  <span className="mt-0.5 block font-mono text-xs text-olive">
                    {/* Enough to compare by eye, and never the whole digest:
                        a wall of hex teaches a reader to skip the row. */}
                    {c.actual === null ? "empty in this environment" : c.actual.slice(0, 16)}
                    {c.verdict === "differs" && c.expected !== null && (
                      <> · expected {c.expected.slice(0, 16)}</>
                    )}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel
          title="Inject a data scenario"
          footnote="p9's fourth control. An approved, versioned event bundle that changes what the fabricated population has been through — not a guided walkthrough, which changes what a presenter shows. Reversible by reset, and by reset only: an undo that removed events would rewrite history, which this spine refuses to do for anybody."
        >
          <p className="measure text-sm text-ground">
            Each bundle below is declared in code and reviewed like code. There is no upload and
            no free-text event: a console that can write arbitrary events into a clinical spine
            is a console that can fabricate a safety history. Applying one appends to the event
            spine and nothing else — the projections are rebuilt from those events, so a bundle
            cannot invent a state the replay would not produce.
          </p>

          {applied.length > 0 && (
            <div className="mt-4 rounded-2xl border border-state-support/60 bg-state-support-bg/50 px-4 py-3">
              <p className="text-sm font-semibold text-ground">
                This dataset has been altered.
              </p>
              <ul className="measure mt-1 space-y-1 text-sm text-ground">
                {applied.map((a) => (
                  <li key={a.scenarioVersion}>
                    <code className="text-xs">{a.scenarioVersion}</code> — {a.people} people,{" "}
                    {a.events} events, applied {a.appliedAt} by {a.appliedByName ?? a.appliedBy}:{" "}
                    &ldquo;{a.reason}&rdquo;
                  </li>
                ))}
              </ul>
              <p className="measure mt-2 text-xs text-olive">
                Anybody reading a screen in this environment is reading a population that carries
                the above. Reset returns it to the baseline.
              </p>
            </div>
          )}

          <div className="mt-4 space-y-4">
            {DATA_SCENARIOS.map((sc) => {
              const on = applied.find((a) => a.scenarioVersion === sc.version);
              const cohort = resolveCohort(sc.cohort);
              return (
                <div key={sc.id} className="rounded-2xl border border-ground/10 bg-app-surface px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-app-ink">{sc.title}</p>
                    <code className="text-xs text-olive">{sc.version}</code>
                  </div>
                  <p className="measure mt-1 text-sm text-ground">{sc.purpose}</p>
                  {/* THE CONSEQUENCE BEFORE THE CONTROL. An operator about to
                      change what a population has been through should read what
                      the dataset looks like afterwards, not discover it. */}
                  <p className="measure mt-2 text-sm text-olive">
                    <strong className="text-ground">Afterwards:</strong> {sc.whatChanges}
                  </p>
                  <p className="mt-2 text-xs text-olive">
                    {cohort.length} fabricated {cohort.length === 1 ? "person" : "people"} ·{" "}
                    {sc.events.length * cohort.length} events ·{" "}
                    {sc.events.map((e) => e.type).join(", ")}
                  </p>

                  {on ? (
                    <p className="mt-3 rounded-xl bg-app-accent/40 px-3 py-2 text-sm text-ground">
                      Already applied {on.appliedAt}. Applying it again would double every event
                      in it, so it is refused until the environment is reset.
                    </p>
                  ) : (
                    <form action={applyDemoDataScenario} className="mt-3 space-y-2">
                      <input type="hidden" name="scenarioId" value={sc.id} />
                      <label className="block text-sm">
                        <span className="font-medium text-app-ink">Reason</span>
                        <input
                          name="reason"
                          required
                          minLength={12}
                          placeholder="Showing the safety response path at the 3pm clinical review"
                          className="mt-1 w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
                        />
                        <span className="mt-1 block text-xs text-olive">
                          A sentence, not a word. It is recorded with the application and is what
                          explains an altered dataset to whoever finds it next.
                        </span>
                      </label>
                      <button className="rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-app-ink hover:opacity-90">
                        Apply this bundle
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel
          title="Nightly rebuild"
          footnote="p9's G18. Off unless explicitly armed: this is the only scheduled job in the product that deletes member data, and it runs at an hour chosen so that nobody is watching."
        >
          {nightly.enabled ? (
            <>
              <p className="measure text-sm text-ground">
                <strong>Armed.</strong> The dataset is rebuilt every day at{" "}
                <strong>{String(nightly.hourUtc).padStart(2, "0")}:00 UTC</strong>. Next run{" "}
                {nextNightly.toISOString().slice(0, 16).replace("T", " ")} UTC.
              </p>
              <p className="measure mt-2 text-sm text-olive">
                The hour is stated in UTC rather than a local zone because this environment has
                reviewers in several places and a timezone of its own in none of them — a local
                hour would be somebody&rsquo;s, and nobody would know whose.{" "}
                <code className="text-xs">EMDR_DEMO_RESET_HOUR_UTC</code> moves it.
              </p>
            </>
          ) : (
            <>
              <p className="measure text-sm text-ground">
                <strong>Off.</strong> {nightly.reason}
              </p>
              <p className="measure mt-2 text-sm text-olive">
                Nothing rebuilds this environment on its own. Whatever state it is in tomorrow
                morning is the state somebody left it in tonight, which is exactly what the
                controls above are for.
              </p>
            </>
          )}

          {/* THE REFUSAL IS THE PART WORTH READING even when the job is off,
              because it is the reason a scheduled reset is safe to arm at all.
              §7.3's lock stops a dataset changing under somebody's meeting; a
              robot at 4am is that failure with nobody in the room. */}
          <p className="measure mt-3 rounded-2xl border border-ground/10 bg-app-surface px-4 py-3 text-sm text-ground">
            A run <strong>skips the night</strong> while a walkthrough holds the environment —
            it never interrupts one. Interrupting somebody mid-walkthrough is a decision a
            person makes deliberately, and a timer cannot be deliberate. A skipped night is
            recorded, because an environment that quietly stopped rebuilding is one somebody
            will demonstrate from a week later.
          </p>
          <p className="measure mt-2 text-xs text-olive">
            Every run records how long it took against p29&rsquo;s{" "}
            {RESET_BUDGET_MS / 1000}-second ceiling. That ceiling is reported against, never
            enforced: aborting a rebuild halfway through for running long would leave the
            environment in the state this job exists to prevent.
          </p>
        </Panel>

        <Panel
          title="Export the QA report"
          footnote="p9's sixth control. A manifest of counts, hashes and failed checks, released through the same governed export path an aggregate report uses: a stated purpose, a signature, a content hash and an audit event before the file exists."
        >
          <p className="measure text-sm text-ground">
            A QA report is for being believed later — attached to a ticket, quoted in a review,
            cited in an argument about whether this environment was fit on a particular
            afternoon. That is exactly the kind of claim the export machinery exists to make
            checkable, and a report with no signature and no recorded purpose is a screenshot
            with extra steps.
          </p>
          <p className="measure mt-2 text-sm text-olive">
            <strong className="text-ground">This one does not refuse on a failing environment.</strong>{" "}
            Every other control here stops when the manifest fails, because demonstrating from a
            broken environment is the harm. This one exists to describe a broken environment to
            somebody who is not in the room, so withholding it when the checks fail would remove
            the artifact at the moment it is the thing being asked for.
          </p>

          <p className="mt-3 text-sm text-ground">
            {qa.total} graded checks, {qa.failed} failing · {qaRowCount} rows including the
            baseline hash, every projection hash, and any data bundle in force.
          </p>

          <form action={exportDemoQaReport} className="mt-3 space-y-2">
            <label className="block text-sm">
              <span className="font-medium text-app-ink">What this file is for</span>
              <input
                name="purpose"
                required
                minLength={12}
                placeholder="Attaching to the deploy ticket — four manifest checks failed after the release"
                className="mt-1 w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-olive">
                Recorded with the file. A report cannot be produced without one, which is the
                field that makes the release reviewable afterwards.
              </span>
            </label>
            <button className="rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-app-ink hover:opacity-90">
              Release the QA report
            </button>
          </form>

          {qaHistory.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-olive">
                Released reports
              </p>
              <ul className="mt-2 space-y-2">
                {qaHistory.map((h) => (
                  <li key={h.id} className="rounded-2xl border border-ground/10 bg-app-surface px-4 py-2 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-ground">{h.createdAt}</span>
                      <a
                        href={`/api/demo/qa-report/${h.id}`}
                        className="text-state-info underline"
                      >
                        Manifest
                      </a>
                    </div>
                    <p className="measure text-xs text-olive">
                      {h.rowCount} rows · {h.requestedByName ?? "unattributed"} ·{" "}
                      {h.downloadCount === 0
                        ? "not downloaded"
                        : `downloaded ${h.downloadCount}×`}{" "}
                      · &ldquo;{h.purpose}&rdquo;
                    </p>
                  </li>
                ))}
              </ul>
              <p className="measure mt-2 text-xs text-olive">
                This is the disclosure log for the QA report. A console that can release a file
                but cannot show what it has released has an audit trail nobody can read.
              </p>
            </div>
          )}
        </Panel>

        <Panel
          title={PENDING.length === 0 ? "What is not on this screen" : "Controls that are not built"}
          footnote="Handoff 07 p9 specifies six controls. A control that does not work is never rendered as a disabled button — one a presenter might click mid-demonstration is worse than a sentence saying it does not exist."
        >
          {PENDING.length === 0 ? (
            <p className="measure text-sm text-ground">
              All six controls exist above. This panel stays because the list it holds is the
              first thing to fill in again: a screen that had a place for its own gaps and then
              deleted the place is one where the next gap has nowhere to be written down.
            </p>
          ) : (
            <dl className="divide-y divide-ground/5">
              {PENDING.map((p) => (
                <div key={p.control} className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
                  <dt className="text-sm font-medium text-app-ink">{p.control}</dt>
                  <dd className="measure text-sm text-ground">
                    {p.behavior}
                    <span className="mt-0.5 block text-xs text-olive">Needs: {p.needs}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {/* The self-referential version of this paragraph — "this used to say
              the control was not exposed here yet" — was written and removed in
              the same pass. A screen that narrates its own history is doing the
              thing this panel exists to warn against; the note belongs in the
              commit, which has it. */}
          <p className="measure mt-4 text-sm text-olive">
            The same rebuild runs from the command line —{" "}
            <code className="font-mono text-xs">npm run demo -- reset</code> — through this
            same path, so the two cannot produce subtly different datasets.
          </p>
        </Panel>

        <Panel title="Signed in as">
          <p className="text-sm text-ground">
            {user.name} · <span className="font-mono text-xs text-olive">{user.email}</span>
          </p>
        </Panel>
      </div>
    </AppShell>
  );
}

function Row({
  label, value, detail, href, bad,
}: {
  label: string; value: string; detail: string; href?: string; bad?: boolean;
}) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-sm font-medium text-app-ink">{label}</dt>
      <dd className="text-sm">
        <span className={bad ? "font-semibold text-state-support" : "text-ground"}>{value}</span>
        <span className="measure mt-0.5 block text-xs text-olive">
          {detail}
          {href && (
            <>
              {" "}
              <a href={href} className="text-state-info underline">
                Open
              </a>
            </>
          )}
        </span>
      </dd>
    </div>
  );
}

/** p9's six controls, minus the ones that exist. Advance clock left this list
 *  when it was built; the row is removed rather than struck through, because a
 *  screen that keeps a record of what it used to lack is a screen nobody
 *  trusts to be current. Each says what it needs, so
 *  the gap is a piece of work rather than a mystery. */
const PENDING: Array<{ control: string; behavior: string; needs: string }> = [
];
