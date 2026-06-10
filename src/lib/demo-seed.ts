import type Database from "better-sqlite3";
import crypto from "crypto";
import { hashPassword } from "./db";

// Rich fictional dataset for demo deployments (EMDR_DEMO=1). Gives both the
// member and clinician views something realistic to show on first login:
// a member three weeks into the program with improving scores, a pending
// unlock request, a reviewed hard-stop, and a second member whose screening
// tripped the urgent risk queue. All people and data are fictional.
export function seedDemoData(db: Database.Database) {
  const id = () => crypto.randomUUID();
  const daysAgo = (d: number, hour = 10) => {
    const t = new Date(Date.now() - d * 86400000);
    t.setUTCHours(hour, 15, 0, 0);
    return t.toISOString().slice(0, 19).replace("T", " ");
  };
  const dateOnly = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

  const insertUser = db.prepare(
    "INSERT INTO users (id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const alexId = id();
  const samId = id();
  const clinicianId = id();
  insertUser.run(alexId, "demo@example.com", "Alex Rivera (fictional)", "member", hashPassword("demo1234"), daysAgo(22));
  insertUser.run(samId, "demo2@example.com", "Sam Okafor (fictional)", "member", hashPassword("demo1234"), daysAgo(2));
  insertUser.run(clinicianId, "clinician@example.com", "Dr. Maya Chen (fictional)", "clinician", hashPassword("demo1234"), daysAgo(40));

  // --- Alex: three weeks into the program, improving ---
  db.prepare(
    "INSERT INTO consents (id, user_id, policy_version, scope, granted_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id(), alexId, "v1.0-dev", "care_program_full", daysAgo(21));

  const insScreening = db.prepare(
    `INSERT INTO screenings (id, user_id, instrument, instrument_version, total_score, answers_json, risk_flags_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // Baseline (21 days ago)
  insScreening.run(id(), alexId, "pc-ptsd-5", "2021", 4, "[1,1,1,1,0]", "[]", daysAgo(21));
  insScreening.run(id(), alexId, "phq-9", "standard", 9, "[1,2,2,1,1,1,1,0,0]", "[]", daysAgo(21));
  insScreening.run(id(), alexId, "gad-7", "standard", 9, "[2,1,2,1,1,1,1]", "[]", daysAgo(21));
  // Weekly PCL-5 + ITQ, improving
  const itqWeek: [string, number][] = [
    ["[3,2,2,3,2,2,3,1,0,3,2,2,3,2,2,3,0,0]", 28], // cPTSD criteria met
    ["[2,2,2,2,2,1,2,1,0,2,2,2,2,1,2,2,0,0]", 22],
    ["[2,1,2,1,2,1,2,0,0,2,1,1,1,1,1,1,0,0]", 16],
  ];
  const pclWeek = [52, 46, 39];
  itqWeek.forEach(([answers, total], w) => {
    const day = 21 - w * 7;
    insScreening.run(id(), alexId, "pcl-5", "standard (past month)", pclWeek[w], "[]", "[]", daysAgo(day));
    insScreening.run(id(), alexId, "itq", "Cloitre et al. (ICD-11)", total, answers, "[]", daysAgo(day));
  });

  const insCheckin = db.prepare(
    `INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe,
       dissociation, sleep_quality, substance_flag, recommended_action, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // ~Three weeks of mostly-daily check-ins, calmer over time. Today's is done
  // and clears processing so sessions can be started immediately in the demo.
  for (let d = 21; d >= 0; d--) {
    if ([18, 13, 6].includes(d)) continue; // a few missed days, like real life
    const calmer = (21 - d) / 21;
    const activation = Math.max(1, Math.round(6 - 3 * calmer + (d % 3 === 0 ? 1 : 0)));
    const dissociation = d === 9 ? 7 : Math.max(0, Math.round(4 - 3 * calmer));
    const action =
      d === 9 ? "grounding_only" : dissociation >= 4 || d % 5 === 4 ? "stabilization" : "processing_ok";
    insCheckin.run(
      id(), alexId, dateOnly(d), activation, Math.max(0, activation - 2), 0, 1,
      dissociation, d % 4 === 0 ? 3 : 6, 0, action, daysAgo(d, 8)
    );
  }

  const insSession = db.prepare(
    `INSERT INTO therapy_sessions (id, user_id, module_id, status, pre_suds, post_suds, peak_suds,
       hard_stop_reason, detail_json, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const completed: [string, number, number, number, number][] = [
    // module, daysAgo, pre, post, peak
    ["calm-place", 20, 5, 3, 5],
    ["calm-place", 19, 4, 2, 4],
    ["containment", 17, 5, 3, 5],
    ["body-scan", 15, 4, 3, 5],
    ["trigger-map", 12, 5, 4, 6],
    ["resourcing", 11, 4, 2, 4],
    ["resourcing", 7, 3, 2, 3],
    ["calm-place", 3, 3, 1, 3],
  ];
  const completedIds: { sessionId: string; d: number; post: number }[] = [];
  for (const [mod, d, pre, post, peak] of completed) {
    const sessionId = id();
    insSession.run(
      sessionId, alexId, mod, "completed", pre, post, peak, null,
      JSON.stringify({ sudsTrail: [pre, peak, post] }), daysAgo(d, 18), daysAgo(d, 19)
    );
    completedIds.push({ sessionId, d, post });
  }
  // One hard-stop during body scan (day 9, the dissociative day) — reviewed.
  const hardStopSession = id();
  insSession.run(
    hardStopSession, alexId, "body-scan", "hard_stop", 6, 9, 9,
    "Distress rated 9/10",
    JSON.stringify({ sudsTrail: [6, 9] }), daysAgo(9, 18), daysAgo(9, 18)
  );

  const insPostCheck = db.prepare(
    `INSERT INTO post_session_checks (id, session_id, user_id, distress, oriented, safe_tonight,
       delayed_risk, recovery_confirmed, escalated, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // Post-session checks for the completed sessions (all settled fine).
  for (const { sessionId, d, post } of completedIds) {
    insPostCheck.run(id(), sessionId, alexId, post, 1, 1, Math.min(post, 3), 1, 0, daysAgo(d, 19));
  }

  const insAlert = db.prepare(
    `INSERT INTO alerts (id, user_id, alert_type, severity, detail, status, reviewed_by, review_note, created_at, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // Hard-stop alert, already reviewed by the clinician with a documented note.
  insAlert.run(
    id(), alexId, "session_hard_stop", "high",
    "Hard stop in module body-scan: Distress rated 9/10",
    "reviewed", clinicianId,
    "Called member same day. Dissociative spike after poor sleep; agreed to grounding-only week and earlier wind-down. No safety concerns. Follow-up at next weekly review.",
    daysAgo(9, 18), daysAgo(9, 21)
  );

  // Pending unlock request for the first gated module — the clinician's
  // main demo task. Prerequisites (trigger map + resourcing) are complete.
  db.prepare(
    `INSERT INTO module_unlocks (id, user_id, module_id, status, member_note, requested_at)
     VALUES (?, ?, ?, 'requested', ?, ?)`
  ).run(
    id(), alexId, "recent-trigger",
    "Feeling steadier the last two weeks. The supermarket trigger from my map feels manageable to try.",
    daysAgo(1, 9)
  );
  insAlert.run(
    id(), alexId, "unlock_requested", "moderate",
    "Member requested unlock for module: Recent trigger desensitization",
    "open", null, null, daysAgo(1, 9), null
  );

  // --- Sam: brand-new member whose PHQ-9 item 9 tripped the urgent queue ---
  db.prepare(
    "INSERT INTO consents (id, user_id, policy_version, scope, granted_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id(), samId, "v1.0-dev", "care_program_full", daysAgo(2));
  insScreening.run(id(), samId, "pc-ptsd-5", "2021", 5, "[1,1,1,1,1]", "[]", daysAgo(2));
  insScreening.run(id(), samId, "pcl-5", "standard (past month)", 58, "[]", "[]", daysAgo(2));
  insScreening.run(
    id(), samId, "itq", "Cloitre et al. (ICD-11)", 33,
    "[3,3,2,3,3,2,3,2,1,3,3,3,3,3,2,3,1,1]", "[]", daysAgo(2)
  );
  insScreening.run(
    id(), samId, "phq-9", "standard", 16, "[2,3,2,2,1,3,1,1,1]",
    JSON.stringify(["suicidal_ideation_screen_positive"]), daysAgo(2)
  );
  insAlert.run(
    id(), samId, "screening_risk_item", "urgent",
    "phq-9: suicidal_ideation_screen_positive (total 16)",
    "open", null, null, daysAgo(2, 11), null
  );

  // A few audit entries so the audit console isn't empty on first load.
  const insAudit = db.prepare(
    `INSERT INTO audit_log (actor_id, actor_role, event_family, event_type, target, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insAudit.run(alexId, "member", "consent", "consent_granted", null, '{"policy_version":"v1.0-dev"}', daysAgo(21));
  insAudit.run(alexId, "member", "module_runtime", "session_hard_stop", "body-scan", '{"peakSuds":9}', daysAgo(9, 18));
  insAudit.run(clinicianId, "clinician", "specialist_action", "alert_reviewed", null, '{"alertType":"session_hard_stop"}', daysAgo(9, 21));
  insAudit.run(samId, "member", "clinical", "screening_submitted", "phq-9", '{"total":16,"riskFlags":["suicidal_ideation_screen_positive"]}', daysAgo(2, 11));
  insAudit.run(alexId, "member", "clinical", "unlock_requested", "recent-trigger", "{}", daysAgo(1, 9));
}
