"use server";

// Ask Steady's server action (Thoughts spec v2.1 §12, §14; Phase 5).
//
// §14's command surface: POST /api/clinician/member/:id/ask, "patient-scoped
// retrieval + answer", auth boundary "clinician, patient scope". This is that
// command as a server action, and it is thin for the same reason every other
// action in this console is thin: the retrieval policy lives in
// ask-retrieval.ts and the answer shape in ask-answer.ts, where both are tested
// without a database, and a second copy of either inside a form handler is how
// the two come to disagree.
//
// THE PERSON IS VERIFIED, NOT ACCEPTED. The person id arrives from a form field
// on a page the clinician is already looking at, which is exactly the shape of
// request that is easy to change in a browser. The tenant comes from the
// clinician's own record and never from the payload, and the person is checked
// against that tenant before a single record is read — §12: "use patient/tenant
// scope BEFORE retrieval, not after generation."
//
// READ-ONLY, AND STRUCTURALLY SO. §12: an answer "does not write clinical
// memory from the answer itself." This module has no writer: it reads, ranks,
// composes, records that a question was asked, and returns. There is no path
// from an answer to a memory item because there is no function here that could
// create one.

import { requireClinician } from "../auth";
import { data } from "../data";
import { PLATFORM_TENANT_ID } from "../db";
import { audit } from "../audit";
import { appendEventSafe } from "../events";
import type { TenantContext } from "../repository";
import { thoughtsSurfaceAvailable } from "./thoughts-flags";
import { retrievalDocs } from "./ask-store";
import {
  retrieve, RETRIEVAL_POLICY_VERSION, NO_SEMANTIC_SCORER, ScopeViolation,
} from "./ask-retrieval";
import { compose, outOfScope, ASK_VERSION, type AskAnswer } from "./ask-answer";

export interface AskResult {
  ok: boolean;
  answer?: AskAnswer;
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

/** Whether this person is inside the asking clinician's tenant. Asked before
 *  retrieval, and the answer for "no" is shaped like every other answer so a
 *  caller cannot forget to handle it. */
async function personInScope(ctx: TenantContext, personId: string): Promise<boolean> {
  const c = await data();
  const row = (await c.get(
    "SELECT id FROM persons WHERE id = ? AND tenant_id = ?",
    [personId, ctx.tenantId]
  )) as { id: string } | undefined;
  return Boolean(row);
}

export async function askAboutPersonAction(
  personId: string,
  question: string
): Promise<AskResult> {
  if (!thoughtsSurfaceAvailable("CLINICIAN_PATIENT_ASK")) {
    return { ok: false, error: "Ask Steady is not enabled in this environment." };
  }

  const trimmed = question.trim();
  if (trimmed.length < 3) {
    return { ok: false, error: "Ask a question first." };
  }

  const { ctx, clinicianId } = await clinicianContext();
  const now = new Date();
  const evidenceCutoff = now.toISOString();
  const provenance = {
    askVersion: ASK_VERSION,
    retrievalPolicyVersion: RETRIEVAL_POLICY_VERSION,
    semanticScoring: NO_SEMANTIC_SCORER !== null,
    candidates: 0,
    evidenceCutoff,
  };

  // SCOPE FIRST. Nothing is read about this person until they are established
  // as somebody this clinician may read about.
  if (!(await personInScope(ctx, personId))) {
    // Deliberately the same answer a real person outside scope produces: a
    // response that distinguished "not yours" from "does not exist" would
    // confirm the existence of records in another tenant.
    return { ok: true, answer: outOfScope(trimmed, provenance) };
  }

  let answer: AskAnswer;
  try {
    const docs = await retrievalDocs(ctx, personId);
    const evidence = retrieve({
      query: trimmed,
      docs,
      scope: { tenantId: ctx.tenantId, personId },
      now,
      scorer: NO_SEMANTIC_SCORER,
    });
    answer = compose({
      question: trimmed,
      evidence,
      candidates: docs.length,
      semanticScoring: NO_SEMANTIC_SCORER !== null,
      retrievalPolicyVersion: RETRIEVAL_POLICY_VERSION,
      evidenceCutoff,
    });
  } catch (err) {
    if (err instanceof ScopeViolation) {
      // The assertion fired, which means a reader returned a record belonging
      // to somebody else. That is a defect upstream, and the honest response is
      // to answer nothing and record it — not to filter the record out and
      // carry on, which would leave the bug in place for the next caller.
      await audit({
        actorId: clinicianId, actorRole: "clinician", family: "clinical",
        type: "clinician_ask_scope_violation", target: personId,
        detail: { personId, reason: err.message },
      });
      return { ok: false, error: "Steady could not answer that safely. Nothing was retrieved." };
    }
    throw err;
  }

  // §7's event: the question was asked and answered, with what it rested on.
  // The QUESTION TEXT IS NOT STORED — a clinician's question is free text about
  // a patient, and a question log is a second clinical record nobody reviews.
  // What is recorded is that an answer was produced, from which evidence, under
  // which versions.
  await appendEventSafe({
    personId,
    type: "clinician_patient_query.answered",
    actorType: "clinician",
    actorId: clinicianId,
    payload: {
      evidenceIds: answer.sources.map((s) => s.id),
      answerKind: answer.kind,
      askVersion: answer.provenance.askVersion,
      retrievalPolicyVersion: answer.provenance.retrievalPolicyVersion,
      generatedAt: evidenceCutoff,
    },
  });

  await audit({
    actorId: clinicianId, actorRole: "clinician", family: "clinical",
    type: "clinician_ask_answered", target: personId,
    detail: { personId, answerKind: answer.kind, sources: answer.sources.length },
  });

  return { ok: true, answer };
}
