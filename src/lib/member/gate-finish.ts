"use server";

// Completing the gate (Presentation Layer Handoff §5).
//
// Scoring happens HERE and nowhere earlier — the paced sequence records
// answers, and only completion produces a score, which then lives in
// `screenings` for the clinician surface exactly as before.
//
// The member never sees it. §5: "No result screen with a number. The gate
// terminates in a Day State, not a score."

import { redirect } from "next/navigation";
import { requireMember } from "../auth";
import { data } from "../data";
import { newId } from "../db";
import { audit } from "../audit";
import { encryptField } from "../crypto";
import { getInstrument, scoreInstrument } from "../instruments";
import { recordAssessment } from "../spine";
import { completedAnswers, clearProgress, GateError } from "./gate";

export async function finishGateAction(formData: FormData) {
  const user = await requireMember();
  const instrumentId = String(formData.get("instrument") ?? "");
  const instrument = getInstrument(instrumentId);
  if (!instrument) redirect("/app/screening");

  let answers: number[];
  try {
    answers = await completedAnswers(user.id, instrumentId);
  } catch (e) {
    // An unanswered item routes back to it rather than defaulting to zero.
    // Zero is a real answer on every instrument here, so inventing one would
    // put a fabricated response into a clinical record.
    if (e instanceof GateError) redirect(`/app/screening/${instrumentId}`);
    throw e;
  }

  const { total, riskFlags } = scoreInstrument(instrument!, answers);
  const c = await data();

  await c.run(
    `INSERT INTO screenings (id, user_id, instrument, instrument_version, total_score, answers_json, risk_flags_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newId(), user.id, instrument!.id, instrument!.version, total,
     encryptField(JSON.stringify(answers)), JSON.stringify(riskFlags)]
  );
  await recordAssessment({
    userId: user.id, instrument: instrument!.id, instrumentVersion: instrument!.version,
    totalScore: total, riskFlags, context: "baseline", via: "web",
  });
  await audit({
    actorId: user.id, actorRole: "member", family: "clinical",
    type: "screening_submitted", target: instrument!.id,
    detail: { riskFlagCount: riskFlags.length },
  });

  await clearProgress(user.id, instrumentId);
  redirect("/app/screening");
}
