// Creating a fabricated patient by walking the real writers (demo only).
//
// THE POINT OF THIS FILE IS WHAT IT DOES NOT DO. It does not insert rows. Every
// stage below calls the same function the product calls when a member does that
// thing for themselves — `provisionPerson`, `spineGrantConsent`,
// `recordFitnessScreening`, `scoreInstrument` + `recordAssessment`,
// `recordCheckin` — so a created patient is in the state the product produces
// rather than in a state that resembles it.
//
// WHY THAT MATTERS MORE HERE THAN ANYWHERE ELSE. A seed that writes a shape the
// product cannot produce is a testing surface that lies: everything looks right
// until somebody tests the path that would have produced it, and then the bug is
// in the test data rather than in the product. This is a feature whose entire
// purpose is testing, so a lie here contaminates whatever it is used to check.
//
// The one place it writes directly is the profile, and that is because the
// eleven-step onboarding writes its rows from server actions that redirect, so
// there is no function to call that does not also try to navigate. The insert
// is annotated where it happens.
//
// AND IT IS ALL ONE TRANSACTION. Found by breaking it: a first version failed
// part-way through the profile stage, after the account, the consent, the
// screener and all five instruments had been written — leaving a patient who
// was half onboarded and already in a caseload. A half-created patient is the
// worst possible output of a feature whose purpose is producing trustworthy
// test data: it is a state the product cannot reach, sitting in a clinician's
// queue, indistinguishable from a real one.

import { data } from "../data";
import { newId, hashPassword } from "../db";
import { evaluateCheckin } from "../gating";
import { encryptField } from "../crypto";
import { audit } from "../audit";
import {
  provisionPerson, grantConsent as spineGrantConsent, recordAssessment, recordCheckin,
} from "../spine";
import { currentConsentVersion } from "../policy";
import { startDemoSubscription } from "../billing";
import { INSTRUMENTS, scoreInstrument } from "../instruments";
import { FITNESS_ITEMS, recordFitnessScreening } from "../fitness-screener";
import { computeReadiness, type ReadinessAnswers } from "../profile";
import {
  type Depth, type Presentation, stagesFor, fabricatedName, demoEmailFor,
  assertFabricatedInput, answersFor, fitnessAnswers, PRESENTATION_SPECS,
} from "./new-patient";

export class NotDemoError extends Error {}

export interface CreatedPatient {
  userId: string;
  name: string;
  email: string;
  password: string;
  tenantId: string;
  stagesRun: string[];
  /** Baseline totals, so the surface can show what was recorded rather than
   *  claiming a baseline exists. */
  baseline: Array<{ instrument: string; total: number; positive: boolean }>;
}

/** The password every created patient signs in with. One shared value, printed
 *  on the screen that creates them — these are fabricated logins in a
 *  fabricated environment, and a per-patient secret nobody can retrieve would
 *  make the account useless for the testing it exists for. */
export const NEW_PATIENT_PASSWORD = "patient1234";

