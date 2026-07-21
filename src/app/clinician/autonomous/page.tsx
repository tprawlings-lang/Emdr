import Link from "next/link";
import { requireClinician } from "@/lib/auth";
import { recentAuditEvents } from "@/lib/audit";
import {
  evaluateAccess,
  orchestrateNext,
  JourneyStage,
  validateCompanionOutput,
  safetyCoreStatus,
  AccessTier,
  type SafetyInputs,
} from "@/lib/safety";

// Clinician "Autonomous Review" console (beta sign-off workbench). Lets a
// clinician (a) simulate any scenario and see exactly what the deterministic
// engine would gate or pass and WHY, and (b) review the real shadow decisions
// logged during beta. Read-only + pure compute; governs nothing. Demo/beta.
export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;
const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const on = (v: string | undefined) => v === "on";

const TIER_STYLE: Record<number, string> = {
  [AccessTier.CRISIS]: "bg-support/15 text-support-deep border-support/50",
  [AccessTier.GROUNDING_ONLY]: "bg-pause-soft text-ground border-pause/60",
  [AccessTier.STABILIZATION]: "bg-mist/25 text-ground border-mist/60",
  [AccessTier.CAUTIOUS]: "bg-linen text-ground border-ground/20",
  [AccessTier.STEADY]: "bg-safe/15 text-ground border-safe/50",
};

function buildInputs(sp: SP): SafetyInputs {
  const inputs: SafetyInputs = {
    nowMs: Date.now(),
    programFit: {
      under18: on(sp.under18),
      selfHarm30d: on(sp.fit_selfharm),
      unsafeSituation: on(sp.fit_unsafe),
      psychoticOrDissociativeDx: on(sp.fit_psychdx),
      hospitalized12m: on(sp.fit_hosp),
      substanceDependence: on(sp.fit_substance),
      seizureOrPhotosensitive: on(sp.fit_seizure),
      acuteMedical: on(sp.fit_acute),
    },
    instruments: {
      phq9Item9: sp.phq9item9 ? num(sp.phq9item9, 0) : undefined,
      pcl5Item16: sp.pcl5item16 ? num(sp.pcl5item16, 0) : undefined,
    },
    readiness: { track: (sp.track as "grounding" | "cautious" | "steady") || "steady" },
  };
  if (!on(sp.missingCheckin)) {
    inputs.dailyCheckin = {
      activation: num(sp.activation, 2),
      shutdown: num(sp.shutdown, 1),
      harmUrge: on(sp.harmUrge),
      feelsSafe: sp.feelsSafe === undefined ? true : on(sp.feelsSafe),
      dissociation: num(sp.dissociation, 0),
      sleepQuality: num(sp.sleep, 7),
      substanceFlag: on(sp.substance),
    };
  }
  return inputs;
}

