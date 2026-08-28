import Link from "next/link";
import { requireClinician } from "@/lib/auth";
import {
  PART6_GATES, GATE_STATE_LABEL, rolloutStages, runningConfig, oversightStatus,
  HARD_STOPS, PRE_REGISTERED, REAL_USE_NOTE, type GateState,
} from "@/lib/clinical/bls-oversight";
import { NoteForm } from "@/components/clinical/NoteForm";

export const dynamic = "force-dynamic";

// BLS Part 6 oversight console (Phase 4).
//
// The protocol documents say what should be true. This page says what IS true
// of the running configuration, read from the same functions the runtime uses.
// The two drifting apart — a signed protocol saying desensitization is off
// while a flag turned it on — is the failure this exists to make visible.
//
// It governs nothing. Enabling and disabling happen in the safety layer and in
// environment configuration, which is where they have been reviewed.

const GATE_STYLE: Record<GateState, string> = {
  met: "border-safe/40 bg-safe/10",
  open: "border-pause/60 bg-pause-soft",
  blocked: "border-support/50 bg-support/10",
};

function Flag({ on, label, onText, offText }: {
  on: boolean; label: string; onText: string; offText: string;
}) {
  return (
    <div
      data-testid="bls-flag"
      className={`rounded-2xl border px-4 py-3 ${on ? "border-pause/60 bg-pause-soft" : "border-ground/15 bg-linen/40"}`}
    >
      <p className="text-xs uppercase tracking-wide text-olive">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-ground">{on ? onText : offText}</p>
    </div>
  );
}

