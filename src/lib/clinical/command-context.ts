// The command-context service (expansion handoff 03 §15; Phase 3).
//
// §15's first sentence is the whole reason this file exists: "the drawer should
// not issue independent raw queries from every component."
//
// A drawer whose six sections each fetch their own data is a drawer where six
// components each decide, separately, what a clinician is allowed to see — and
// the seventh one somebody adds next quarter decides it again, differently.
// This assembles the whole thing once, through each subsystem's own front door,
// and hands the components a finished object.
//
// PHASE 3'S DEFINITION OF DONE IS TWO CLAIMS.
//
//   "EVERY MATERIAL STATEMENT CAN OPEN ITS EVIDENCE." So every section carries
//   evidence refs, and a section that cannot produce them says so rather than
//   showing an uncited sentence. §15: "every subsystem adapter returns evidence
//   refs and provenance."
//
//   "UNAVAILABLE SYSTEMS SHOW HONEST MISSING STATE." Every section is a
//   discriminated union with `unavailable` and `insufficient` as first-class
//   outcomes, not an empty array. §20: "missing downstream feature → show Not
//   available or omit section. Never manufacture neutral state." An absent
//   Recovery Trajectory must not read as a flat one.
//
// AND THE RULE THAT KEEPS IT HONEST: §15's "Command Center does not reach
// around subsystem rules to access protected content." Every adapter below
// calls the subsystem's own exported reader with the caller's TenantContext.
// There is no raw SQL in this file and no path that widens what a clinician may
// see — the drawer shows what the subsystems would have shown, gathered in one
// place.
//
// A NOTE ON SECTIONS THAT DO NOT EXIST YET. Recovery Trajectory (handoff 04)
// and Therapeutic Load (handoff 05) are modelled here as `unavailable` with a
// stated reason, which is §5's "Recovery / Load Context appears after Handoffs
// 04 and 05". Modelling them now rather than omitting them means those handoffs
// fill a slot instead of changing this contract — and, more importantly, the
// clinician sees "not built yet" rather than nothing, which are different
// statements about a person's record.

import crypto from "node:crypto";

import type { TenantContext } from "../repository";
import { CLINICAL_POLICY_VERSION } from "../clinical-policy";
import {
  getSignal, evidenceForSignal, currentCareActions, listSignalsForPerson,
  type AttentionSignal, type SignalEvidence, type CareActionRecord,
} from "./attention-signals";
import { listGoals, ladderFor, observationsFor, foldLevel, LEVEL_LABEL } from "./return-to-life";
import type { GoalLevel } from "./return-to-life-vocabulary";
import { computeFingerprints, displayable, RESPONSE_POLICY } from "./response-fingerprint";
import { PATTERN_STATE_LABEL } from "./response-fingerprint-policy";
import { CLASS_LABEL } from "./intervention-vocabulary";
import { listThreads, membershipsForPerson } from "./thread-store";
import { itemsByIds } from "./memory-store";
import { openFollowUps } from "./followups";
import { thoughtsSurfaceAvailable } from "./thoughts-flags";
import { commandCenterSurfaceAvailable } from "./command-center-flags";

export const COMMAND_CONTEXT_VERSION = "command-context.1.0.0";

// ---------------------------------------------------------------------------
// Section outcomes
// ---------------------------------------------------------------------------

/**
 * Why a section has nothing to show.
 *
 * FOUR REASONS, AND THEY ARE NOT INTERCHANGEABLE — which is the whole point of
 * the enum. "This person has no life goals set" and "the life-goals feature is
 * switched off in this deployment" produce the same empty space and mean
 * completely different things, and a clinician who cannot tell them apart will
 * eventually read one as the other.
 */
export type MissingReason =
  /** The subsystem is not built or not enabled here. */
  | "unavailable"
  /** It is available, and this person has nothing in it. */
  | "none_recorded"
  /** There is data, but not enough for the subsystem to say anything. */
  | "insufficient_evidence"
  /** Policy or access rules withhold it. Distinct from "none": the clinician
   *  should know that something exists and they are not seeing it. */
  | "withheld";

export interface SectionMissing {
  present: false;
  reason: MissingReason;
  /** What to tell the clinician, in words. Never "no data". */
  note: string;
}

export type Section<T> = ({ present: true } & T) | SectionMissing;

function missing(reason: MissingReason, note: string): SectionMissing {
  return { present: false, reason, note };
}

