import type Database from "better-sqlite3";
import crypto from "crypto";
import { hashPassword } from "./db";

// Rich fictional dataset for demo deployments (EMDR_DEMO=1). Gives both the
// member and clinician views something realistic to show on first login:
// a member three weeks into the program with improving scores, a pending
// unlock request, a reviewed hard-stop, and a second member whose screening
// tripped the urgent risk queue. All people and data are fictional.
//
// DETERMINISTIC. Every identifier is derived from DEMO_SEED_VERSION and a
// counter, so two seedings of the same version produce byte-identical ids. The
// Demo-First handoff §5 requires seed data to be "deterministic, versioned, and
// reviewable" — random UUIDs made all three impossible: nothing could be
// baselined, a reset could not be verified to have restored the same state, and
// a reviewer could not be handed a hash to check.
//
// Wall-clock timestamps still move (the dataset is expressed as "N days ago" so
// the demo always looks current). demoBaseline() in demo-reset.ts therefore
// hashes the time-invariant projection — see that file for what is and is not
// covered.

/** Bump when the dataset changes. The baseline hash changes with it. */
export const DEMO_SEED_VERSION = "demo-2026-08-v2";

/** UUID-shaped but deterministic: sha256(version:n) rendered in UUID form, so
 *  it drops into every existing `TEXT` id column unchanged. */
export function demoId(n: number, version = DEMO_SEED_VERSION): string {
  const h = crypto.createHash("sha256").update(`${version}:${n}`).digest("hex");
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join("-");
}

/**
 * The per-role demo password.
 *
 * Handoff 07 p5 says never to commit a password to source or a client bundle,
 * and p7 says to store the secret outside source control and rotate it before
 * each external review cycle. Both are honoured by the ENVIRONMENT being
 * authoritative: `EMDR_DEMO_PASSWORD_<ROLE>` overrides any value here, so a
 * rotation is a deploy variable rather than a commit.
 *
 * The fallbacks below are deliberately present and deliberately weak. This
 * seeds an isolated tenant of fabricated people with no PHI, where the failure
 * mode of a forgotten password is a reviewer locked out of a demonstration —
 * and a fallback nobody can guess means a fresh clone cannot be signed into at
 * all. They are listed in docs/demo/demo-logins.md rather than hidden, because
 * a credential that is written down in one known place is safer than one
 * circulated in a chat thread.
 *
 * They must never be reused for anything that is not this demo.
 */
export const DEMO_PASSWORDS: Record<string, string> = {
  member: "patient1234",
  clinician: "clinician1234",
  reviewer: "reviewer1234",
  organization: "org1234",
  payer: "payer1234",
  demo_admin: "demoadmin1234",
};

/** The address the scenario scripts and the e2e suite sign in with. */
export const PATIENT_EMAIL = "patient.demo@steady.local";

export function demoPassword(role: string): string {
  return process.env[`EMDR_DEMO_PASSWORD_${role.toUpperCase()}`] ?? DEMO_PASSWORDS[role] ?? "demo1234";
}

function demoHash(role: string): string {
  return hashPassword(demoPassword(role));
}

/**
 * The three narrative personas, by name rather than by position in a counter.
 *
 * They were `demoId(0)`, `demoId(1)` and `demoId(2)` — correct, and a trap:
 * anything outside this file that needed one had to know the insertion order,
 * and inserting a fourth account at the top would silently repoint every
 * reference. Handoff 07's Wave 4 needs the clinician's id from two other
 * modules, so they get names.
 */
export const ALEX_ID = demoId(0);
export const SAM_ID = demoId(1);
export const DEMO_CLINICIAN_ID = demoId(2);

/**
 * The demo accounts, as data rather than as inline inserts.
 *
 * Split out so `reconcileDemoAccounts` below can create a MISSING one on an
 * existing database. `seedDemoData` only runs when the database is empty, so
 * every account added after the first deployment was invisible in production:
 * the code shipped, the login screen offered six roles, and none of the
 * addresses it named existed. That is what the deployed environment did — the
 * dropdown was there and every credential failed.
 */
