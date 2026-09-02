import { AppShell } from "@/components/app/AppShell";
import { Panel, Note, WithNote, SummaryCards } from "@/components/app/surfaces";
import { requireDemoAdmin } from "@/lib/auth";
import { logout } from "@/lib/actions";
import { DEMO_ROLES } from "@/lib/roles";
import { data } from "@/lib/data";
import { replayScenarios } from "@/lib/safety/scenarios";
import { ADMIN_RAIL } from "@/lib/app/rails";
import { getDb } from "@/lib/db";
import { runQualityChecks, qualitySummary } from "@/lib/demo-quality";
import { MILESTONES, readClock } from "@/lib/demo-clock";
import { advanceDemoClock } from "@/lib/demo-clock-actions";
import { resetDemoEnvironment } from "@/lib/demo-reset-actions";

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

  const scenarios = replayScenarios();
  const failing = scenarios.filter((s) => !s.pass).length;

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
          <form action={resetDemoEnvironment} className="mt-4 space-y-4">
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
          title="Controls that are not built"
          footnote="Handoff 07 p9 specifies six; three are built. None of the remaining four is rendered as a disabled button — a control a presenter might click mid-demonstration is worse than a sentence saying it does not exist."
        >
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
          <p className="measure mt-4 text-sm text-olive">
            Resetting the dataset is available from the command line today —{" "}
            <code className="font-mono text-xs">npm run demo -- reset</code> — which rebuilds
            from seed and prints a baseline hash. It is not exposed here yet because p9 requires
            a typed confirmation and a recorded reason, and a reset without a reason is the
            &ldquo;hand-edit the demo&rdquo; failure under a different name.
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
  {
    control: "Inject scenario",
    behavior: "Apply an approved, versioned event bundle such as a safety pause; reversible by reset.",
    needs: "A versioned scenario bundle format.",
  },
  {
    control: "Validate projections",
    behavior: "Rebuild every projection and compare hashes; fail the page if any role's view differs.",
    needs: "Expected projection hashes in the seed manifest — handoff 07 Wave 2.",
  },
  {
    control: "Export QA report",
    behavior: "A manifest of counts, hashes and failed checks, labelled fabricated on every page.",
    needs: "The checks themselves now run above; what is missing is releasing them as a signed file through the governed export.",
  },
];
