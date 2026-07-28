// Governance scaffolding (Autonomous Step 6) — Vol V Part 5.
//
// Central registry of the autonomous flags, kill switches, and a config-as-code
// snapshot surfaced for audit. Thresholds are NOT invisible engineering
// parameters (Vol V Ch.21): the snapshot is versioned and marked provisional,
// and can be logged/served for review. Pure and side-effect-free.

import {
  autonomousSafetyEnabled,
  BETA_CONFIG,
  SESSION,
  BLS,
  INSTRUMENT,
  DAILY,
  COOLDOWN_HOURS,
  CAUTIOUS_CEILING_DAYS,
  ACUTE_TRAUMA_EXCLUSION_DAYS,
  READINESS_CAP,
} from "./config";

/** Bump when any safety threshold or policy changes (requires regression +
 *  documented clinical review per Vol I D-5 / Vol V Ch.21). Bumping resets all
 *  per-rule sign-offs — verdicts are scoped to the config version. The
 *  `-clinrev-` revision applies the clinical-review change set (no autonomous
 *  BLS/reprocessing, history/dx → human review, scores → review triggers,
 *  DES-II omitted, PCL-5 item 16 de-scoped, readiness → Educational Access
 *  State) and is pending independent licensed-clinician ratification. */
export const SAFETY_CONFIG_VERSION = "beta-clinrev-2026-07";

/** Emergency kill switches (Vol V Ch.21). Each stops one capability without
 *  taking the platform down; static safe information stays available. */
export function killSwitches() {
  return {
    /** Stop generative conversation → static safe replies only. */
    generativeConversation: process.env.EMDR_KILL_GENERATIVE === "1",
    /** Disable provider data sharing. */
    providerSharing: process.env.EMDR_KILL_PROVIDER_SHARING === "1",
    /** Suspend escalation automation (no automated provider/human alerts). */
    escalationAutomation: process.env.EMDR_KILL_ESCALATION === "1",
    /** Existing session kill switch (compliance 4D). */
    newSessions: process.env.EMDR_DISABLE_NEW_SESSIONS === "1",
    /** Disable all bilateral stimulation (resourcing + any future processing)
     *  globally without a deploy — the BLS-protocol Phase-4 kill switch. */
    bls: process.env.EMDR_KILL_BLS === "1",
  };
}

/** BLS globally disabled by the kill switch (docs/autonomous/bls-validation). */
export function blsDisabled(): boolean {
  return killSwitches().bls;
}

export function generativeConversationDisabled(): boolean {
  return killSwitches().generativeConversation;
}
export function providerSharingDisabled(): boolean {
  return killSwitches().providerSharing;
}
export function escalationAutomationDisabled(): boolean {
  return killSwitches().escalationAutomation;
}

/** Which autonomous stages are present in this build (all shadow/flag-gated). */
export const AUTONOMOUS_STAGES = {
  s1_deterministic_core: true,
  s2_scoring_shadow: true,
  s3_session_engine: true,
  s4_companion_memory_guard: true,
  s5_journey_orchestration: true,
  s6_governance: true,
} as const;

/** Config-as-code snapshot for audit/ops. No secrets, no member data. */
export function safetyConfigSnapshot() {
  return {
    version: SAFETY_CONFIG_VERSION,
    provisional: true, // pending independent clinician sign-off (ledger)
    beta: BETA_CONFIG,
    session: SESSION,
    bls: BLS,
    instrument: INSTRUMENT,
    daily: DAILY,
    cooldownHours: COOLDOWN_HOURS,
    cautiousCeilingDays: CAUTIOUS_CEILING_DAYS,
    acuteTraumaExclusionDays: ACUTE_TRAUMA_EXCLUSION_DAYS,
    readinessCap: READINESS_CAP,
  };
}

/** Full governance status for the ops endpoint. */
export function safetyCoreStatus() {
  const governing = autonomousSafetyEnabled();
  return {
    configVersion: SAFETY_CONFIG_VERSION,
    provisional: true,
    mode: governing ? "governing" : "shadow",
    governanceEnabled: governing,
    signoffRequired: true,
    stages: AUTONOMOUS_STAGES,
    killSwitches: killSwitches(),
    config: safetyConfigSnapshot(),
  };
}
