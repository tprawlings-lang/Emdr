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
import { raiseRiskItemAlert } from "../clinical/alert-create";

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

  // A RISK ITEM REACHES A CLINICIAN, FROM THIS PATH TOO.
  //
  // This was missing, and it was the most consequential gap this file could
  // have had. `submitScreening` in src/lib/actions.ts — the other way an
  // instrument gets submitted — raises an urgent alert and routes to the crisis
  // screen when a risk item fires. This path, the paced one-question-at-a-time
  // gate that every NEW member walks during baseline screening, recorded the
  // flag in `screenings.risk_flags_json` and then continued to the next
  // questionnaire. Nothing raised an alert; no clinician saw it.
  //
  // FOUND BY WALKING THE INTAKE as a newly created patient and then reading
  // their rows: PHQ-9 carried `suicidal_ideation_screen_positive` and the
  // alerts table was empty. Two submit paths, one of which had the safety
  // routing — and the one that did not is the one a first-time member uses.
  //
  // The comment in actions.ts states the rule this restores: "Risk items (e.g.
  // PHQ-9 item 9) never get an autonomous assessment — they route to the crisis
  // screen and queue same-day specialist review."
  if (riskFlags.length > 0) {
    await raiseRiskItemAlert({
      userId: user.id, instrumentId: instrument!.id, riskFlags, total,
    });
    redirect("/crisis?from=screening");
  }

  redirect("/app/screening");
}