/** An evidence pointer a surface can offer to open. §15: "every subsystem
 *  adapter returns evidence refs and provenance." */
export interface EvidenceRef {
  type: string;
  id: string;
  /** What it is, for a clinician deciding whether to open it. */
  label: string;
}

// ---------------------------------------------------------------------------
// Sections (§5)
// ---------------------------------------------------------------------------

export interface WhyHereSection {
  signal: AttentionSignal;
  evidence: SignalEvidence[];
  /** §12: acknowledgement is explicit, so the drawer must be able to say
   *  whether it has happened. Opening this drawer does not change it. */
  acknowledged: boolean;
  limitations: string[];
}

export interface GoalSummary {
  goalId: string;
  title: string;
  domain: string;
  currentLevel: GoalLevel | null;
  currentLevelLabel: string;
  /** The rung description at the current level, so the drawer says what the
   *  level MEANS rather than showing a number from a scale nobody can see. */
  currentDescription: string | null;
  latestEvidenceAt: string | null;
  pendingCount: number;
  evidence: EvidenceRef[];
}

export interface ResponseSummaryRow {
  definitionId: string;
  displayName: string;
  classLabel: string;
  /** §5: "wording is observed association, never treatment truth." This is
   *  §6's pattern-state label, unchanged — the drawer does not get its own
   *  vocabulary for what a response means. */
  stateLabel: string;
  supportCount: number;
  missingFollowupCount: number;
  evidence: EvidenceRef[];
}

export interface ThreadSummary {
  threadId: string;
  label: string;
  threadType: string;
  /** Approved memory items a clinician ACCEPTED into this thread. §5:
   *  "proposed AI links do not appear as accepted." */
  acceptedItemCount: number;
  lastSeenAt: string | null;
  evidence: EvidenceRef[];
}

export interface FollowUpSummary {
  itemId: string;
  text: string;
  label: string | null;
  approvedAt: string;
}

