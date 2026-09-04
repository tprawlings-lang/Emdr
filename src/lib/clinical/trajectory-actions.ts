"use server";

import { revalidatePath } from "next/cache";
import { requireClinician } from "../auth";
import { data } from "../data";
import { PLATFORM_TENANT_ID } from "../db";
import { audit } from "../audit";
import type { TenantContext } from "../repository";
import {
  computeTrajectory, saveTrajectory, recordTrajectoryReview,
  TrajectoryError, REVIEW_STATES, type TrajectoryReviewState,
} from "./recovery-trajectory";

// Server actions for the recovery-trajectory surface (expansion handoff 04 §12,
// Phase 3).
//
// Thin, like every other action module here: authenticate, resolve the tenant
// from the caller's own record, delegate to the engine, revalidate. The rules
// about what a review may be live in recovery-trajectory.ts where they are
// tested; a second copy in a form handler is how the two come to disagree.
//
// THE TENANT IS READ, NEVER ACCEPTED. A tenant supplied by the caller is a
// tenant an attacker can choose.
//
// AND RECORDING A REVIEW DOES NOT CHANGE THE STATE. §5's review table sits
// beside the snapshot table rather than inside it — a clinician who disagrees
// is adding what Steady did not know, and a disagreement that overwrote the
// state would also erase the evidence that Steady had been reading it that way.
// Nothing in this file can write a `state` column.

export interface TrajectoryActionResult {
  ok: boolean;
  error?: string;
}

async function clinicianContext(): Promise<{ ctx: TenantContext; clinicianId: string }> {
  const clinician = await requireClinician();
  const c = await data();
  const row = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [clinician.id])) as
    | { tenant_id: string } | undefined;
  return {
    ctx: { tenantId: row?.tenant_id ?? PLATFORM_TENANT_ID, personId: clinician.id },
    clinicianId: clinician.id,
  };
}

/**
 * Compute the current states and persist them.
 *
 * SEPARATE FROM RENDERING, and pressed rather than triggered. A page render
 * that wrote a snapshot would fill the table with one row per visit, each with
 * a slightly different cutoff, and §13's "reproducible from evidence, cutoff,
 * and policy version" would be technically true and practically useless — the
 * clinician could never point at the state they read.
 */
export async function snapshotTrajectory(personId: string): Promise<TrajectoryActionResult> {
  const { ctx, clinicianId } = await clinicianContext();
  try {
    const set = await computeTrajectory(ctx, personId);
    await saveTrajectory(ctx, set, clinicianId);
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "trajectory_snapshot_saved", target: personId,
      // The count and the cutoff, never a state or a domain name.
      detail: {
        domains: set.snapshots.length,
        evidenceCutoff: set.evidenceCutoff,
        policyVersion: set.policyVersion,
      },
    });
    revalidatePath(`/clinician/member/${personId}/trajectory`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof TrajectoryError ? err.message : "That could not be saved.",
    };
  }
}

/** Record what a clinician made of one domain's state (§5). */
export async function reviewTrajectory(formData: FormData): Promise<TrajectoryActionResult> {
  const { ctx, clinicianId } = await clinicianContext();
  const personId = String(formData.get("personId") ?? "");
  const snapshotId = String(formData.get("snapshotId") ?? "");
  const reviewState = String(formData.get("reviewState") ?? "") as TrajectoryReviewState;
  const note = String(formData.get("note") ?? "");

  if (!(REVIEW_STATES as readonly string[]).includes(reviewState)) {
    return { ok: false, error: "Choose what you make of this." };
  }
  try {
    // The snapshot must exist before it can be reviewed, and computing it here
    // rather than trusting the id means a review always lands on a state Steady
    // can still produce from the record.
    const set = await computeTrajectory(ctx, personId);
    await saveTrajectory(ctx, set, clinicianId);
    if (!set.snapshots.some((s) => s.id === snapshotId)) {
      return {
        ok: false,
        error: "That state is no longer one Steady computes from this record. Recompute and read it again before recording a view of it.",
      };
    }
    await recordTrajectoryReview(ctx, {
      personId, snapshotId, clinicianPersonId: clinicianId, reviewState, note,
    });
    await audit({
      actorId: clinicianId, actorRole: "clinician", family: "clinical",
      type: "trajectory_reviewed", target: personId,
      detail: { reviewState, snapshotId },
    });
    revalidatePath(`/clinician/member/${personId}/trajectory`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof TrajectoryError ? err.message : "That could not be recorded.",
    };
  }
}