export interface DemoAccount {
  seq: number;
  email: string;
  name: string;
  role: string;
  /** The address this account used to have, if it was renamed. Renaming keeps
   *  the row — and therefore the whole history hanging off its id — rather
   *  than creating a second person with the same story. */
  formerEmail?: string;
  daysAgo: number;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { seq: 0, email: PATIENT_EMAIL, name: "Alex Rivera (fictional)", role: "member", formerEmail: "demo@example.com", daysAgo: 22 },
  { seq: 1, email: "patient2.demo@steady.local", name: "Sam Okafor (fictional)", role: "member", formerEmail: "demo2@example.com", daysAgo: 2 },
  { seq: 2, email: "clinician.demo@steady.local", name: "Dr. Maya Chen (fictional)", role: "clinician", formerEmail: "clinician@example.com", daysAgo: 40 },
  { seq: 3, email: "org.demo@steady.local", name: "Jordan Idowu (fictional)", role: "organization", formerEmail: "operations@example.com", daysAgo: 60 },
  { seq: 4, email: "payer.demo@steady.local", name: "Priya Raman (fictional)", role: "payer", daysAgo: 60 },
  { seq: 5, email: "reviewer.demo@steady.local", name: "Dr. Ellis Nakamura (fictional)", role: "reviewer", daysAgo: 75 },
  { seq: 6, email: "admin.demo@steady.local", name: "Robin Achebe (fictional)", role: "demo_admin", daysAgo: 90 },
  { seq: 7, email: "network.demo@steady.local", name: "Dana Okonkwo (fictional)", role: "organization", daysAgo: 60 },
];

/**
 * Bring an EXISTING database's demo accounts up to date.
 *
 * Runs on every boot in the demo environment, and is the answer to a failure
 * that is specific to seeded demos and easy to miss: `seed()` returns early
 * when any user exists, so it only ever runs once per database. Everything
 * added to it afterwards — three new roles, six renamed addresses, six new
 * passwords — reached the code and never reached the deployed data.
 *
 * Three operations, each idempotent:
 *
 *   RENAME. An account that still holds its former address is renamed in
 *   place. The row keeps its id, so consents, check-ins, sessions and every
 *   event hanging off that id follow it — which is the whole reason to rename
 *   rather than insert a second account with the same name.
 *
 *   CREATE. An account that does not exist at either address is inserted.
 *
 *   RE-HASH. The password is set to the role's current value on every boot, so
 *   rotating `EMDR_DEMO_PASSWORD_*` takes effect at the next restart without a
 *   reset — which is what p7 means by rotating before an external review
 *   cycle.
 *
 * It does NOT touch a person's history, tenancy or role assignments. Those are
 * the seed's business, and a reconciliation that quietly rewrote them would be
 * a migration wearing a smaller name.
 */
