import type { EnvironmentStatus } from "@/lib/demo/preflight";
import type { EnvironmentLock } from "@/lib/demo/environment-lock";

// Environment health (handoff 09 §7.3; Package 4).
//
// §7.3: "Lead with environment health and failed preflight… move dataset
// hashes, provider versions, and detailed logs into an environment drawer. A
// 64-character fingerprint in the routine header is reading burden without
// benefit."
//
// SO THE FAILURES ARE THE HEADLINE AND THE HASH IS BEHIND A DISCLOSURE. That
// is the whole layout decision, and it inverts what this kind of screen
// usually does: a status page tends to lead with everything it knows, which
// puts a sha256 where a presenter's eye lands and buries the one line saying
// the rebuild failed.
//
// AND `ready` IS ONE WORD WITH NO QUALIFIER. There is no "ready with
// warnings", because a presenter reading "ready" has stopped reading — which
// is correct behaviour, and the reason the word has to mean it. The state
// comes from `environmentStatus`, where `ready` is unreachable while the last
// reset attempt is a recorded failure.

export function EnvironmentHealth({
  status,
  lock,
}: {
  status: EnvironmentStatus;
  lock: EnvironmentLock | null;
}) {
  const ready = status.state === "ready";

  return (
    <section
      aria-labelledby="env-health"
      className={`rounded-2xl border px-6 py-5 ${
        ready ? "border-ground/15 bg-linen/40" : "border-pause/60 bg-pause-soft"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="env-health" className="type-display text-lg font-medium text-ground">
          {ready ? "Environment ready" : "Environment not ready"}
        </h2>
        {/* Simulated time stays visible (§7.3), and so does the fabricated
            label — which the site chrome already carries on every page. */}
        <span className="text-xs text-olive">
          Dataset {status.drawer.datasetVersion}
        </span>
      </div>

      {/* Failures first and in full. A count is not a lead: "2 checks failing"
          makes a presenter go looking three minutes before a meeting. */}
      {status.failures.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {status.failures.map((f) => (
            <li key={f.id} className="rounded-xl bg-ivory/70 px-4 py-3">
              <p className="text-sm font-semibold text-ground">
                {f.label}: {f.actual}
              </p>
              <p className="measure mt-0.5 text-sm text-ground/85">{f.matters}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="measure mt-2 text-sm text-ground/85">
          All {status.checks.length} preflight checks pass against the live database, computed
          now rather than recorded at build time.
        </p>
      )}

      {lock && (
        <p className="mt-3 rounded-xl border border-ground/20 bg-ivory px-4 py-3 text-sm text-ground">
          {lock.heldByName ?? "An operator"} is running &ldquo;{lock.scenarioId}&rdquo;
          {lock.stale
            ? ` — started ${lock.minutesHeld} minutes ago and probably finished.`
            : ` — started ${lock.minutesHeld} minutes ago.`}
        </p>
      )}

      {/* §7.3's drawer. Everything a presenter does not need in the header and
          an engineer does need at 2pm on the day something looks wrong. */}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-state-info">Environment detail</summary>
        <dl className="mt-2 space-y-1 text-xs text-olive">
          <div>
            <dt className="inline font-medium text-ground">Baseline hash: </dt>
            <dd className="inline break-all font-mono">{status.drawer.baselineHash}</dd>
          </div>
          {Object.entries(status.drawer.counts).map(([k, v]) => (
            <div key={k}>
              <dt className="inline font-medium text-ground">{k}: </dt>
              <dd className="inline">{v.toLocaleString()}</dd>
            </div>
          ))}
          <div>
            <dt className="inline font-medium text-ground">Last rebuild: </dt>
            <dd className="inline">
              {status.lastReset
                ? `${status.lastReset.status} at ${status.lastReset.at}`
                : "none recorded on this environment"}
            </dd>
          </div>
        </dl>
        <ul className="mt-3 space-y-1 text-xs">
          {status.checks.map((c) => (
            <li key={c.id}>
              <span className={c.pass ? "text-state-safe" : "font-semibold text-state-support"}>
                {c.pass ? "✓" : "✕"}
              </span>{" "}
              <span className="text-ground">{c.label}</span>{" "}
              <span className="text-olive">— {c.actual}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