export interface CommandContext {
  personId: string;
  /** Nothing after this instant was considered. */
  evidenceCutoff: string;
  /** §15: "cache keys include tenant, person, evidence cutoff, policy versions,
   *  and relevant feature versions." */
  cacheKey: string;
  provenance: {
    contextVersion: string;
    clinicalPolicyVersion: string;
    responsePolicyVersion: string;
  };
  whyHere: Section<WhyHereSection>;
  returnToLife: Section<{ goals: GoalSummary[] }>;
  responseFingerprint: Section<{ interventions: ResponseSummaryRow[]; withheldCount: number }>;
  activeThreads: Section<{ threads: ThreadSummary[] }>;
  recoveryTrajectory: SectionMissing;
  therapeuticLoad: SectionMissing;
  followUps: Section<{ items: FollowUpSummary[] }>;
  actionHistory: Section<{ actions: CareActionRecord[] }>;
  sessionPrepHref: string;
  /** Which adapters ran and which did not, so a half-assembled drawer says so
   *  rather than looking like a thin record (§20). */
  coverage: { assembled: string[]; failed: string[] };
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------
//
// Each returns a section or a stated absence, and each goes through the
// subsystem's own exported reader. None of them throws: an adapter that failed
// would take the whole drawer with it, and §20 requires the rest to survive.

async function whyHereFor(
  ctx: TenantContext, personId: string, signalId: string | null
): Promise<Section<WhyHereSection>> {
  if (!signalId) {
    return missing(
      "none_recorded",
      "This row came from the safety engine or the caseload model rather than from an attention signal. Its reason is on the row itself."
    );
  }
  const signal = await getSignal(ctx, signalId);
  // A foreign or deleted id reads as not-found, exactly as it does everywhere
  // else — the drawer is not a place to learn whether an id is real.
  if (!signal || signal.personId !== personId) {
    return missing("withheld", "That signal is not available on this record.");
  }
  return {
    present: true,
    signal,
    evidence: await evidenceForSignal(ctx, signalId),
    acknowledged: signal.state === "acknowledged",
    limitations: signal.limitations,
  };
}

/**
 * Return-to-Life (§5: "appears only when there is an active goal and clinician
 * access").
 *
 * THE LEVEL IS SHOWN WITH ITS RUNG DESCRIPTION, not as a number. Handoff 01 §9:
 * "show levels in plain language, not clinical scoring language." A drawer that
 * said "Level 0" would be asking a clinician to hold a five-point scale in their
 * head to read a summary.
 */
async function returnToLifeFor(
  ctx: TenantContext, personId: string, cutoff: string
): Promise<Section<{ goals: GoalSummary[] }>> {
  const goals = await listGoals(ctx, personId, ["active"]);
  if (goals.length === 0) {
    return missing("none_recorded", "No life goals have been set with this person yet.");
  }

  const summaries: GoalSummary[] = [];
  for (const goal of goals) {
    const [rungs, observations] = await Promise.all([
      ladderFor(ctx, goal.id),
      observationsFor(ctx, goal.id),
    ]);
    const inWindow = observations.filter((o) => o.occurredAt <= cutoff);
    const accepted = inWindow
      .filter((o) => o.status === "accepted")
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const latest = accepted[accepted.length - 1] ?? null;

    // FOLDED HERE, NOT READ FROM THE CACHED COLUMN, and for two reasons.
    //
    // The cached `current_level` reflects every accepted observation, so at an
    // earlier evidence cutoff it would report the level this goal reached LATER
    // as the level it had then — future data wearing a historical date, which
    // the cross-feature invariant forbids outright.
    //
    // And it is a cache: `refreshLevel` is its only writer, so a goal whose
    // evidence arrived by a path that did not refresh it would show "no level
    // recorded" beside accepted evidence that plainly records one. `foldLevel`
    // is the domain's own pure function, so this is the same rule, not a second
    // implementation of it.
    const currentLevel = foldLevel(accepted);

    summaries.push({
      goalId: goal.id,
      title: goal.title,
      domain: goal.domain,
      currentLevel,
      currentLevelLabel: currentLevel === null ? "No level recorded yet" : LEVEL_LABEL[currentLevel],
      currentDescription:
        currentLevel === null
          ? null
          : rungs.find((r) => r.level === currentLevel)?.description ?? null,
      latestEvidenceAt: latest?.occurredAt ?? null,
      // Suggestions waiting on the clinician. Counted separately from accepted
      // evidence, because §5 forbids a proposed link appearing as an accepted
      // one and the same rule applies to a proposed observation.
      pendingCount: inWindow.filter((o) => o.status === "proposed").length,
      evidence: accepted.slice(-3).map((o) => ({
        type: "return_goal_observation",
        id: o.id,
        label: `${o.evidenceClass.replace(/_/g, " ")} on ${o.occurredAt.slice(0, 10)}`,
      })),
    });
  }
  return { present: true, goals: summaries };
}

/**
 * What works for this patient (§5).
 *
 * The section title in the handoff is "WHAT WORKS FOR THIS PATIENT" and the
 * rule underneath it is "wording is observed association, never treatment
 * truth" — so the wording here is §6's pattern-state labels, unchanged, and the
 * screen titles the section in the fingerprint's own language rather than the
 * handoff's shorthand. A heading that says "what works" over rows that say
 * "settling has been observed" teaches the reader to trust the heading.
 *
 * Only what §6 permits to be displayed. Below the threshold nothing is shown
 * and the count of what was withheld is, which is the same contract the
 * responses screen and the overview card follow.
 */
async function responseFingerprintFor(
  ctx: TenantContext, personId: string, cutoff: string
): Promise<Section<{ interventions: ResponseSummaryRow[]; withheldCount: number }>> {
  const all = await computeFingerprints(ctx, personId, { asOf: cutoff });
  if (all.length === 0) {
    return missing("none_recorded", "Nothing has been recorded about what this person has been exposed to.");
  }
  const shown = displayable(all);
  if (shown.length === 0) {
    return missing(
      "insufficient_evidence",
      `${all.length} intervention${all.length === 1 ? " has" : "s have"} been recorded, none yet with the ` +
      `${RESPONSE_POLICY.displayThreshold} comparable exposures needed before anything is summarised.`
    );
  }
  return {
    present: true,
    withheldCount: all.length - shown.length,
    interventions: shown.slice(0, 5).map((f) => ({
      definitionId: f.definition.id,
      displayName: f.definition.displayName,
      classLabel: CLASS_LABEL[f.definition.interventionClass],
      stateLabel: PATTERN_STATE_LABEL[f.patternState],
      supportCount: f.supportCount,
      missingFollowupCount: f.missingFollowupCount,
      evidence: f.evidence.instanceIds.slice(0, 3).map((id) => ({
        type: "intervention_instance",
        id,
        label: "One recorded exposure",
      })),
    })),
  };
}

/**
 * Active threads (§5: "uses accepted clinician threads and approved memory.
 * Proposed AI links do not appear as accepted").
 *
 * THE MEMBERSHIP FILTER IS THE RULE. A thread's interest comes from what a
 * clinician connected to it, and counting proposed connections would inflate
 * every thread by whatever the matcher happened to suggest that week — turning
 * "three things you linked to her sleep" into "eleven things, eight of which
 * you have not looked at".
 */
async function activeThreadsFor(
  ctx: TenantContext, personId: string
): Promise<Section<{ threads: ThreadSummary[] }>> {
  if (!thoughtsSurfaceAvailable("CLINICIAN_THREADS")) {
    return missing("unavailable", "Longitudinal threads are not switched on in this environment.");
  }
  const threads = await listThreads(ctx, personId, "active");
  if (threads.length === 0) {
    return missing("none_recorded", "No active threads have been started for this person.");
  }
  const memberships = await membershipsForPerson(ctx, personId);
  const acceptedByThread = new Map<string, string[]>();
  for (const m of memberships) {
    if (m.status !== "accepted") continue;
    acceptedByThread.set(m.threadId, [...(acceptedByThread.get(m.threadId) ?? []), m.memoryItemId]);
  }

  const summaries: ThreadSummary[] = [];
  for (const t of threads) {
    const itemIds = acceptedByThread.get(t.id) ?? [];
    const items = itemIds.length > 0 ? await itemsByIds(ctx, itemIds.slice(0, 3)) : [];
    summaries.push({
      threadId: t.id,
      label: t.canonicalLabel,
      threadType: t.threadType,
      acceptedItemCount: itemIds.length,
      lastSeenAt: t.lastSeenAt,
      evidence: items.map((i) => ({
        type: "clinical_memory_item",
        id: i.id,
        // The statement class travels, so the drawer shows a hypothesis AS a
        // hypothesis rather than restating it as an observation.
        label: `${i.statementClass.replace(/_/g, " ")}`,
      })),
    });
  }
  return { present: true, threads: summaries };
}

async function followUpsFor(
  ctx: TenantContext, personId: string, cutoff: string
): Promise<Section<{ items: FollowUpSummary[] }>> {
  if (!thoughtsSurfaceAvailable("CLINICIAN_THOUGHTS_EXTRACTION")) {
    return missing("unavailable", "Clinician follow-ups are not switched on in this environment.");
  }
  const items = await openFollowUps(ctx, { personId, now: new Date(cutoff) });
  if (items.length === 0) {
    return missing("none_recorded", "You have no open follow-ups for this person.");
  }
  return {
    present: true,
    items: items.map((f) => ({
      itemId: f.itemId, text: f.text, label: f.label, approvedAt: f.approvedAt,
    })),
  };
}

/**
 * What has been done (§13's action ledger).
 *
 * THE CURRENT VIEW, not the whole ledger. A correction appends, so the raw
 * table holds both the original entry and the one that replaced it — and a
 * drawer that listed both would show a clinician their own mistake beside its
 * fix on every open. The superseded rows are still there for anyone auditing;
 * this is what the record now reads.
 */
async function actionHistoryFor(
  ctx: TenantContext, personId: string
): Promise<Section<{ actions: CareActionRecord[] }>> {
  const actions = await currentCareActions(ctx, personId, 10);
  if (actions.length === 0) {
    return missing("none_recorded", "Nothing has been recorded against this person from the Command Center yet.");
  }
  return { present: true, actions };
}

// ---------------------------------------------------------------------------
// Assembly (§15)
// ---------------------------------------------------------------------------

/**
 * §15's cache key.
 *
 * Every input that can change the drawer is in it: tenant, person, evidence
 * cutoff, and the versions of everything that computed a section. A key missing
 * a policy version serves a drawer assembled under rules that no longer apply,
 * and nothing about the stale answer looks stale — the same reasoning as the
 * Session Prep key, for the same reason.
 */
export function commandContextCacheKey(args: {
  tenantId: string;
  personId: string;
  evidenceCutoff: string;
  signalId: string | null;
}): string {
  const material = [
    args.tenantId,
    args.personId,
    args.evidenceCutoff,
    args.signalId ?? "no-signal",
    COMMAND_CONTEXT_VERSION,
    CLINICAL_POLICY_VERSION,
    RESPONSE_POLICY.version,
  ].join("|");
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 24);
}