export function reconcileDemoAccounts(db: Database.Database): { renamed: number; created: number; rehashed: number } {
  if (process.env.EMDR_DEMO !== "1") return { renamed: 0, created: 0, rehashed: 0 };
  const out = { renamed: 0, created: 0, rehashed: 0 };

  const byEmail = db.prepare("SELECT id, role FROM users WHERE email = ?");
  const rename = db.prepare("UPDATE users SET email = ?, name = ?, role = ? WHERE id = ?");
  const create = db.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING`);
  const rehash = db.prepare("UPDATE users SET password_hash = ? WHERE email = ?");

  for (const a of DEMO_ACCOUNTS) {
    const current = byEmail.get(a.email) as { id: string; role: string } | undefined;
    if (!current && a.formerEmail) {
      const legacy = byEmail.get(a.formerEmail) as { id: string } | undefined;
      if (legacy) {
        // Rename in place: the id is the person, and the address is a label.
        rename.run(a.email, a.name, a.role, legacy.id);
        out.renamed++;
      }
    }
    if (!byEmail.get(a.email)) {
      const t = new Date(Date.now() - a.daysAgo * 86400000);
      t.setUTCHours(10, 15, 0, 0);
      create.run(
        demoId(a.seq), a.email, a.name, a.role, demoHash(a.role),
        t.toISOString().slice(0, 19).replace("T", " "),
      );
      out.created++;
    }
    rehash.run(demoHash(a.role), a.email);
    out.rehashed++;
  }
  return out;
}

export function seedDemoData(db: Database.Database) {
  let seq = 0;
  const id = () => demoId(seq++);
  const daysAgo = (d: number, hour = 10) => {
    const t = new Date(Date.now() - d * 86400000);
    t.setUTCHours(hour, 15, 0, 0);
    // Never return a future instant. `daysAgo(0, 8)` means "earlier today at
    // 08:15" — but before 08:15 UTC that has not happened yet, and the genesis
    // backfill asserts a reconstructed event occurred before Steady
    // reconstructed it. The seed was therefore invalid for the first eight
    // hours of every UTC day, which is a hard failure that looks like a flake
    // because most runs happen later in the day.
    //
    // Stepping back whole days keeps the value pinned to the same time of day,
    // so day-granular determinism is preserved. Only `*_at` columns use this
    // for same-day rows, and those are excluded from the baseline hash, so
    // shifting one back a day changes no hashed value.
    while (t.getTime() > Date.now()) t.setUTCDate(t.getUTCDate() - 1);
    return t.toISOString().slice(0, 19).replace("T", " ");
  };
  const dateOnly = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

  const insertUser = db.prepare(
    "INSERT INTO users (id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  // ── The six demo identities (handoff 07 §1.2 p6, §1.3 p7) ────────────────
  //
  // ONE IDENTITY PER ROLE. p7 is explicit: "do not use one account with a
  // mutable role claim." Until now `org.demo@steady.local` held the single
  // `admin` role and served BOTH the organization and the payer console, which
  // meant the boundary between them existed only in a comment. Two accounts,
  // two roles, and a reviewer can test the difference by signing in.
  //
  // A DISTINCT PASSWORD PER ROLE. Same reasoning at a smaller scale: a shared
  // password makes "which role am I actually signed in as" a question the
  // presenter answers from memory. Documented in docs/demo/demo-logins.md and
  // overridable per role from the environment, so an external review cycle can
  // rotate them without a commit (p7: "store passwords outside source control;
  // rotate before each external review cycle").
  const alexId = id();
  const samId = id();
  const clinicianId = id();
  insertUser.run(alexId, PATIENT_EMAIL, "Alex Rivera (fictional)", "member", demoHash("member"), daysAgo(22));
  insertUser.run(samId, "patient2.demo@steady.local", "Sam Okafor (fictional)", "member", demoHash("member"), daysAgo(2));
  insertUser.run(clinicianId, "clinician.demo@steady.local", "Dr. Maya Chen (fictional)", "clinician", demoHash("clinician"), daysAgo(40));

  // The two AGGREGATE roles, now separate. Each reads a population and can
  // read no person's record — §30.6's rule that aggregate access does not
  // create care access — and neither can read the other's tenant.
  insertUser.run(
    id(), "org.demo@steady.local", "Jordan Idowu (fictional)", "organization",
    demoHash("organization"), daysAgo(60),
  );
  insertUser.run(
    id(), "payer.demo@steady.local", "Priya Raman (fictional)", "payer",
    demoHash("payer"), daysAgo(60),
  );

  // A SECOND organization account, and it is not a duplicate.
  //
  // There are two organization populations in this deployment and they are
  // deliberately separate: Northside Behavioral Health's 4,820 covered lives,
  // which have no names by design so an aggregate drilldown is impossible, and
  // handoff 07's 240 fabricated profiles enrolled with the eight demo care
  // networks. One account cannot report on both — an organization sees its own
  // tenant, which is the point — so `org.demo` stays on Northside and this one
  // operates a demo network.
  //
  // p7 anticipates exactly this: "one identity per role and OPTIONAL PRESENTER
  // IDENTITIES PER AUDIENCE." Two accounts in the same role, in different
  // tenants, is only possible because scope is now read from the session
  // rather than deduced by counting organization tenants.
  insertUser.run(
    id(), "network.demo@steady.local", "Dana Okonkwo (fictional)", "organization",
    demoHash("organization"), daysAgo(60),
  );

  // The reviewer. p6: fixed gates, evidence, replay, corrections and audit —
  // and NOT routine treatment decisions. The review console was previously
  // reachable only through an environment access code, which gated the door
  // without ever saying who walked through it.
  insertUser.run(
    id(), "reviewer.demo@steady.local", "Dr. Ellis Nakamura (fictional)", "reviewer",
    demoHash("reviewer"), daysAgo(75),
  );

  // Demo administration. p6 grants this role everything inside the fabricated
  // environment — every tenant, person, event, reset and QA control — and
  // nothing outside it. The breadth is the point AND the risk, which is why
  // the page it lands on says so: production administration must use
  // purpose-limited permissions and break-glass access, and this role's
  // blanket visibility must never be carried into it.
  insertUser.run(
    id(), "admin.demo@steady.local", "Robin Achebe (fictional)", "demo_admin",
    demoHash("demo_admin"), daysAgo(90),
  );

  // --- Alex: three weeks into the program, improving ---
  db.prepare(
    "INSERT INTO consents (id, user_id, policy_version, scope, granted_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id(), alexId, "v1.0-dev", "care_program_full", daysAgo(21));

  // Processing-session consent: a DISTINCT, versioned grant, separate from the
  // care-program consent, required before any bilateral-stimulation set
  // (docs/autonomous/bls-validation/01-processing-session-consent.md).
  //
  // Seeded for Alex so a reviewer can walk the resourcing BLS flow. Deliberately
  // NOT seeded for Sam below — a reviewer needs to see the refusal path too, and
  // a demo where every gate is pre-satisfied demonstrates nothing about the
  // gates.
  db.prepare(
    "INSERT INTO consents (id, user_id, policy_version, scope, granted_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id(), alexId, "processing-consent-v1.0", "processing_session", daysAgo(14));

  const insScreening = db.prepare(
    `INSERT INTO screenings (id, user_id, instrument, instrument_version, total_score, answers_json, risk_flags_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // Baseline (21 days ago)
  insScreening.run(id(), alexId, "pc-ptsd-5", "2021", 4, "[1,1,1,1,0]", "[]", daysAgo(21));
  insScreening.run(id(), alexId, "phq-9", "standard", 9, "[1,2,2,1,1,1,1,0,0]", "[]", daysAgo(21));
  insScreening.run(id(), alexId, "gad-7", "standard", 9, "[2,1,2,1,1,1,1]", "[]", daysAgo(21));
  // Program-fit screener PASSED (no hard-stops) — without this row the demo
  // member is blocked from every session, so the demo could never reach a
  // guided session. Cleared, so calm-place and the other autonomous modules open.
  insScreening.run(id(), alexId, "fitness-screener", "fit-v1-placeholder", 0, "[]", "[]", daysAgo(21));
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

  // --- Memberships: Alex pays for Premium; Sam is in the free Premium week
  // with billing set to start on Plus ---
  const insSub = db.prepare(
    `INSERT INTO subscriptions (user_id, plan, status, price_cents, currency, provider, current_period_end, created_at)
     VALUES (?, ?, ?, ?, 'usd', 'demo', ?, ?)`
  );
  // Pins the time of day, exactly as daysAgo does. Without this the value
  // carried the current SECOND, so two resets a second apart produced different
  // data and the baseline hash disagreed with itself — intermittently, which is
  // the worst way for a determinism guarantee to fail. `current_period_end` does
  // not end in `_at`, so the baseline's timestamp exclusion never covered it and
  // the drift was hashed as if it were real. Fixed at the source rather than by
  // widening the exclusion, so the value stays under the baseline's protection.
  const inFuture = (d: number, hour = 10) => {
    const t = new Date(Date.now() + d * 86400000);
    t.setUTCHours(hour, 15, 0, 0);
    return t.toISOString().slice(0, 19).replace("T", " ");
  };
  insSub.run(alexId, "premium", "active", 3499, inFuture(16), daysAgo(22));
  insSub.run(samId, "plus", "trialing", 1999, inFuture(5), daysAgo(2));
  const insPayment = db.prepare(
    `INSERT INTO payments (id, user_id, amount_cents, currency, status, description, provider, created_at)
     VALUES (?, ?, 3499, 'usd', 'succeeded', ?, 'demo', ?)`
  );
  insPayment.run(id(), alexId, "First month after free trial (simulated)", daysAgo(15));
  insPayment.run(id(), alexId, "Monthly renewal (simulated)", daysAgo(0, 7));

  // --- Alex: onboarding profile, triggers, safety plan, companion memory ---
  db.prepare(
    `INSERT INTO user_profiles (user_id, therapist_status, emdr_experience, goals_json, trauma_areas_json, restricted_topics_json, profile_complete, created_at)
     VALUES (?, 'previously', 'no', ?, ?, ?, 1, ?)`
  ).run(
    alexId,
    JSON.stringify(["Daily grounding", "Understanding triggers", "Processing trauma safely"]),
    JSON.stringify(["Childhood", "Relationships", "Emotional abuse"]),
    JSON.stringify(["Sexual trauma"]),
    daysAgo(21)
  );

  const insTrigger = db.prepare(
    `INSERT INTO user_triggers (id, user_id, trigger_name, trigger_category, intensity_score, common_responses_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const alexTriggers: [string, string, number, string[]][] = [
    ["Feeling ignored", "relational", 7, ["Shutdown", "Overthinking"]],
    ["Someone raising their voice", "relational", 8, ["Anxiety", "Urge to isolate"]],
    ["Crowds", "environmental", 5, ["Anxiety", "Avoidance"]],
    ["Anniversaries", "memory", 6, ["Numbness", "Crying"]],
    ["Feeling like a burden", "internal", 7, ["People-pleasing", "Urge to isolate"]],
  ];
  const alexTriggerIds: Record<string, string> = {};
  for (const [name, cat, intensity, responses] of alexTriggers) {
    const tid = id();
    alexTriggerIds[name] = tid;
    insTrigger.run(tid, alexId, name, cat, intensity, JSON.stringify(responses), daysAgo(21));
  }

  const insSign = db.prepare(
    "INSERT INTO early_warning_signs (id, user_id, sign_name, created_at) VALUES (?, ?, ?, ?)"
  );
  for (const sign of ["Tight chest", "Racing thoughts", "Sudden tiredness", "Wanting to leave"]) {
    insSign.run(id(), alexId, sign, daysAgo(21));
  }

  const insReadiness = db.prepare(
    `INSERT INTO readiness_assessments
       (id, user_id, stability_score, body_safety_score, present_connection_score, symptom_intensity_score,
        sleep_quality, support_available, processing_readiness, pause_capacity, pace_preference,
        risk_flag, calculated_readiness_score, recommended_track, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // Baseline at onboarding (preparation) and a recent recalculation that has
  // grown into gentle processing as check-ins steadied.
  insReadiness.run(
    id(), alexId, 5, 5, 6, 6, "poor", "sometimes", "curious", "think_so", "slow",
    "none", 54, "preparation", "onboarding", daysAgo(21)
  );
  insReadiness.run(
    id(), alexId, 7, 8, 8, 4, "okay", "sometimes", "curious", "yes", "slow",
    "none", 68, "gentle_processing", "checkin", daysAgo(0, 8)
  );

  db.prepare(
    `INSERT INTO safety_plans (user_id, grounding_tools_json, support_contact_name, support_contact_method,
       reminder_phrase, stop_signs, careful_topics, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    alexId,
    JSON.stringify(["Walking", "Cold water", "Music"]),
    "Jamie (sister, fictional)",
    "Text first, then call",
    "This feeling is a wave. I am not in that moment anymore.",
    "Going numb, losing track of the room, wanting to disappear",
    "Anything about my father",
    daysAgo(21)
  );

  db.prepare(
    `INSERT INTO ai_companion_preferences (user_id, preferred_user_name, tone, support_modes_json, avoidances_json, memory_enabled, created_at)
     VALUES (?, 'Alex', 'Warm', ?, ?, 'yes', ?)`
  ).run(
    alexId,
    JSON.stringify(["Grounding me when I'm activated", "Helping me decide if I'm ready today", "Reminding me what works"]),
    JSON.stringify(["Positive clichés"]),
    daysAgo(21)
  );

  const insMemory = db.prepare(
    `INSERT INTO ai_memory_items (id, user_id, memory_type, memory_key, memory_value, source_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const [name, , intensity, responses] of alexTriggers) {
    insMemory.run(
      id(), alexId, "trigger", name,
      `Intensity ${intensity}/10. Usual response: ${responses.join(", ")}.`,
      "onboarding", daysAgo(21)
    );
  }
  for (const tool of ["Walking", "Cold water", "Music"]) {
    insMemory.run(id(), alexId, "grounding_tool", tool, "Chosen in safety plan.", "onboarding", daysAgo(21));
  }
  insMemory.run(
    id(), alexId, "safety", "reminder_phrase",
    "This feeling is a wave. I am not in that moment anymore.", "onboarding", daysAgo(21)
  );
  insMemory.run(
    id(), alexId, "restricted_topic", "Sexual trauma",
    "Do not raise unless the member brings it up first.", "onboarding", daysAgo(21)
  );
  insMemory.run(
    id(), alexId, "readiness", "current_track", "gentle_processing (score 68/100)", "daily_checkin", daysAgo(0, 8)
  );
  insMemory.run(
    id(), alexId, "progress_pattern", "walking_after_triggers",
    "Walking has helped settle relational triggers on three recent occasions.", "session_reflection", daysAgo(3)
  );

  // Log a known trigger on today's check-in so the dashboard trigger watch
  // has something to show.
  db.prepare("UPDATE checkins SET triggers_json = ? WHERE user_id = ? AND checkin_date = ?").run(
    JSON.stringify([alexTriggerIds["Feeling ignored"]]),
    alexId,
    dateOnly(0)
  );

  // A short companion conversation so the chat history isn't empty.
  const convId = id();
  db.prepare(
    "INSERT INTO ai_conversations (id, user_id, context_type, started_at) VALUES (?, ?, 'general', ?)"
  ).run(convId, alexId, daysAgo(2, 20));
  const insMsg = db.prepare(
    `INSERT INTO ai_messages (id, conversation_id, user_id, sender, message_text, risk_flag, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  );
  insMsg.run(id(), convId, alexId, "member", "Rough evening. My text got left on read and I spiraled a bit.", daysAgo(2, 20));
  insMsg.run(
    id(), convId, alexId, "companion",
    "Alex, that sounds like it may connect to one of your known triggers: feeling ignored. Naming it is already a steadying step. Last time something like this showed up, walking helped. Would you like to use one of your grounding tools now?",
    daysAgo(2, 20)
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
