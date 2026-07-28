// Shadow-vs-live divergence report.
//
// Before the autonomous safety engine is allowed to GOVERN module access
// (README §14.7 step 4/5), we must show that its deterministic decision matches
// the live human-in-the-loop gate (`checkModuleAccess`) — and, where it does
// not, surface exactly which modules it would open that today require a human
// unlock. This is the pre-flip artifact clinicians review.
//
// For each active member × each module we compare:
//   • live   = checkModuleAccess(...).allowed          (the gate that governs today)
//   • engine = engineModuleVerdict(decideAccess(...))  (what the engine would allow)
// and classify agree / engine-more-permissive / engine-more-restrictive.
// "engine-more-permissive" is the safety-critical set (the engine would open
// something the human gate blocks) and is flagged for review.

import { decideAccess } from "../safety/decide";
import { checkModuleAccess } from "../gating";
import { engineModuleVerdict } from "../safety/module-verdict";
import { MODULES } from "../modules";
import { data } from "../data";

// The engine's per-module verdict lives in safety/module-verdict.ts (shared with
// the live gate). Re-exported here for callers/tests that reach it via this file.
export { engineModuleVerdict } from "../safety/module-verdict";

export type DivergenceVerdict = "agree" | "engine_more_permissive" | "engine_more_restrictive";

export interface ModuleDivergenceRow {
  moduleId: string;
  moduleTier: string;
  live: boolean;
  liveReason: string | null;
  engine: boolean;
  verdict: DivergenceVerdict;
}

export interface MemberDivergence {
  userId: string;
  tier: number;
  tierLabel: string;
  rows: ModuleDivergenceRow[];
  agree: number;
  engineMorePermissive: number;
  engineMoreRestrictive: number;
}

export async function moduleDivergence(userId: string, nowMs = Date.now()): Promise<MemberDivergence> {
  const decision = await decideAccess(userId, nowMs);
  const rows: ModuleDivergenceRow[] = [];
  let agree = 0, morePermissive = 0, moreRestrictive = 0;
  for (const mod of MODULES) {
    const access = await checkModuleAccess(userId, mod);
    const live = access.allowed;
    const engine = engineModuleVerdict(decision, mod, nowMs);
    let verdict: DivergenceVerdict = "agree";
    if (live !== engine) verdict = engine ? "engine_more_permissive" : "engine_more_restrictive";
    if (verdict === "agree") agree++;
    else if (verdict === "engine_more_permissive") morePermissive++;
    else moreRestrictive++;
    rows.push({
      moduleId: mod.id,
      moduleTier: mod.tier,
      live,
      liveReason: access.allowed ? null : access.reason,
      engine,
      verdict,
    });
  }
  return {
    userId,
    tier: decision.tier,
    tierLabel: decision.tierLabel,
    rows,
    agree,
    engineMorePermissive: morePermissive,
    engineMoreRestrictive: moreRestrictive,
  };
}

export interface DivergenceReport {
  generatedAtMs: number;
  config: string;
  members: number;
  comparisons: number;
  agree: number;
  /** SAFETY-CRITICAL: engine would OPEN a module the human gate blocks. */
  engineMorePermissive: number;
  /** Engine would BLOCK a module the human gate allows (conservative — fine). */
  engineMoreRestrictive: number;
  agreementRate: number; // 0..1
  perMember: MemberDivergence[];
  /** The rows clinicians must review before the flip (engine more permissive). */
  flagged: Array<{ userId: string; moduleId: string; moduleTier: string; liveReason: string | null }>;
}

export async function divergenceReport(nowMs = Date.now()): Promise<DivergenceReport> {
  const c = await data();
  const members = (await c.all(
    "SELECT id FROM users WHERE role = 'member' AND status = 'active'"
  )) as Array<{ id: string }>;

  const perMember: MemberDivergence[] = [];
  for (const m of members) perMember.push(await moduleDivergence(m.id, nowMs));

  const flagged: DivergenceReport["flagged"] = [];
  let comparisons = 0, agree = 0, morePermissive = 0, moreRestrictive = 0;
  for (const pm of perMember) {
    comparisons += pm.rows.length;
    agree += pm.agree;
    morePermissive += pm.engineMorePermissive;
    moreRestrictive += pm.engineMoreRestrictive;
    for (const r of pm.rows) {
      if (r.verdict === "engine_more_permissive") {
        flagged.push({ userId: pm.userId, moduleId: r.moduleId, moduleTier: r.moduleTier, liveReason: r.liveReason });
      }
    }
  }

  return {
    generatedAtMs: nowMs,
    config: "beta-clinrev-2026-07",
    members: members.length,
    comparisons,
    agree,
    engineMorePermissive: morePermissive,
    engineMoreRestrictive: moreRestrictive,
    agreementRate: comparisons > 0 ? agree / comparisons : 1,
    perMember,
    flagged,
  };
}
