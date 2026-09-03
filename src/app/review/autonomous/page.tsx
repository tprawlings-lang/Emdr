import Link from "next/link";
import { requestNow } from "@/lib/request-clock";
import { ReviewPage } from "@/components/clinical/ReviewPage";
import { requireClinician } from "@/lib/auth";
import { recentAuditEvents } from "@/lib/audit";
import {
  evaluateAccess,
  orchestrateNext,
  JourneyStage,
  validateCompanionOutput,
  safetyCoreStatus,
  AccessTier,
  RULES,
  SESSION_RULES,
  EXPERIENCE_RULES,
  voiceInputEnabled,
  newSession,
  preSessionCheck,
  postSet,
  type SafetyInputs,
  type SessionDecision,
} from "@/lib/safety";
import { getRuleSignoffs, signoffProgress } from "@/lib/safety/signoff";
import { recordRuleSignoff } from "@/lib/actions";
import VoiceReviewDemo from "@/components/VoiceReviewDemo";
import { MODALITIES, TECHNIQUES, THERAPY_KB_RULES } from "@/lib/therapy-kb";
import { TIER_LABEL } from "@/lib/safety";

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
  [AccessTier.CRISIS]: "bg-state-support-bg/60 text-state-support border-state-support/40",
  [AccessTier.GROUNDING_ONLY]: "bg-state-caution-bg text-ground border-state-caution/40",
  [AccessTier.STABILIZATION]: "bg-state-info-bg/60 text-ground border-state-info/40",
  [AccessTier.CAUTIOUS]: "bg-linen text-ground border-ground/20",
  [AccessTier.STEADY]: "bg-state-safe-bg/60 text-ground border-state-safe/40",
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
      // Default-checked "feels safe" is only uncheckable once the form has been
      // submitted (the _sim sentinel); before that it defaults to safe.
      feelsSafe: sp._sim ? on(sp.feelsSafe) : true,
      dissociation: num(sp.dissociation, 0),
      sleepQuality: num(sp.sleep, 7),
      substanceFlag: on(sp.substance),
    };
  }
  return inputs;
}