export default async function BlsOversightPage() {
  await requireClinician();

  const cfg = runningConfig();
  const status = oversightStatus();
  const stages = rolloutStages();

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="type-display text-3xl font-medium">BLS Part 6 oversight</h1>
          <p className="text-sm text-olive">
            Bilateral-stimulation validation workstream · protocol signed, not approved for use
          </p>
        </div>
      </div>

      <p className="mt-4 rounded-2xl border border-pause/50 bg-pause-soft px-4 py-3 text-sm text-ground">
        <strong>Not approved for real-person use.</strong> {REAL_USE_NOTE}
      </p>

      {/* ---------------- What is actually running ---------------- */}
      <section className="mt-10">
        <h2 className="type-display text-2xl font-medium">What is running right now</h2>
        <p className="mt-1 text-sm text-olive">
          Read from the safety configuration and environment, not transcribed from the
          protocol. If this disagrees with a document, this is the truth and the document is
          the bug.
        </p>

        <p
          data-testid="bls-headline"
          className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
            status.anyBlsPossible
              ? "border-pause/60 bg-pause-soft text-ground"
              : "border-safe/40 bg-safe/10 text-ground"
          }`}
        >
          {status.headline}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Flag
            on={cfg.killSwitchOn} label="Kill switch (EMDR_KILL_BLS)"
            onText="SET — all bilateral stimulation disabled globally"
            offText="Not set — the switch is available and not engaged"
          />
          <Flag
            on={cfg.resourcingFlagOn} label="Resourcing (stage 4a)"
            onText="Enabled — sessions may run; per-member consent is still required for each one"
            offText="Disabled — set EMDR_BLS_RESOURCING=1, or run with EMDR_DEMO=1"
          />
          <Flag
            on={cfg.desensitizationEnabled} label="Desensitization (safety config)"
            onText="ENABLED — this should not be true; escalate"
            offText="Disabled in the safety configuration. No environment flag can reach it"
          />
          <Flag
            on={cfg.visualStimulationEnabled} label="Visual stimulation"
            onText="Enabled"
            offText="Disabled pending accessibility and device validation"
          />
        </div>

        <div className="mt-4 rounded-2xl border border-ground/15 bg-linen/40 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-olive">Resourcing parameters in force</p>
          <p className="mt-1 text-sm text-ground/80">
            {cfg.hz} Hz · {cfg.passesPerSet} passes per set · maximum {cfg.maxSets} sets ·{" "}
            {cfg.cueWordRequired ? "cue word required" : "no cue word required"}. Short and slow
            by design: the set length is what keeps installation from becoming processing.
          </p>
          <p className="mt-2 text-xs text-olive">
            Any parameter change voids the sign-off and requires renewed clinician review.
          </p>
        </div>

        <details className="mt-3 text-xs text-olive">
          <summary className="cursor-pointer">All kill switches</summary>
          <ul className="mt-2 space-y-1">
            {Object.entries(cfg.switches).map(([k, v]) => (
              <li key={k}>
                <code className="text-[11px]">{k}</code> — {v ? "ENGAGED" : "not engaged"}
              </li>
            ))}
          </ul>
        </details>
      </section>

      {/* ---------------- Gates ---------------- */}
      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium">
          Part 6 gates{" "}
          <span className="ml-1 rounded-full bg-ground px-2.5 py-0.5 text-sm text-ivory">
            {status.gatesMet}/{status.gatesTotal} met
          </span>
        </h2>
        <ul className="mt-4 space-y-3">
          {PART6_GATES.map((g) => (
            <li
              key={g.id}
              data-testid="bls-gate"
              className={`rounded-2xl border px-4 py-3 ${GATE_STYLE[g.state]}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-ground/10 px-2 py-0.5 text-xs font-medium">
                  Gate {g.n}
                </span>
                <h3 className="font-medium text-ground">{g.name}</h3>
                <span
                  data-testid="gate-state"
                  className="rounded-full bg-ground/10 px-2 py-0.5 text-xs uppercase tracking-wide"
                >
                  {GATE_STATE_LABEL[g.state]}
                </span>
              </div>
              <p className="mt-1 text-sm text-ground/80">{g.detail}</p>
              {g.evidence && (
                <p className="mt-1 text-xs text-olive">
                  <code className="text-[11px]">{g.evidence}</code>
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* ---------------- Rollout ladder ---------------- */}
      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium">Staged rollout</h2>
        <p className="mt-1 text-sm text-olive">
          Resourcing first, because the evidence supports it and the risk is lower.
          Desensitization is gated behind the tightest criteria — or omitted entirely,
          depending on the self-administration decision.
        </p>
        <ul className="mt-4 space-y-3">
          {stages.map((s) => (
            <li
              key={s.id}
              data-testid="bls-stage"
              className={`rounded-2xl border px-4 py-3 ${
                s.enabled ? "border-pause/60 bg-pause-soft" : "border-ground/15 bg-linen/40"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-ground/10 px-2 py-0.5 text-xs font-medium uppercase">
                  {s.id}
                </span>
                <h3 className="font-medium text-ground">{s.name}</h3>
                <span
                  data-testid="stage-state"
                  className="rounded-full bg-ground/10 px-2 py-0.5 text-xs uppercase tracking-wide"
                >
                  {s.enabled ? "enabled" : "not enabled"}
                </span>
              </div>
              <p className="mt-1 text-sm text-ground/80">{s.scope}</p>
              <p className="mt-1 text-xs text-olive">{s.because}</p>
              <p className="mt-2 text-xs text-ground/80">
                <strong>Entry:</strong> {s.entry.join(" · ")}
                {s.cohort ? ` · cohort ${s.cohort}` : ""}
                {s.window ? ` · ${s.window}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------------- Thresholds and stops ---------------- */}
      <section className="mt-12 grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="type-display text-2xl font-medium">Pre-registered thresholds</h2>
          <p className="mt-1 text-xs text-olive">
            Set by clinicians before entry. The protocol&rsquo;s own instruction: set them,
            do not fit them.
          </p>
          <dl className="mt-3 space-y-2">
            {PRE_REGISTERED.map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-ground/10 bg-linen/40 px-4 py-3">
                <dt className="text-xs uppercase tracking-wide text-olive">{k}</dt>
                <dd className="mt-0.5 text-sm text-ground/80">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <h2 className="type-display text-2xl font-medium">Hard stopping criteria</h2>
          <p className="mt-1 text-xs text-olive">
            Any one of these disables the stage immediately. They are not weighed against
            each other, and none of them is a judgement call at the time.
          </p>
          <ol className="mt-3 space-y-2">
            {HARD_STOPS.map((s, i) => (
              <li
                key={s}
                data-testid="hard-stop"
                className="rounded-2xl border border-support/30 bg-support/5 px-4 py-3 text-sm text-ground/80"
              >
                <span className="font-medium text-support-deep">{i + 1}.</span> {s}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <NoteForm surface="BLS Part 6 oversight" returnTo="/review/bls" defaultCategory="Clinical safety" />
    </main>
  );
}