export async function createDemoPatient(args: {
  name: string;
  email?: string;
  depth: Depth;
  presentation: Presentation;
  /**
   * The tenant the patient joins, which IS the clinical assignment.
   *
   * The caseload selects members by `role = 'member'` and tenant, so a patient
   * in a clinician's tenant is a patient in their caseload and one anywhere
   * else is invisible to them. Resolved by the caller from the CHOSEN
   * CLINICIAN's own record — not from the acting admin's, who is in the
   * platform tenant, and not from the browser.
   *
   * MEASURED: the first version used the admin's tenant. The patient was
   * created correctly and appeared in nobody's caseload, which is the one thing
   * this feature exists to do.
   */
  tenantId: string;
  actorId: string;
}): Promise<CreatedPatient> {
  // DEMO ONLY, CHECKED HERE AS WELL AS AT THE SURFACE. A form post does not go
  // through the page that decided whether to render the form.
  if (process.env.EMDR_DEMO !== "1") {
    throw new NotDemoError("creating patients is a demonstration facility and is off in this environment");
  }
  assertFabricatedInput({ name: args.name, email: args.email });

  const name = fabricatedName(args.name);
  const email = (args.email?.trim() || demoEmailFor(args.name)).toLowerCase();
  const stages = stagesFor(args.depth);
  const ran: string[] = [];
  const c = await data();

  const existing = (await c.get("SELECT id FROM users WHERE email = ?", [email])) as
    | { id: string } | undefined;
  if (existing) {
    throw new NotDemoError(`${email} already exists — pick a different name, or reset the environment`);
  }

  return c.tx(async (c) => {

  // ---- account ----------------------------------------------------------
  //
  // BOTH WRITES, IN THE SIGNUP PATH'S ORDER. `users` first, then
  // `provisionPerson` for the identity spine — ADR 0011's dual write. The first
  // version of this called only `provisionPerson`, which writes `persons`,
  // `accounts` and `role_assignments` and NOT `users`, and swallows its own
  // errors; so the account appeared to be created and the next stage failed on
  // `consents.user_id REFERENCES users(id)`. Caught by pressing the button.
  const userId = newId();
  const passwordHash = hashPassword(NEW_PATIENT_PASSWORD);
  await c.run(
    "INSERT INTO users (id, email, name, role, password_hash, tenant_id) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, email, name, "member", passwordHash, args.tenantId]
  );
  await provisionPerson({
    userId,
    name,
    email,
    role: "member",
    passwordHash,
    tenantId: args.tenantId,
  });
  ran.push("account");

  // ---- membership --------------------------------------------------------
  if (stages.includes("membership")) {
    // Through the product's own starter, which writes the subscription row and
    // its simulated payment. Without this the member cannot reach ANY of the
    // programme: every route checks `subscriptionActive` first and redirects to
    // /subscribe, so an account-only patient could not walk the intake they
    // were created to walk.
    await startDemoSubscription(userId);
    ran.push("membership");
  }

  // ---- consent ----------------------------------------------------------
  if (stages.includes("consent")) {
    await spineGrantConsent({
      userId,
      policyVersion: currentConsentVersion(),
      scope: "care_program_full",
    });
    ran.push("consent");
  }

  // ---- fitness screener --------------------------------------------------
  if (stages.includes("fitness")) {
    // Through the real recorder, so the classification that decides hard stop
    // versus soft flag versus pass is the product's and not a copy of it.
    await recordFitnessScreening(userId, fitnessAnswers(FITNESS_ITEMS.map((i) => i.id)));
    ran.push("fitness");
  }

  // ---- baseline ----------------------------------------------------------
  const baseline: CreatedPatient["baseline"] = [];
  if (stages.includes("baseline")) {
    for (const instrument of INSTRUMENTS) {
      const key = instrument.id as keyof (typeof PRESENTATION_SPECS)["moderate"]["answers"];
      // The instrument's own risk-item indexes, so a preset cannot answer a
      // suicidal-ideation question and manufacture an emergency.
      const answers = answersFor(
        key, instrument.items.length, args.presentation,
        (instrument.riskItems ?? []).map((r) => r.index)
      );
      // The product's scorer, so cutoffs and risk flags are computed once in
      // the codebase rather than twice.
      const { total, positive, riskFlags } = scoreInstrument(instrument, answers);
      await c.run(
        `INSERT INTO screenings (id, user_id, instrument, instrument_version, total_score, answers_json, risk_flags_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [newId(), userId, instrument.id, instrument.version, total,
         encryptField(JSON.stringify(answers)), JSON.stringify(riskFlags)]
      );
      await recordAssessment({
        userId, instrument: instrument.id, instrumentVersion: instrument.version,
        totalScore: total, riskFlags, context: "baseline", via: "web",
      });
      baseline.push({ instrument: instrument.id, total, positive });
    }
    ran.push("baseline");
  }

  // ---- profile and safety plan -------------------------------------------
  if (stages.includes("profile")) {
    // WRITTEN DIRECTLY, and this is the one place that happens. The eleven-step
    // onboarding writes these rows from server actions that take a FormData and
    // then redirect, so there is no function to call that does not also try to
    // navigate.
    //
    // THE COLUMNS ARE COPIED FROM THOSE ACTIONS, not guessed — and that is not
    // fussiness. The first version of this invented plausible names and failed
    // one crash at a time: `early_warning_signs.sign` is `sign_name`, and
    // `readiness_assessments` needs the computed score and track that
    // `computeReadiness` produces, which a hand-written insert has no way to
    // know. Guessing a schema produces test data the product could not have
    // written, which is the exact failure this module exists to avoid.
    await c.run(
      `INSERT INTO user_profiles (user_id, therapist_status, emdr_experience, goals_json,
         trauma_areas_json, restricted_topics_json, profile_complete)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [userId, "in_therapy", "none", JSON.stringify(["Sleep through the night", "Be in a room with people again"]),
       JSON.stringify(["Single incident in adulthood"]), JSON.stringify([])]
    );
    await c.run(
      `INSERT INTO user_triggers (id, user_id, trigger_name, trigger_category, intensity_score,
         common_responses_json, notes, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [newId(), userId, "Sudden loud noise", "sensory", 7,
       JSON.stringify(["Freeze", "Heart races"]), encryptField("Worse in the evening.")]
    );
    for (const sign of ["Stopping replying to people", "Sleeping much less"]) {
      await c.run(
        `INSERT INTO early_warning_signs (id, user_id, sign_name) VALUES (?, ?, ?)
         ON CONFLICT(user_id, sign_name) DO UPDATE SET active = 1`,
        [newId(), userId, sign]
      );
    }
    // The readiness score and track come from the product's own calculator, so
    // the row says what the product would have computed from these answers
    // rather than a number somebody typed.
    const answers: ReadinessAnswers = {
      stability: 6, bodySafety: 6, presentConnection: 6, symptomIntensity: 6,
      sleepQuality: "poor", supportAvailable: "sometimes",
      processingReadiness: "curious", pauseCapacity: "think_so", riskFlag: "none",
    };
    const { score, track } = computeReadiness(answers);
    await c.run(
      `INSERT INTO readiness_assessments
         (id, user_id, stability_score, body_safety_score, present_connection_score,
          symptom_intensity_score, sleep_quality, support_available, processing_readiness,
          pause_capacity, pace_preference, risk_flag, calculated_readiness_score,
          recommended_track, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'onboarding')`,
      [newId(), userId, answers.stability, answers.bodySafety, answers.presentConnection,
       answers.symptomIntensity, answers.sleepQuality, answers.supportAvailable,
       answers.processingReadiness, answers.pauseCapacity, "slow", answers.riskFlag,
       score, track]
    );
    await c.run(
      `INSERT INTO safety_plans (user_id, grounding_tools_json, support_contact_name,
         support_contact_method, reminder_phrase, stop_signs, careful_topics)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO NOTHING`,
      [userId, JSON.stringify(["5-4-3-2-1", "Cold water"]), "A friend (fabricated)",
       "Phone", "This is a memory, and it is not happening now.",
       encryptField("Losing time; feeling far away."), encryptField("Anything about the hospital.")]
    );
    ran.push("profile");
  }

  // ---- first check-in ----------------------------------------------------
  if (stages.includes("checkin")) {
    const today = new Date().toISOString().slice(0, 10);
    // The row and the event share an id and an instant, which is what lets a
    // projection rebuild reproduce this row rather than invent one. Getting
    // that wrong is invisible until somebody replays the ledger.
    const checkinId = newId();
    const occurredAt = new Date().toISOString();
    // THE TENANT IS ON THE ROW. `checkins` carries one, and omitting it takes
    // the column default — the platform tenant — while the person lives in the
    // clinician's. src/lib/db.ts already carries a correction for exactly this,
    // written the last time it happened: replay rebuilt the row into the
    // person's tenant while the live row said platform.
    // THE ROUTING VALUE IS COMPUTED, here as everywhere. It was the literal
    // "processing_ok" in two places on this path — the row and the event — and
    // two literals that agree with each other and with the rule today are three
    // things that can drift apart tomorrow.
    const values = {
      activation: 5, shutdown: 3, harm_urge: false, feels_safe: true,
      dissociation: 3, sleep_quality: 4, substance_flag: false,
    };
    const action = evaluateCheckin(values);
    await c.run(
      `INSERT INTO checkins (id, user_id, tenant_id, checkin_date, activation, shutdown, harm_urge,
         feels_safe, dissociation, sleep_quality, substance_flag, recommended_action)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?, 0, ?)`,
      [checkinId, userId, args.tenantId, today, values.activation, values.shutdown,
        values.dissociation, values.sleep_quality, action]
    );
    await recordCheckin({
      userId, checkinId, occurredAt, checkinDate: today,
      activation: values.activation, shutdown: values.shutdown,
      harmUrge: values.harm_urge, feelsSafe: values.feels_safe,
      dissociation: values.dissociation, sleepQuality: values.sleep_quality,
      substanceFlag: values.substance_flag,
      recommendedAction: action, via: "web",
    });
    ran.push("checkin");
  }

  await audit({
    actorId: args.actorId, actorRole: "demo_admin", family: "identity",
    type: "demo_patient_created", target: userId,
    detail: { email, depth: args.depth, presentation: args.presentation, stages: ran },
  });

  return {
    userId, name, email, password: NEW_PATIENT_PASSWORD,
    tenantId: args.tenantId, stagesRun: ran, baseline,
  };
  });
}

/**
 * The clinicians a new patient can be given to.
 *
 * Read rather than configured: a list of demo clinicians in code would drift
 * from the seeded environment the first time a reset changed one, and the
 * choice here decides which tenant the patient joins.
 */
export async function assignableClinicians(): Promise<Array<{ id: string; name: string; tenantId: string }>> {
  const c = await data();
  const rows = (await c.all(
    "SELECT id, name, tenant_id FROM users WHERE role = 'clinician' AND status = 'active' ORDER BY name"
  )) as Array<{ id: string; name: string; tenant_id: string }>;
  return rows.map((r) => ({ id: r.id, name: r.name, tenantId: r.tenant_id }));
}