export default async function AutonomousReview({ searchParams }: { searchParams: Promise<SP> }) {
  await requireClinician();
  // The page's clock, read once. Every "how long ago" and every gate below
  // uses this reading, so nothing on the screen can disagree with anything
  // else about what time it is.
  const now = requestNow();
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

  // Session-runtime simulator: starting-SUDS gate, then one post-set reading.
  let sessionResult: SessionDecision | null = null;
  if (sp.s_startSuds) {
    const startSuds = num(sp.s_startSuds, 3);
    // ONE reading. The simulator took two — one to derive the start time and
    // one to evaluate the post-set — so the elapsed time it simulated included
    // however long the render itself took. Small, and wrong in a screen whose
    // whole purpose is to show a reviewer what the engine decides.
    const startedAtMs = now - num(sp.s_minutes, 0) * 60000;
    const pre = preSessionCheck(newSession(startedAtMs), startSuds);
    if (pre.action === "deny_stimulation" || !sp.s_postSuds) {
      sessionResult = pre;
    } else {
      const st = { ...pre.state, setsCompleted: num(sp.s_sets, 0) };
      sessionResult = postSet(
        st,
        {
          suds: num(sp.s_postSuds, startSuds),
          dissociation: num(sp.s_dissociation, 0),
          oriented: sp._ssim ? on(sp.s_oriented) : true,
        },
        now
      );
    }
  }

  const shadow = (await recentAuditEvents(400)).filter(
    (e) => e.event_type.startsWith("safety_routing") || e.event_type.startsWith("companion_output")
  );

  const signoffs = await getRuleSignoffs();
  const allRules = [...RULES, ...SESSION_RULES, ...EXPERIENCE_RULES, ...THERAPY_KB_RULES];
  const progress = signoffProgress(allRules.map((r) => r.id), signoffs);
  const verdictBadge = (ruleId: string) => {
    const v = signoffs.get(ruleId)?.verdict;
    if (v === "agree") return <span className="ml-2 rounded bg-state-safe-bg/60 px-1.5 py-0.5 text-[10px] text-ground">agreed</span>;
    if (v === "needs_change") return <span className="ml-2 rounded bg-state-support-bg/60 px-1.5 py-0.5 text-[10px] text-state-support">needs change</span>;
    return <span className="ml-2 rounded bg-linen px-1.5 py-0.5 text-[10px] text-olive">unreviewed</span>;
  };
  const registerRow = (r: { id: string; category: string; reason: string }) => {
    const current = signoffs.get(r.id);
    return (
      <div key={r.id} className="rounded-lg border border-ground/10 bg-linen/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <code className="text-xs font-medium">{r.id}</code>
          <span className="text-[10px] text-olive">({r.category})</span>
          {verdictBadge(r.id)}
        </div>
        <p className="mt-0.5 text-xs text-ground/70">{r.reason}</p>
        <form action={recordRuleSignoff} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="rule_id" value={r.id} />
          <input
            name="note"
            defaultValue={current?.note ?? ""}
            placeholder="optional note"
            className="min-w-40 flex-1 rounded border border-ground/15 bg-ivory px-2 py-1 text-xs"
          />
          <button name="verdict" value="agree" className="rounded-full bg-state-safe-bg/60 px-3 py-1 text-xs font-medium text-ground hover:bg-state-safe-bg/60">
            Agree
          </button>
          <button name="verdict" value="needs_change" className="rounded-full bg-state-support-bg/60 px-3 py-1 text-xs font-medium text-state-support hover:bg-state-support/25">
            Needs change
          </button>
        </form>
      </div>
    );
  };

  const field = "mt-1 w-full rounded-lg border border-ground/15 bg-ivory px-3 py-1.5 text-sm";
  const chk = "flex items-center gap-2 text-sm text-ground/90";

  return (
    <ReviewPage
      layer="evidence"
      here="/review/autonomous"
      title="Autonomous review"
      lede="The engine's parallel decision, beside the one that governed. Neither is a model's opinion."
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="mt-1 text-sm text-olive">Beta sign-off workbench — simulate decisions and review shadow-mode activity.</p>
        </div>
        <Link href="/clinician" className="text-sm text-olive underline">← Clinician dashboard</Link>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-ground/15 bg-linen px-3 py-1">config {status.configVersion}</span>
        <span className="rounded-full border border-state-caution/40 bg-state-caution-bg px-3 py-1">mode: {status.mode}</span>
        <span className="rounded-full border border-ground/15 bg-linen px-3 py-1">governance: {status.governanceEnabled ? "ON" : "off"}</span>
        <span className="rounded-full border border-state-support/40 bg-state-support-bg/60 px-3 py-1 text-state-support">provisional — sign-off required</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <span className="font-medium text-olive">Rule sign-off:</span>
        <span className="rounded bg-state-safe-bg/60 px-2 py-0.5">{progress.agreed} agreed</span>
        <span className="rounded bg-state-support-bg/60 px-2 py-0.5 text-state-support">{progress.needsChange} needs change</span>
        <span className="rounded bg-linen px-2 py-0.5 text-olive">{progress.unreviewed} unreviewed</span>
        <span className="text-olive">of {progress.total} rules</span>
        <a href="#register" className="underline text-olive">go to register ↓</a>
      </div>

      <p className="mt-4 rounded-xl border border-ground/15 bg-linen px-4 py-3 text-sm text-ground/80">
        Everything below is <strong>simulation and observation only</strong>. The engine is in shadow mode and governs
        nothing a member sees. Values are provisional pending your sign-off — see
        {" "}<code className="text-xs">docs/autonomous/01-signoff-ledger.md</code>.
      </p>

      {/* ── Decision simulator ─────────────────────────────────────────── */}
      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <form method="get" className="rounded-2xl border border-ground/15 bg-white p-5">
          <h2 className="type-display text-xl">Simulate a decision</h2>
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
            <label className={chk}><input type="checkbox" name="feelsSafe" defaultChecked={sp._sim ? on(sp.feelsSafe) : true} /> feels safe</label>
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
          <input type="hidden" name="_sim" value="1" />
          <button type="submit" className="mt-5 w-full rounded-full bg-sage px-5 py-2.5 text-sm font-medium text-ground hover:bg-sage-deep">
            Evaluate
          </button>
        </form>

        {/* ── Decision result ──────────────────────────────────────────── */}
        <div className="rounded-2xl border border-ground/15 bg-white p-5">
          <h2 className="type-display text-xl">What the engine decides</h2>
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
            decision.dispositions.humanReviewPending || decision.dispositions.presentSafetyClarificationRequired ||
            decision.dispositions.jurisdictionAwareResources || decision.dispositions.reviewTriggered ||
            decision.dispositions.urgentMedicalReferral ||
            decision.dispositions.autoRefund || decision.dispositions.cooldownUntil ||
            decision.dispositions.forcedStabilizationUntil) && (
            <div className="mt-4">
              <p className="text-xs font-medium text-olive">Dispositions</p>
              <ul className="mt-1 flex flex-wrap gap-1.5 text-xs">
                {decision.dispositions.crisis && <li className="rounded bg-state-support-bg/60 px-2 py-0.5 text-state-support">crisis pathway</li>}
                {decision.dispositions.presentSafetyClarificationRequired && <li className="rounded bg-state-support-bg/60 px-2 py-0.5 text-state-support">present-safety clarification</li>}
                {decision.dispositions.jurisdictionAwareResources && <li className="rounded bg-linen px-2 py-0.5">jurisdiction-aware resources</li>}
                {decision.dispositions.humanReviewPending && <li className="rounded bg-linen px-2 py-0.5">human review pending</li>}
                {decision.dispositions.reviewTriggered && <li className="rounded bg-linen px-2 py-0.5">review trigger</li>}
                {decision.dispositions.urgentMedicalReferral && <li className="rounded bg-linen px-2 py-0.5">urgent medical referral</li>}
                {decision.dispositions.safetyQuestionRequired && <li className="rounded bg-linen px-2 py-0.5">safety question</li>}
                {decision.dispositions.referralSurfaced && <li className="rounded bg-linen px-2 py-0.5">referral</li>}
                {decision.dispositions.standingExclusion && <li className="rounded bg-linen px-2 py-0.5">standing exclusion</li>}
                {decision.dispositions.autoRefund && <li className="rounded bg-linen px-2 py-0.5">auto-refund</li>}
                {decision.dispositions.cooldownUntil && <li className="rounded bg-linen px-2 py-0.5">cooldown</li>}
                {decision.dispositions.forcedStabilizationUntil && <li className="rounded bg-linen px-2 py-0.5">forced stabilization</li>}
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
                    {verdictBadge(h.id)}
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
        <h2 className="type-display text-xl">Test a companion message</h2>
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
              <p className="rounded-lg bg-state-safe-bg/60 px-3 py-2">✓ Passes the output guard.</p>
            ) : (
              <div className="rounded-lg bg-state-support-bg/60 px-3 py-2 text-state-support">
                ✗ Blocked — {guard.violations.map((v) => v.kind).join(", ")}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Shadow-mode activity ───────────────────────────────────────── */}
      <section className="mt-8 rounded-2xl border border-ground/15 bg-white p-5">
        <h2 className="type-display text-xl">Recent shadow decisions ({shadow.length})</h2>
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

      {/* ── Session-runtime simulator ──────────────────────────────────── */}
      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <form method="get" className="rounded-2xl border border-ground/15 bg-white p-5">
          <h2 className="type-display text-xl">Simulate a session step</h2>
          <p className="mt-1 text-xs text-olive">Validate the in-session SUDS / containment rules.</p>
          {Object.entries(sp).filter(([k]) => !k.startsWith("s_") && k !== "_ssim").map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v ?? ""} />
          ))}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="text-sm">Starting SUDS (0–10)
              <input className={field} type="number" min="0" max="10" name="s_startSuds" defaultValue={sp.s_startSuds ?? "3"} />
            </label>
            <label className="text-sm">Post-set SUDS (0–10)
              <input className={field} type="number" min="0" max="10" name="s_postSuds" defaultValue={sp.s_postSuds ?? ""} placeholder="—" />
            </label>
            <label className="text-sm">Dissociation (0–10)
              <input className={field} type="number" min="0" max="10" name="s_dissociation" defaultValue={sp.s_dissociation ?? "0"} />
            </label>
            <label className="text-sm">Sets already done
              <input className={field} type="number" min="0" max="3" name="s_sets" defaultValue={sp.s_sets ?? "0"} />
            </label>
            <label className="text-sm">Minutes elapsed
              <input className={field} type="number" min="0" max="60" name="s_minutes" defaultValue={sp.s_minutes ?? "0"} />
            </label>
            <label className={`${chk} mt-6`}><input type="checkbox" name="s_oriented" defaultChecked={sp._ssim ? on(sp.s_oriented) : true} /> oriented</label>
          </div>
          <input type="hidden" name="_ssim" value="1" />
          <button type="submit" className="mt-5 w-full rounded-full bg-sage px-5 py-2.5 text-sm font-medium text-ground hover:bg-sage-deep">
            Evaluate session step
          </button>
        </form>

        <div className="rounded-2xl border border-ground/15 bg-white p-5">
          <h2 className="type-display text-xl">What the session engine decides</h2>
          {!sessionResult ? (
            <p className="mt-3 text-sm text-ground/70">Enter a starting SUDS (and optionally a post-set reading) to evaluate.</p>
          ) : (
            <>
              <div className={`mt-3 inline-flex rounded-full border px-4 py-1.5 text-sm font-medium ${
                sessionResult.action === "containment" || sessionResult.action === "deny_stimulation"
                  ? "bg-state-support-bg/60 text-state-support border-state-support/40"
                  : sessionResult.action === "pause" || sessionResult.action === "closure"
                    ? "bg-state-caution-bg text-ground border-state-caution/40"
                    : "bg-state-safe-bg/60 text-ground border-state-safe/40"
              }`}>
                {sessionResult.action}
              </div>
              <p className="mt-3 text-sm text-ground/80">{sessionResult.reason}</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-olive">May offer next set</dt><dd>{sessionResult.allowNextSet ? "yes" : "no"}</dd>
                {sessionResult.effects.cooldownHours ? (<><dt className="text-olive">Cooldown</dt><dd>{sessionResult.effects.cooldownHours}h</dd></>) : null}
                {sessionResult.effects.lockStimulation ? (<><dt className="text-olive">Stimulation</dt><dd>locked for session</dd></>) : null}
                {sessionResult.effects.requireOrientation ? (<><dt className="text-olive">Requires</dt><dd>re-orientation</dd></>) : null}
                {sessionResult.effects.alert ? (<><dt className="text-olive">Alert logged</dt><dd><code className="text-xs">{sessionResult.effects.alert}</code></dd></>) : null}
              </dl>
            </>
          )}
        </div>
      </section>

      {/* ── Voice responses (hear the member) ──────────────────────────── */}
      <section id="voice" className="mt-8 rounded-2xl border border-ground/15 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="type-display text-xl">Voice responses — hear the member</h2>
          <span className={`rounded-full px-3 py-1 text-xs ${voiceInputEnabled() ? "bg-state-safe-bg/60 text-ground" : "bg-linen text-olive"}`}>
            {voiceInputEnabled() ? "on in this demo" : "off"}
          </span>
        </div>
        <p className="mt-1 text-sm text-ground/80">
          Members can answer a free-text reflection by speaking instead of typing — the human
          feel of being heard. Below is exactly what a member sees, for you to try and sign off.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <VoiceReviewDemo />
          <div className="rounded-xl border border-ground/10 bg-linen/40 p-4 text-xs leading-relaxed text-ground/80">
            <p className="text-sm font-medium text-ground">How it works &amp; where it stops</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-4">
              <li><strong>Typing always works.</strong> Voice is an accessibility option, never required; deaf and hard-of-hearing members keep a fully equivalent typed path.</li>
              <li><strong>Confirm before it counts.</strong> Recognized text lands in an editable box the member reads and corrects — recognition errors can’t silently enter the record.</li>
              <li><strong>Free-text only.</strong> Never distress (SUDS) ratings, fit-screening, or any safety-gate answer — those stay explicit taps.</li>
              <li><strong>Audio never leaves the device</strong> in the shipped app (on-device recognition); Steady keeps only the confirmed transcript, encrypted like typed text. This in-browser preview uses the browser’s recognizer.</li>
              <li><strong>Consent-gated &amp; off by default</strong> outside demo — voice can be biometric data; needs a distinct versioned consent + counsel review first.</li>
            </ul>
            <p className="mt-2 text-olive">
              Record your verdict on each of these guardrails in the register below
              (<code>VOICE_INPUT_*</code>).
            </p>
          </div>
        </div>
      </section>

      {/* ── Rule sign-off register ─────────────────────────────────────── */}
      <section id="register" className="mt-8 rounded-2xl border border-ground/15 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="type-display text-xl">Rule sign-off register</h2>
          <a href="/review/autonomous/export" className="rounded-full border border-ground/20 bg-linen px-3 py-1 text-xs font-medium text-ground hover:bg-state-info-bg/60">
            Export CSV ↓
          </a>
        </div>
        <p className="mt-1 text-xs text-olive">
          Record your verdict on each deterministic rule at config {status.configVersion}. Verdicts reset if a
          threshold changes. These write to the tamper-evident audit log.
        </p>
        <div className="mt-4 space-y-2">{RULES.map(registerRow)}</div>
      </section>

      {/* ── Session-rule sign-off register ─────────────────────────────── */}
      <section id="session-register" className="mt-8 rounded-2xl border border-ground/15 bg-white p-5">
        <h2 className="type-display text-xl">Session-rule sign-off register</h2>
        <p className="mt-1 text-xs text-olive">
          The in-session SUDS / containment / closure / BLS thresholds (§ session engine). Same
          Agree / Needs-change record as the access rules; verdicts reset if a threshold changes.
        </p>
        <div className="mt-4 space-y-2">{SESSION_RULES.map(registerRow)}</div>
      </section>

      {/* ── Experience & input feature sign-off register ───────────────── */}
      <section id="experience-register" className="mt-8 rounded-2xl border border-ground/15 bg-white p-5">
        <h2 className="type-display text-xl">Experience &amp; input feature sign-off</h2>
        <p className="mt-1 text-xs text-olive">
          Member-facing interaction features that carry safety, privacy, or accessibility weight
          (e.g. voice responses). Same Agree / Needs-change record; included in the CSV export.
        </p>
        <div className="mt-4 space-y-2">{EXPERIENCE_RULES.map(registerRow)}</div>
      </section>

      {/* ── Therapy knowledge base ─────────────────────────────────────── */}
      <section id="therapy-kb" className="mt-8 rounded-2xl border border-ground/15 bg-white p-5">
        <h2 className="type-display text-xl">Therapy knowledge base</h2>
        <p className="mt-1 text-sm text-ground/80">
          The companion&apos;s technique library — {TECHNIQUES.length} techniques across{" "}
          {MODALITIES.length} modalities, each gated by minimum tier and an activation ceiling.
          Retrieval is deterministic (same member state → same selection); everything the model
          says still passes the output guard. Review each modality&apos;s techniques below, then
          record verdicts in the register.
        </p>

        <div className="mt-4 space-y-3">
          {MODALITIES.map((m) => {
            const techs = TECHNIQUES.filter((t) => t.modality === m.id);
            return (
              <details key={m.id} className="rounded-xl border border-ground/10 bg-linen/40 p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  {m.name} <span className="ml-1 text-xs text-olive">({techs.length} technique{techs.length === 1 ? "" : "s"})</span>
                </summary>
                <p className="mt-2 text-xs text-ground/70">{m.rationale}</p>
                <div className="mt-2 space-y-2">
                  {techs.map((t) => (
                    <div key={t.id} className="rounded-lg border border-ground/10 bg-ivory px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="font-medium">{t.id}</code>
                        <span className="rounded bg-linen px-1.5 py-0.5 text-[10px] text-olive">{t.category}</span>
                        <span className="rounded bg-state-caution-bg px-1.5 py-0.5 text-[10px]">min tier: {TIER_LABEL[t.minTier]}</span>
                        <span className="rounded bg-state-caution-bg px-1.5 py-0.5 text-[10px]">max activation: {t.maxActivation}/10</span>
                      </div>
                      <p className="mt-1 text-ground/80"><span className="font-medium">{t.name}</span> — {t.purpose}</p>
                      <p className="mt-1 text-ground/70">{t.guidance}</p>
                      {t.avoidWhen.length > 0 && (
                        <p className="mt-1 text-state-support">Avoid when: {t.avoidWhen.join("; ")}</p>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            );
          })}
        </div>

        <h3 className="mt-6 type-display text-lg">Knowledge-base sign-off register</h3>
        <p className="mt-1 text-xs text-olive">
          Global constraints first, then one verdict per modality (covering its techniques as a
          set). Same Agree / Needs-change record; included in the CSV export.
        </p>
        <div className="mt-3 space-y-2">{THERAPY_KB_RULES.map(registerRow)}</div>
      </section>
    </ReviewPage>
  );
}