export default async function AutonomousReview({ searchParams }: { searchParams: Promise<SP> }) {
  await requireClinician();
  const sp = await searchParams;
  const status = safetyCoreStatus();

  const inputs = buildInputs(sp);
  const decision = evaluateAccess(inputs);
  const orchestration = orchestrateNext(
    decision.dispositions.crisis ? JourneyStage.ElevatedRisk : JourneyStage.LongitudinalUse,
    decision
  );

  const companionText = sp.companionText ?? "";
  const guard = companionText ? validateCompanionOutput(companionText) : null;

  const shadow = recentAuditEvents(400).filter(
    (e) => e.event_type.startsWith("safety_routing") || e.event_type.startsWith("companion_output")
  );

  const field = "mt-1 w-full rounded-lg border border-ground/15 bg-ivory px-3 py-1.5 text-sm";
  const chk = "flex items-center gap-2 text-sm text-ground/90";

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-medium">Autonomous review console</h1>
          <p className="mt-1 text-sm text-olive">Beta sign-off workbench — simulate decisions and review shadow-mode activity.</p>
        </div>
        <Link href="/clinician" className="text-sm text-olive underline">← Clinician dashboard</Link>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-ground/15 bg-linen px-3 py-1">config {status.configVersion}</span>
        <span className="rounded-full border border-pause/50 bg-pause-soft px-3 py-1">mode: {status.mode}</span>
        <span className="rounded-full border border-ground/15 bg-linen px-3 py-1">governance: {status.governanceEnabled ? "ON" : "off"}</span>
        <span className="rounded-full border border-support/40 bg-support/10 px-3 py-1 text-support-deep">provisional — sign-off required</span>
      </div>

      <p className="mt-4 rounded-xl border border-ground/15 bg-linen px-4 py-3 text-sm text-ground/80">
        Everything below is <strong>simulation and observation only</strong>. The engine is in shadow mode and governs
        nothing a member sees. Values are provisional pending your sign-off — see
        {" "}<code className="text-xs">docs/autonomous/01-signoff-ledger.md</code>.
      </p>

      {/* ── Decision simulator ─────────────────────────────────────────── */}
      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <form method="get" className="rounded-2xl border border-ground/15 bg-white p-5">
          <h2 className="font-serif text-xl">Simulate a decision</h2>
          <p className="mt-1 text-xs text-olive">Set any scenario and see what would be gated or passed.</p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="text-sm">Activation (0–10)
              <input className={field} type="number" min="0" max="10" name="activation" defaultValue={sp.activation ?? "2"} />
            </label>
            <label className="text-sm">Shutdown (0–10)
              <input className={field} type="number" min="0" max="10" name="shutdown" defaultValue={sp.shutdown ?? "1"} />
            </label>
            <label className="text-sm">Dissociation (0–10)
              <input className={field} type="number" min="0" max="10" name="dissociation" defaultValue={sp.dissociation ?? "0"} />
            </label>
            <label className="text-sm">Sleep quality (0–10)
              <input className={field} type="number" min="0" max="10" name="sleep" defaultValue={sp.sleep ?? "7"} />
            </label>
            <label className="text-sm">PHQ-9 item 9 (0–3)
              <input className={field} type="number" min="0" max="3" name="phq9item9" defaultValue={sp.phq9item9 ?? ""} placeholder="—" />
            </label>
            <label className="text-sm">PCL-5 item 16 (0–4)
              <input className={field} type="number" min="0" max="4" name="pcl5item16" defaultValue={sp.pcl5item16 ?? ""} placeholder="—" />
            </label>
            <label className="text-sm col-span-2">Readiness track
              <select className={field} name="track" defaultValue={sp.track ?? "steady"}>
                <option value="grounding">grounding</option>
                <option value="cautious">cautious</option>
                <option value="steady">steady</option>
              </select>
            </label>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <label className={chk}><input type="checkbox" name="harmUrge" defaultChecked={on(sp.harmUrge)} /> harm urge</label>
            <label className={chk}><input type="checkbox" name="feelsSafe" defaultChecked={sp.feelsSafe === undefined ? true : on(sp.feelsSafe)} /> feels safe</label>
            <label className={chk}><input type="checkbox" name="substance" defaultChecked={on(sp.substance)} /> substance</label>
            <label className={chk}><input type="checkbox" name="missingCheckin" defaultChecked={on(sp.missingCheckin)} /> no check-in today</label>
          </div>

          <p className="mt-4 text-xs font-medium text-olive">Program-fit flags</p>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <label className={chk}><input type="checkbox" name="fit_selfharm" defaultChecked={on(sp.fit_selfharm)} /> self-harm 30d (state)</label>
            <label className={chk}><input type="checkbox" name="fit_unsafe" defaultChecked={on(sp.fit_unsafe)} /> unsafe situation (state)</label>
            <label className={chk}><input type="checkbox" name="fit_psychdx" defaultChecked={on(sp.fit_psychdx)} /> psychotic/dissoc. dx (trait)</label>
            <label className={chk}><input type="checkbox" name="fit_hosp" defaultChecked={on(sp.fit_hosp)} /> hospitalized 12m (trait)</label>
            <label className={chk}><input type="checkbox" name="fit_substance" defaultChecked={on(sp.fit_substance)} /> substance dependence (trait)</label>
            <label className={chk}><input type="checkbox" name="fit_seizure" defaultChecked={on(sp.fit_seizure)} /> seizure/photosensitive (soft)</label>
            <label className={chk}><input type="checkbox" name="fit_acute" defaultChecked={on(sp.fit_acute)} /> acute medical (soft)</label>
            <label className={chk}><input type="checkbox" name="under18" defaultChecked={on(sp.under18)} /> under 18</label>
          </div>

          {companionText ? <input type="hidden" name="companionText" value={companionText} /> : null}
          <button type="submit" className="mt-5 w-full rounded-full bg-sage px-5 py-2.5 text-sm font-medium text-ground hover:bg-sage-deep">
            Evaluate
          </button>
        </form>

        {/* ── Decision result ──────────────────────────────────────────── */}
        <div className="rounded-2xl border border-ground/15 bg-white p-5">
          <h2 className="font-serif text-xl">What the engine decides</h2>
          <div className={`mt-3 inline-flex rounded-full border px-4 py-1.5 text-sm font-medium ${TIER_STYLE[decision.tier]}`}>
            access ceiling: {decision.tierLabel}
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-olive">Activating session</dt>
            <dd className="font-medium">{decision.activatingSessionsAllowed ? "✓ allowed" : "✗ blocked"}</dd>
            <dt className="text-olive">Grounding only</dt>
            <dd>{decision.groundingOnly ? "yes" : "no"}</dd>
            <dt className="text-olive">Stimulation</dt>
            <dd>{decision.capabilities.stimulation ? "on" : "off"}</dd>
            <dt className="text-olive">Visual BLS</dt>
            <dd>{decision.capabilities.visualStimulation ? "on" : "off (beta)"}</dd>
            <dt className="text-olive">Imagery</dt>
            <dd>{decision.capabilities.imagery ? "on" : "off"}</dd>
            <dt className="text-olive">Member is routed to</dt>
            <dd className="font-medium">{orchestration.category} → {orchestration.route ?? "—"}</dd>
          </dl>

          {(decision.dispositions.crisis || decision.dispositions.safetyQuestionRequired ||
            decision.dispositions.referralSurfaced || decision.dispositions.standingExclusion ||
            decision.dispositions.autoRefund || decision.dispositions.cooldownUntil ||
            decision.dispositions.forcedStabilizationUntil) && (
            <div className="mt-4">
              <p className="text-xs font-medium text-olive">Dispositions</p>
              <ul className="mt-1 flex flex-wrap gap-1.5 text-xs">
                {decision.dispositions.crisis && <li className="rounded bg-support/10 px-2 py-0.5 text-support-deep">crisis pathway</li>}
                {decision.dispositions.safetyQuestionRequired && <li className="rounded bg-linen px-2 py-0.5">safety question</li>}
                {decision.dispositions.referralSurfaced && <li className="rounded bg-linen px-2 py-0.5">referral</li>}
                {decision.dispositions.standingExclusion && <li className="rounded bg-linen px-2 py-0.5">standing exclusion</li>}
                {decision.dispositions.autoRefund && <li className="rounded bg-linen px-2 py-0.5">auto-refund</li>}
                {decision.dispositions.cooldownUntil && <li className="rounded bg-linen px-2 py-0.5">cooldown</li>}
                {decision.dispositions.forcedStabilizationUntil && <li className="rounded bg-linen px-2 py-0.5">72h stabilization</li>}
              </ul>
            </div>
          )}

          <div className="mt-4">
            <p className="text-xs font-medium text-olive">Rules fired ({decision.hits.length})</p>
            {decision.hits.length === 0 ? (
              <p className="mt-1 text-sm text-ground/70">No restrictions — clear at the readiness ceiling.</p>
            ) : (
              <ul className="mt-1 space-y-1.5">
                {decision.hits.map((h) => (
                  <li key={h.id} className="rounded-lg border border-ground/10 bg-linen/60 px-3 py-2 text-sm">
                    <code className="text-xs font-medium text-ground">{h.id}</code>
                    <span className="ml-2 text-xs text-olive">({h.category})</span>
                    <p className="mt-0.5 text-ground/80">{h.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* ── Companion output tester ────────────────────────────────────── */}
      <section className="mt-8 rounded-2xl border border-ground/15 bg-white p-5">
        <h2 className="font-serif text-xl">Test a companion message</h2>
        <p className="mt-1 text-xs text-olive">Paste a candidate reply to see whether the output guard would allow it.</p>
        <form method="get" className="mt-3">
          {Object.entries(sp).filter(([k]) => k !== "companionText").map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v ?? ""} />
          ))}
          <textarea name="companionText" defaultValue={companionText} rows={3} className="w-full rounded-lg border border-ground/15 bg-ivory px-3 py-2 text-sm" placeholder="e.g. I care about you and want you to be safe…" />
          <button type="submit" className="mt-2 rounded-full bg-sage px-5 py-2 text-sm font-medium text-ground hover:bg-sage-deep">Check</button>
        </form>
        {guard && (
          <div className="mt-3 text-sm">
            {guard.ok ? (
              <p className="rounded-lg bg-safe/15 px-3 py-2">✓ Passes the output guard.</p>
            ) : (
              <div className="rounded-lg bg-support/10 px-3 py-2 text-support-deep">
                ✗ Blocked — {guard.violations.map((v) => v.kind).join(", ")}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Shadow-mode activity ───────────────────────────────────────── */}
      <section className="mt-8 rounded-2xl border border-ground/15 bg-white p-5">
        <h2 className="font-serif text-xl">Recent shadow decisions ({shadow.length})</h2>
        <p className="mt-1 text-xs text-olive">Real autonomous decisions logged during beta (coded, no free text).</p>
        {shadow.length === 0 ? (
          <p className="mt-3 text-sm text-ground/70">No shadow decisions logged yet — they appear as members use the app.</p>
        ) : (
          <div className="mt-3 max-h-96 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-olive">
                <tr><th className="py-1 pr-3">when</th><th className="pr-3">event</th><th>detail</th></tr>
              </thead>
              <tbody>
                {shadow.slice(0, 100).map((e) => (
                  <tr key={e.id} className="border-t border-ground/10 align-top">
                    <td className="py-1.5 pr-3 whitespace-nowrap text-ground/70">{e.created_at}</td>
                    <td className="pr-3"><code>{e.event_type}</code></td>
                    <td className="text-ground/80"><code className="break-all">{e.detail_json}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
