"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { newId } from "../db";
import { data } from "../data";
import { encryptField } from "../crypto";
import { audit } from "../audit";
import { requireReviewer } from "../auth";
import { isRole } from "../roles";
import type { Decision, SubjectKind } from "./decisions";

// Writes for the review decision record.
//
// Every action here goes through requireReviewer. §26 p44's role-level
// acceptance says release gates "cannot be bypassed from ordinary admin
// controls", and the first half of meaning it is that recording a decision is
// not something an ordinary admin surface can reach.

const DECISIONS: Decision[] = ["approved", "blocked", "changes_requested"];

function parseDecision(v: FormDataEntryValue | null): Decision | null {
  const s = String(v ?? "");
  return (DECISIONS as string[]).includes(s) ? (s as Decision) : null;
}

/**
 * Record one decision.
 *
 * `subjectVersion` is supplied by the CALLER — the screen passes the version
 * it was displaying. That is deliberate and it is the safety property: if the
 * evidence changed between the page rendering and the reviewer pressing the
 * button, the decision is filed against the version they actually saw, not
 * against whatever is current at write time. A decision recorded against
 * evidence the reviewer never looked at is the exact thing the fingerprint
 * exists to prevent, and re-deriving the version here would reintroduce it.
 */
async function record(args: {
  kind: SubjectKind;
  subjectId: string;
  subjectVersion: string;
  decision: Decision;
  rationale: string | null;
  evidence: Record<string, unknown>;
  actorId: string;
  actorRole: string;
  auditType: string;
}): Promise<void> {
  const c = await data();
  await c.run(
    `INSERT INTO review_decisions
       (id, subject_kind, subject_id, subject_version, decision, rationale, evidence_json, actor_id, actor_role)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId(),
      args.kind,
      args.subjectId,
      args.subjectVersion,
      args.decision,
      args.rationale ? encryptField(args.rationale) : null,
      JSON.stringify(args.evidence),
      args.actorId,
      args.actorRole,
    ]
  );
  await audit({
    actorId: args.actorId,
    actorRole: args.actorRole,
    family: "specialist_action",
    type: args.auditType,
    target: args.subjectId,
    detail: {
      decision: args.decision,
      subjectVersion: args.subjectVersion,
      hasRationale: !!args.rationale,
    },
  });
}

/** Clinical language review (§26 p44, §31.6 p99). */
export async function recordClinicalReview(formData: FormData) {
  const user = await requireReviewer();
  const subjectId = String(formData.get("surface_id") ?? "").trim().slice(0, 80);
  const version = String(formData.get("copy_version") ?? "").trim().slice(0, 120);
  const decision = parseDecision(formData.get("decision"));
  const rationale = String(formData.get("rationale") ?? "").trim().slice(0, 1000) || null;
  if (!subjectId || !version || !decision) redirect("/review/clinical");

  // A refusal without a reason cannot be acted on by whoever has to fix it,
  // and "blocked, no reason given" is how a gate becomes something people
  // route around rather than resolve.
  if (decision !== "approved" && !rationale) redirect("/review/clinical?error=reason_required");

  await record({
    kind: "clinical_language",
    subjectId,
    subjectVersion: version,
    decision,
    rationale,
    evidence: { copyVersion: version },
    actorId: user.id,
    actorRole: user.role,
    auditType: "clinical_language_review",
  });
  revalidatePath("/review/clinical");
  revalidatePath("/review/release");
  revalidatePath("/review");
}

/** Release gate sign-off (§31.6 p99). */
export async function recordGateSignoff(formData: FormData) {
  const user = await requireReviewer();
  const gateId = String(formData.get("gate_id") ?? "").trim().slice(0, 80);
  const fingerprint = String(formData.get("fingerprint") ?? "").trim().slice(0, 64);
  const decision = parseDecision(formData.get("decision"));
  const rationale = String(formData.get("rationale") ?? "").trim().slice(0, 1000) || null;
  const evidenceRef = String(formData.get("evidence_ref") ?? "").trim().slice(0, 300) || null;
  if (!gateId || !fingerprint || !decision) redirect("/review/release");
  if (decision !== "approved" && !rationale) redirect("/review/release?error=reason_required");

  // An attested gate is a person's word. Requiring a pointer to the evidence
  // is what keeps it from being only that — the reviewer has to say WHERE the
  // accessibility run or the attack-suite result can be found, so a later
  // reader can check rather than trust.
  const { gateById } = await import("./gates");
  const gate = gateById(gateId);
  if (!gate) redirect("/review/release");
  if (gate.evidenceClass === "attested" && decision === "approved" && !evidenceRef) {
    redirect("/review/release?error=evidence_required");
  }

  await record({
    kind: "release_gate",
    subjectId: gateId,
    subjectVersion: fingerprint,
    decision,
    rationale,
    evidence: { fingerprint, evidenceClass: gate.evidenceClass, evidenceRef },
    actorId: user.id,
    actorRole: user.role,
    auditType: "release_gate_signoff",
  });
  revalidatePath("/review/release");
  revalidatePath("/review");
}

/** Raise a request for scoped access (§26 p44). */
export async function requestScopedAccess(formData: FormData) {
  const user = await requireReviewer();
  const requestedRole = String(formData.get("requested_role") ?? "").trim();
  const purpose = String(formData.get("purpose") ?? "").trim().slice(0, 500);
  const days = Number(formData.get("days") ?? 0);
  if (!isRole(requestedRole) || !purpose) redirect("/review/access?error=incomplete");
  // An open-ended grant is not a scope. p44 names expiration as part of what is
  // approved, so a request without one cannot be made here at all.
  if (!Number.isFinite(days) || days < 1 || days > 365) redirect("/review/access?error=bad_expiry");

  const expires = new Date(Date.now() + days * 86_400_000).toISOString();
  const c = await data();
  const { tenantForUser } = await import("../db");
  const tenantId = await tenantForUser(user.id);
  await c.run(
    `INSERT INTO access_requests (id, tenant_id, requested_by, requested_role, purpose, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [newId(), tenantId, user.id, requestedRole, encryptField(purpose), expires]
  );
  await audit({
    actorId: user.id,
    actorRole: user.role,
    family: "specialist_action",
    type: "scoped_access_requested",
    detail: { requestedRole, expiresAt: expires },
  });
  revalidatePath("/review/access");
  revalidatePath("/review");
}

/** Approve or deny a scoped access request (§26 p44). */
export async function decideAccessRequest(formData: FormData) {
  const user = await requireReviewer();
  const requestId = String(formData.get("request_id") ?? "").trim().slice(0, 40);
  const decision = parseDecision(formData.get("decision"));
  const rationale = String(formData.get("rationale") ?? "").trim().slice(0, 1000) || null;
  if (!requestId || !decision) redirect("/review/access");
  if (decision !== "approved" && !rationale) redirect("/review/access?error=reason_required");

  const c = await data();
  const row = (await c.get(
    "SELECT id, requested_by, requested_role, expires_at FROM access_requests WHERE id = ?",
    [requestId]
  )) as { id: string; requested_by: string; requested_role: string; expires_at: string } | undefined;
  if (!row) redirect("/review/access");

  // A reviewer approving their own request is the whole failure mode this
  // screen exists to prevent, and it is refused rather than discouraged.
  if (row.requested_by === user.id) redirect("/review/access?error=self_approval");

  await record({
    kind: "access_request",
    subjectId: requestId,
    // The grant is what was asked for. Binding the decision to the requested
    // role and expiry means an edited request cannot inherit an old approval.
    subjectVersion: `${row.requested_role}@${row.expires_at}`,
    decision,
    rationale,
    evidence: { requestedRole: row.requested_role, expiresAt: row.expires_at },
    actorId: user.id,
    actorRole: user.role,
    auditType: "scoped_access_decision",
  });
  revalidatePath("/review/access");
  revalidatePath("/review");
}

/**
 * Request a de-identified cohort export (§26 p44).
 *
 * The rows come from the same builder the screen rendered, so the hashed
 * filter recorded against the file describes the view that produced it. The
 * count columns are named explicitly because only the caller knows which
 * numbers are counts of people — export.ts suppresses those below the
 * small-cell threshold and leaves rates and denominators alone.
 */
export async function requestResearchExport(formData: FormData) {
  const user = await requireReviewer();
  const purpose = String(formData.get("purpose") ?? "").trim().slice(0, 500);
  if (!purpose) redirect("/review/research?error=purpose_required");

  const { cohortTable } = await import("./research");
  const { createExport, ExportRefused } = await import("../intelligence/export");
  const { PLANNING_TENANT_ID } = await import("../planning/scope");
  const { registryVersion } = await import("../metrics/cohorts");

  const table = await cohortTable();
  try {
    const result = await createExport({
      tenantId: PLANNING_TENANT_ID,
      requestedBy: user.id,
      requestedByRole: user.role,
      surface: "review/research",
      cohortVersion: registryVersion(),
      filter: table.filter,
      countColumns: ["eligible_n", "group_n"],
      rows: table.rows.map((r) => ({
        cohort_id: r.cohortId,
        cohort_version: r.cohortVersion,
        label: r.label,
        eligible_n: r.eligibleN,
        group_n: r.groupN,
      })),
      purpose,
    });
    redirect(`/review/research?export=${result.id}`);
  } catch (e) {
    if (e instanceof ExportRefused) {
      redirect(`/review/research?refused=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }
}