/**
 * Assemble everything the drawer needs, once.
 *
 * EVERY ADAPTER IS INDIVIDUALLY GUARDED. One subsystem throwing must not empty
 * the drawer — §20: "one provider failed → keep other work" applies here as
 * much as to the queue, and a drawer that failed to load looks exactly like a
 * person with a thin record. So a failed adapter becomes an `unavailable`
 * section with a stated reason and its name goes in `coverage.failed`.
 *
 * ASSEMBLING IS NOT ACKNOWLEDGING. §12: "opening a row or drawer does not
 * silently acknowledge it." Nothing in this function writes; the only thing it
 * reports about acknowledgement is whether it has already happened.
 */
export async function buildCommandContext(
  ctx: TenantContext,
  args: { personId: string; signalId?: string | null; asOf?: string }
): Promise<CommandContext> {
  const evidenceCutoff = args.asOf ?? new Date().toISOString();
  const signalId = args.signalId ?? null;
  const assembled: string[] = [];
  const failed: string[] = [];

  async function section<T>(
    name: string,
    load: () => Promise<Section<T>>,
    unavailableNote: string
  ): Promise<Section<T>> {
    try {
      const result = await load();
      assembled.push(name);
      return result;
    } catch (err) {
      // The class of failure only. §18 keeps patient text, goal names and
      // thread labels out of anything that leaves the record, and an error
      // message is exactly where one slips out.
      console.error(`command context: ${name} failed:`, err instanceof Error ? err.name : "unknown");
      failed.push(name);
      return missing("unavailable", unavailableNote);
    }
  }

  const [whyHere, returnToLife, responseFingerprint, activeThreads, followUps, actionHistory] =
    await Promise.all([
      section("whyHere", () => whyHereFor(ctx, args.personId, signalId),
        "The signal behind this row could not be loaded just now."),
      section("returnToLife", () => returnToLifeFor(ctx, args.personId, evidenceCutoff),
        "Life goals could not be loaded just now."),
      section("responseFingerprint", () => responseFingerprintFor(ctx, args.personId, evidenceCutoff),
        "Observed responses could not be loaded just now."),
      section("activeThreads", () => activeThreadsFor(ctx, args.personId),
        "Threads could not be loaded just now."),
      section("followUps", () => followUpsFor(ctx, args.personId, evidenceCutoff),
        "Follow-ups could not be loaded just now."),
      section("actionHistory", () => actionHistoryFor(ctx, args.personId),
        "Action history could not be loaded just now."),
    ]);

  return {
    personId: args.personId,
    evidenceCutoff,
    cacheKey: commandContextCacheKey({
      tenantId: ctx.tenantId, personId: args.personId, evidenceCutoff, signalId,
    }),
    provenance: {
      contextVersion: COMMAND_CONTEXT_VERSION,
      clinicalPolicyVersion: CLINICAL_POLICY_VERSION,
      responsePolicyVersion: RESPONSE_POLICY.version,
    },
    whyHere,
    returnToLife,
    responseFingerprint,
    activeThreads,
    // §5: "Recovery / Load Context appears after Handoffs 04 and 05." Modelled
    // rather than omitted, so those handoffs fill a slot instead of changing
    // this contract — and so the clinician reads "not built yet" instead of
    // nothing, which are different statements about a person's record.
    recoveryTrajectory: missing(
      "unavailable",
      "Recovery trajectory is not built yet. Nothing here says this person's trajectory is flat — it says Steady is not computing one."
    ),
    therapeuticLoad: missing(
      "unavailable",
      "Therapeutic load and readiness are not built yet. This is an absent feature, not a judgement that the current load is fine."
    ),
    followUps,
    actionHistory,
    sessionPrepHref: `/clinician/member/${args.personId}`,
    coverage: { assembled, failed },
  };
}

/** Whether the drawer may render at all. Its own flag and everything it rests
 *  on — a drawer over signals nobody generates is a drawer with nothing in it. */
export function drawerAvailable(): boolean {
  return commandCenterSurfaceAvailable("CLINICAL_COMMAND_CENTER_DRAWER");
}

/** Open signals for a person, for a drawer opened from a person's record
 *  rather than from a queue row. */
export async function openSignalsFor(
  ctx: TenantContext, personId: string
): Promise<AttentionSignal[]> {
  return listSignalsForPerson(ctx, personId);
}
