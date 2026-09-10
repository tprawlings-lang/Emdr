// Command Center feature flags (expansion handoff 03, Appendix B).
//
// Six flags, and the rule Appendix B states about all of them: "turning off
// presentation does not delete signal, action, or evidence history." So every
// flag here gates a SURFACE or a computation, and none of them gates a write
// path that history depends on. A tenant that switches the Command Center off
// and on again finds the same signals, the same acknowledgements and the same
// care actions, because none of it was ever conditional on being visible.
//
// PHASE 1'S DEFINITION OF DONE IS THE REASON THESE EXIST AT ALL: "existing
// queue unchanged when feature is off." A flag that only hid a section would
// not satisfy that — the queue's ORDER, its counts and its grouping all have to
// be byte-identical with the flag off, which means the merge itself is behind
// the flag and not just the rendering of what it produced.
//
// Read at call time, never captured into a module constant. A flag read at
// module load cannot be turned off without a redeploy, and this codebase has
// already shipped that bug once.

export const COMMAND_CENTER_FLAGS = {
  /** The Today surface as the Command Center: four buckets, counts, filters. */
  CLINICAL_COMMAND_CENTER: "CLINICAL_COMMAND_CENTER",
  /** Durable non-safety attention signals: providers run and merge into the
   *  queue. Off means the queue is exactly what it was. */
  CLINICAL_ATTENTION_SIGNALS: "CLINICAL_ATTENTION_SIGNALS",
  /** The quick review drawer (Phase 3). */
  CLINICAL_COMMAND_CENTER_DRAWER: "CLINICAL_COMMAND_CENTER_DRAWER",
  /** The caseload clinical state table (Phase 4). */
  CLINICAL_COMMAND_CENTER_CASELOAD: "CLINICAL_COMMAND_CENTER_CASELOAD",
  /** The recent activity feed (Phase 4). */
  CLINICAL_COMMAND_CENTER_ACTIVITY: "CLINICAL_COMMAND_CENTER_ACTIVITY",
  /** The optional cross-system synthesis sentence (Phase 5). */
  CLINICAL_COMMAND_CENTER_AI_SUMMARY: "CLINICAL_COMMAND_CENTER_AI_SUMMARY",
} as const;

export type CommandCenterFlag = keyof typeof COMMAND_CENTER_FLAGS;
export const ALL_COMMAND_CENTER_FLAGS = Object.keys(COMMAND_CENTER_FLAGS) as CommandCenterFlag[];

/**
 * Flags that are ON in demo without being set.
 *
 * The rule this list follows is the one the Thoughts flags follow: a flag opens
 * a surface with something behind it. A flag over an unbuilt phase reads as
 * "this is broken" rather than "this is not finished yet", which is the worse
 * of the two messages to send a clinical reviewer.
 *
 * So a flag joins this set when its phase lands, and not before.
 */
const DEMO_ENABLED = new Set<CommandCenterFlag>([
  "CLINICAL_ATTENTION_SIGNALS",
  "CLINICAL_COMMAND_CENTER",
  // Joined when Phase 3 landed, on the same terms: the drawer now has a
  // command-context service behind it and six sections that either show
  // something or say why they cannot.
  "CLINICAL_COMMAND_CENTER_DRAWER",
  // And these when Phase 4 did: a clinical-state table with no composite score
  // and an activity feed that is a feed rather than an event dump.
  "CLINICAL_COMMAND_CENTER_CASELOAD",
  "CLINICAL_COMMAND_CENTER_ACTIVITY",
  // And this when Phase 5 did. The panel is useful with no provider configured
  // — it says a sentence was withheld and why — which is exactly the state a
  // clinical reviewer should be able to see and judge.
  "CLINICAL_COMMAND_CENTER_AI_SUMMARY",
]);

/**
 * What a later phase rests on.
 *
 * A drawer over signals nobody generates is a drawer with nothing in it, and
 * the AI summary over a row that does not exist is a sentence about nothing.
 * Checked rather than trusted, because a rollout is exactly the moment somebody
 * enables the interesting flag first.
 */
const REQUIRES: Partial<Record<CommandCenterFlag, CommandCenterFlag>> = {
  CLINICAL_COMMAND_CENTER: "CLINICAL_ATTENTION_SIGNALS",
  CLINICAL_COMMAND_CENTER_DRAWER: "CLINICAL_COMMAND_CENTER",
  CLINICAL_COMMAND_CENTER_CASELOAD: "CLINICAL_COMMAND_CENTER",
  CLINICAL_COMMAND_CENTER_ACTIVITY: "CLINICAL_COMMAND_CENTER",
  CLINICAL_COMMAND_CENTER_AI_SUMMARY: "CLINICAL_COMMAND_CENTER",
};

/** Off unless explicitly "1", except where demo enables it above. */
export function commandCenterFlagEnabled(flag: CommandCenterFlag): boolean {
  const set = process.env[COMMAND_CENTER_FLAGS[flag]];
  if (set === "0") return false;
  if (set === "1") return true;
  return process.env.EMDR_DEMO === "1" && DEMO_ENABLED.has(flag);
}

