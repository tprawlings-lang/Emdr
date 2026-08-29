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

        <Panel
          title="Controls that are not built"
          footnote="Handoff 07 p9 specifies six. None of the remaining five is rendered as a disabled button — a control a presenter might click mid-demonstration is worse than a sentence saying it does not exist."
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

/** p9's six controls, minus the ones that exist. Each says what it needs, so
 *  the gap is a piece of work rather than a mystery. */
const PENDING: Array<{ control: string; behavior: string; needs: string }> = [
  {
    control: "Reset dataset",
    behavior: "Recreate all seed records and projections, with a typed confirmation and a reason.",
    needs: "A recorded reset reason and an audit event — p9's guard, and the reason is the part that is missing.",
  },
  {
    control: "Advance clock",
    behavior: "Move the demo date to a scripted milestone, with the clock shown in the shell.",
    needs: "A demo clock. Every timestamp today derives from the real one.",
  },
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