/** Whether a surface may render: its own flag AND everything it rests on. */
export function commandCenterSurfaceAvailable(flag: CommandCenterFlag): boolean {
  let current: CommandCenterFlag | undefined = flag;
  while (current) {
    if (!commandCenterFlagEnabled(current)) return false;
    current = REQUIRES[current];
  }
  return true;
}

/** What a flag rests on, for the screen that reports rollout state. */
export function commandCenterFlagRequires(flag: CommandCenterFlag): CommandCenterFlag | null {
  return REQUIRES[flag] ?? null;
}

// ---------------------------------------------------------------------------
// Tenant-aware flags (Appendix B; Phase 6)
// ---------------------------------------------------------------------------
//
// Appendix B: "flags should be tenant-aware when current configuration
// permits", and the sentence after it is the constraint: "turning off
// presentation does not delete signal, action, or evidence history."
//
// SO A TENANT ROW IS AN OVERRIDE, NEVER A SOURCE OF TRUTH. The environment
// variable stays the deployment-wide answer; a row says one organization
// decided differently about their own environment. Absence means "no opinion",
// which is why the row itself is the opinion rather than a nullable column —
// three states where two are meant is how a flag ends up meaning something
// different in each place it is read.
//
// AND THE DEPENDENCY CHAIN STILL APPLIES. A tenant that switched the drawer on
// while the substrate is off still gets a closed drawer, because a screen with
// nothing behind it reads as broken rather than as not-finished. The override
// changes one flag's answer, not the rule that a phase rests on the one before.

import { data } from "../data";

export interface TenantFlagOverride {
  flag: CommandCenterFlag;
  enabled: boolean;
  setBy: string | null;
  reason: string | null;
  updatedAt: string;
}

/** Every override this tenant has set. Read once per surface rather than per
 *  flag: six round trips to answer one page's questions is six chances for the
 *  answers to disagree with each other mid-render. */
export async function tenantFlagOverrides(
  tenantId: string
): Promise<Map<CommandCenterFlag, TenantFlagOverride>> {
  const c = await data();
  const rows = (await c.all(
    `SELECT flag, enabled, set_by, reason, updated_at
       FROM tenant_feature_flags WHERE tenant_id = ?`,
    [tenantId]
  )) as Array<{
    flag: string; enabled: number; set_by: string | null;
    reason: string | null; updated_at: string;
  }>;
  const out = new Map<CommandCenterFlag, TenantFlagOverride>();
  for (const r of rows) {
    // A flag nobody defines any more is ignored rather than crashing a page.
    // Removing a feature should not brick the tenant that had switched it on.
    if (!ALL_COMMAND_CENTER_FLAGS.includes(r.flag as CommandCenterFlag)) continue;
    out.set(r.flag as CommandCenterFlag, {
      flag: r.flag as CommandCenterFlag,
      enabled: r.enabled === 1,
      setBy: r.set_by,
      reason: r.reason,
      updatedAt: r.updated_at,
    });
  }
  return out;
}

/** One flag's answer for one tenant: the override if there is one, otherwise
 *  the environment's. */
export function flagEnabledWith(
  flag: CommandCenterFlag,
  overrides: Map<CommandCenterFlag, TenantFlagOverride>
): boolean {
  const override = overrides.get(flag);
  return override ? override.enabled : commandCenterFlagEnabled(flag);
}

/** Whether a surface may render for one tenant: its own answer AND everything
 *  it rests on, each resolved the same way. */
export function surfaceAvailableWith(
  flag: CommandCenterFlag,
  overrides: Map<CommandCenterFlag, TenantFlagOverride>
): boolean {
  let current: CommandCenterFlag | undefined = flag;
  while (current) {
    if (!flagEnabledWith(current, overrides)) return false;
    current = REQUIRES[current];
  }
  return true;
}

/** Set or clear one tenant's opinion about one flag.
 *
 *  `enabled: null` REMOVES the row, which is not the same as setting it false:
 *  false means "this organization decided against it" and absent means "they
 *  have no opinion and follow the deployment". A surface that reported those
 *  identically would make an org's deliberate decision indistinguishable from
 *  never having been asked. */
export async function setTenantFlag(args: {
  tenantId: string;
  flag: CommandCenterFlag;
  enabled: boolean | null;
  setBy: string;
  reason?: string | null;
}): Promise<void> {
  const c = await data();
  if (args.enabled === null) {
    await c.run("DELETE FROM tenant_feature_flags WHERE tenant_id = ? AND flag = ?", [
      args.tenantId, args.flag,
    ]);
    return;
  }
  await c.run(
    `INSERT INTO tenant_feature_flags (tenant_id, flag, enabled, set_by, reason, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(tenant_id, flag) DO UPDATE SET
       enabled = excluded.enabled, set_by = excluded.set_by,
       reason = excluded.reason, updated_at = excluded.updated_at`,
    [args.tenantId, args.flag, args.enabled ? 1 : 0, args.setBy, args.reason ?? null]
  );
}
