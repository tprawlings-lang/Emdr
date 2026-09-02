import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { seedDemoData, reconcileDemoAccounts, demoId, demoPassword } from "./demo-seed";
import { seedPolicyThresholds } from "./planning/policy";
import { seedOrgData, ORG_TENANT_ID } from "./demo-org-seed";
import { seedPayerData, PAYER_TENANT_ID } from "./demo-payer-seed";
import { seedPopulationData, seedOperationalFeeds, orgTenantId } from "./demo-population-seed";
import { generatePopulationHistory } from "./demo-population-generator";
import { runAgents } from "./agents/runner";
import { ulid, NIL_ULID, ulidFrom } from "./ids";

// Resolved lazily inside getDb() (not at module load) so EMDR_DATA_DIR is
// honored even when set just before the first DB access — e.g. hermetic tests.
function dataDir(): string {
  return process.env.EMDR_DATA_DIR ?? path.join(process.cwd(), ".data");
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(path.join(dir, "emdr.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seed(db);
  // AFTER seed: on a fresh database migrate() runs against an empty users
  // table, so the identity-spine backfill inside it finds nothing to mirror.
  // Reconciling here covers both cases — an existing database (mirrored during
  // migrate) and a fresh one (mirrored now, once seed has created the users).
  // Idempotent, so running twice is harmless.
  backfillIdentitySpine(db);

  // NOTE — deliberately NOT resetting here, even for demo environments.
  // `db` is module-level state, and Next.js may instantiate this module more
  // than once per process (route bundles carry their own copies), so any
  // destructive work on this path can run again partway through a request and
  // delete data another route just wrote. That failure was observed: a sign-off
  // recorded by a server action vanished before the export route read it.
  // Resetting is an explicit operation (`npm run demo -- reset`), never a side
  // effect of opening the database.
  // Demo accounts are reconciled on EVERY boot, not only on a fresh seed.
  // `seed()` returns early when any user exists, so on a deployed database it
  // has run exactly once — and every account added since then reached the code
  // and never reached the data. That is precisely what happened: the login
  // screen offered six roles and none of the addresses it named existed.
  reconcileDemoAccounts(db);
  // Planning thresholds are seeded on every boot for the same reason, and with
  // the same insert-if-absent behaviour: a row that already exists is left
  // alone, because it may carry an owner and an approval date that a redeploy
  // has no business overwriting (p34, plan decision D5).
  seedPolicyThresholds(db);
  refreshDemoDaily(db);
  return db;
}

// Demo data is seeded once onto a persistent disk, so its "today" check-in is
// dated to the seed day and goes stale — after which the daily check-in gate
// blocks every module (even ones a clinician opened, since an override never
// bypasses the daily safety read). On each boot, give the demo members a
// check-in for the ACTUAL today (if missing) so the demo stays usable.
function refreshDemoDaily(db: Database.Database) {
  if (process.env.EMDR_DEMO !== "1") return;
  const today = new Date().toISOString().slice(0, 10);
  for (const email of ["patient.demo@steady.local", "patient2.demo@steady.local"]) {
    // The TENANT is read with the id, and that is a correction. This insert
    // omitted tenant_id and took the column default — the platform tenant —
    // which was right for exactly as long as every demo member lived there.
    // Once Alex and Sam moved into NE Care Network A, today's check-in was the
    // one row of theirs still filed under the old tenant, and replay caught it
    // immediately: the ledger rebuilt it into the person's tenant while the
    // live row said platform.
    const m = db.prepare("SELECT id, tenant_id FROM users WHERE email = ?").get(email) as
      | { id: string; tenant_id: string } | undefined;
    if (!m) continue;
    const has = db.prepare("SELECT 1 FROM checkins WHERE user_id = ? AND checkin_date = ?").get(m.id, today);
    if (has) continue;
    db.prepare(
      `INSERT INTO checkins (id, user_id, tenant_id, checkin_date, activation, shutdown, harm_urge,
         feels_safe, dissociation, sleep_quality, substance_flag, recommended_action)
       VALUES (?, ?, ?, ?, 3, 1, 0, 1, 1, 6, 0, 'processing_ok')`
      // Deterministic per member per day, so a reset reproduces it and a
      // second boot on the same day cannot create a duplicate.
    ).run(demoId(0, `checkin:${m.id}:${today}`), m.id, m.tenant_id, today);
  }
}

function migrate(db: Database.Database) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('member','clinician','reviewer','organization','payer','demo_admin')),
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS consents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    policy_version TEXT NOT NULL,
    scope TEXT NOT NULL,
    granted_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at TEXT
  );

  CREATE TABLE IF NOT EXISTS screenings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    instrument TEXT NOT NULL,
    instrument_version TEXT NOT NULL,
    total_score INTEGER NOT NULL,
    answers_json TEXT NOT NULL,
    risk_flags_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS checkins (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    checkin_date TEXT NOT NULL,
    activation INTEGER NOT NULL,
    shutdown INTEGER NOT NULL,
    harm_urge INTEGER NOT NULL,
    feels_safe INTEGER NOT NULL,
    dissociation INTEGER NOT NULL,
    sleep_quality INTEGER NOT NULL,
    substance_flag INTEGER NOT NULL,
    recommended_action TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, checkin_date)
  );

  CREATE TABLE IF NOT EXISTS therapy_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    module_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress'
      CHECK (status IN ('in_progress','completed','hard_stop','abandoned')),
    pre_suds INTEGER,
    post_suds INTEGER,
    peak_suds INTEGER,
    hard_stop_reason TEXT,
    detail_json TEXT NOT NULL DEFAULT '{}',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT
  );

  CREATE TABLE IF NOT EXISTS post_session_checks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES therapy_sessions(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    distress INTEGER NOT NULL,
    oriented INTEGER NOT NULL,
    safe_tonight INTEGER NOT NULL,
    delayed_risk INTEGER NOT NULL,
    recovery_confirmed INTEGER NOT NULL,
    escalated INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS module_unlocks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    module_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested'
      CHECK (status IN ('requested','unlocked','denied','revoked')),
    member_note TEXT,
    clinician_id TEXT REFERENCES users(id),
    decision_reason TEXT,
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at TEXT,
    UNIQUE (user_id, module_id)
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('urgent','high','moderate','info')),
    detail TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed')),
    reviewed_by TEXT REFERENCES users(id),
    review_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id TEXT,
    actor_role TEXT,
    event_family TEXT NOT NULL,
    event_type TEXT NOT NULL,
    target TEXT,
    detail_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    therapist_status TEXT,
    emdr_experience TEXT,
    goals_json TEXT NOT NULL DEFAULT '[]',
    trauma_areas_json TEXT NOT NULL DEFAULT '[]',
    restricted_topics_json TEXT NOT NULL DEFAULT '[]',
    profile_complete INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_triggers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    trigger_name TEXT NOT NULL,
    trigger_category TEXT NOT NULL,
    intensity_score INTEGER,
    common_responses_json TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, trigger_name)
  );

  CREATE TABLE IF NOT EXISTS early_warning_signs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    sign_name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, sign_name)
  );

  CREATE TABLE IF NOT EXISTS readiness_assessments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    stability_score INTEGER NOT NULL,
    body_safety_score INTEGER NOT NULL,
    present_connection_score INTEGER NOT NULL,
    symptom_intensity_score INTEGER NOT NULL,
    sleep_quality TEXT NOT NULL,
    support_available TEXT NOT NULL,
    processing_readiness TEXT NOT NULL,
    pause_capacity TEXT NOT NULL,
    pace_preference TEXT,
    risk_flag TEXT NOT NULL DEFAULT 'none',
    calculated_readiness_score INTEGER NOT NULL,
    recommended_track TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'onboarding',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS safety_plans (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    grounding_tools_json TEXT NOT NULL DEFAULT '[]',
    support_contact_name TEXT,
    support_contact_method TEXT,
    reminder_phrase TEXT,
    stop_signs TEXT,
    careful_topics TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ai_companion_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    preferred_user_name TEXT,
    tone TEXT NOT NULL DEFAULT 'gentle',
    support_modes_json TEXT NOT NULL DEFAULT '[]',
    avoidances_json TEXT NOT NULL DEFAULT '[]',
    memory_enabled TEXT NOT NULL DEFAULT 'yes',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ai_memory_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    memory_type TEXT NOT NULL,
    memory_key TEXT NOT NULL,
    memory_value TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ai_conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    context_type TEXT NOT NULL DEFAULT 'general',
    risk_level TEXT NOT NULL DEFAULT 'none',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT
  );

  CREATE TABLE IF NOT EXISTS ai_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES ai_conversations(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    sender TEXT NOT NULL CHECK (sender IN ('member','companion')),
    message_text TEXT NOT NULL,
    risk_flag INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    plan TEXT NOT NULL DEFAULT 'monthly',
    status TEXT NOT NULL CHECK (status IN ('trialing','active','past_due','canceled')),
    price_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    provider TEXT NOT NULL DEFAULT 'demo',
    provider_ref TEXT,
    cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
    current_period_end TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    status TEXT NOT NULL CHECK (status IN ('succeeded','failed','refunded')),
    description TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'demo',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS program_plans (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    plan_json TEXT NOT NULL,
    generated_by TEXT NOT NULL DEFAULT 'rules',
    source TEXT NOT NULL DEFAULT 'trigger_map',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_program_plans_user ON program_plans(user_id, created_at);

  CREATE TABLE IF NOT EXISTS care_tracks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    track_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, track_id)
  );

  CREATE TABLE IF NOT EXISTS care_track_intake (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    goal_text TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_care_tracks_user ON care_tracks(user_id, status);

  CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at);

  CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_screenings_user ON screenings(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_triggers_user ON user_triggers(user_id, active);
  CREATE INDEX IF NOT EXISTS idx_readiness_user ON readiness_assessments(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_memory_user ON ai_memory_items(user_id, memory_type, active);
  CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id, created_at);

  CREATE TABLE IF NOT EXISTS autonomous_signoffs (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL,
    config_version TEXT NOT NULL,
    verdict TEXT NOT NULL CHECK (verdict IN ('agree','needs_change')),
    note TEXT,
    clinician_id TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_signoffs_rule ON autonomous_signoffs(rule_id, config_version, created_at);

  -- Reviewer change requests (Phase 4 testing cycle).
  --
  -- The point of a review environment is that someone walks it and says what
  -- they would change. Without somewhere for that to land, feedback arrives as
  -- a verbal aside and is lost between the session and the next commit.
  --
  -- subject_id is nullable and holds a member id only when a note is about a
  -- specific record. It is NOT a user_id column: a note is authored by a
  -- reviewer about a surface, and most notes are about no one. Tenant scope
  -- comes from reviewer_id.
  -- reviewer_id deliberately carries NO foreign key, and tenant/name are stored
  -- rather than joined. A demo reset deletes and re-seeds users; a change
  -- request has to outlive that, because it is feedback about the product, not
  -- a record about a person. A note that vanished when the environment was
  -- refreshed would take the reviewer's hour with it.
  CREATE TABLE IF NOT EXISTS review_notes (
    id TEXT PRIMARY KEY,
    reviewer_id TEXT NOT NULL,
    reviewer_name TEXT NOT NULL DEFAULT '',
    tenant_id TEXT NOT NULL DEFAULT '00000000000000000000000000',
    reviewer_role TEXT NOT NULL,
    surface TEXT NOT NULL,
    category TEXT NOT NULL,
    priority TEXT NOT NULL CHECK (priority IN ('blocker','change','question','idea')),
    observed TEXT NOT NULL,
    requested TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','actioned','declined')),
    subject_id TEXT,
    config_version TEXT,
    policy_version TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_review_notes ON review_notes(status, created_at);

  -- Partial questionnaire answers (Presentation Layer Handoff 5).
  --
  -- The gate was one form of eighteen to twenty required items with nothing
  -- persisted until the final submit, so leaving mid-way lost everything and
  -- the only way back in was "start over". Vol 1's 2026 guidance and the
  -- depleted-brain principle both require that pausing mid-check loses nothing.
  --
  -- One row per answered item, written the moment it is answered. The score is
  -- computed only at completion and lives in screenings as before; this table
  -- holds answers in progress and is deleted when they are submitted.
  CREATE TABLE IF NOT EXISTS screening_progress (
    user_id TEXT NOT NULL REFERENCES users(id),
    instrument TEXT NOT NULL,
    item_index INTEGER NOT NULL,
    value INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, instrument, item_index)
  );

  CREATE TABLE IF NOT EXISTS practice_completions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    practice_id TEXT NOT NULL,
    practice_type TEXT NOT NULL,
    duration_sec INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_practice_completions_user ON practice_completions(user_id, created_at);

  CREATE TABLE IF NOT EXISTS upsell_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_upsell_events_user ON upsell_events(user_id, created_at);

  CREATE TABLE IF NOT EXISTS autopilot_plans (
    user_id TEXT NOT NULL REFERENCES users(id),
    plan_date TEXT NOT NULL,
    checkin_state TEXT NOT NULL DEFAULT 'none',
    plan_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, plan_date)
  );

  CREATE TABLE IF NOT EXISTS autopilot_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_autopilot_events_user ON autopilot_events(user_id, created_at);

  CREATE TABLE IF NOT EXISTS lesson_reads (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    lesson_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, lesson_id)
  );

  -- ─────────────────────────────────────────────────────────────────────────
  -- Longitudinal spine (ADR 0010) + identity/tenancy model (ADR 0011).
  --
  -- Additive: nothing above this line changes behaviour yet. The application
  -- still reads and writes the current-state tables; these are populated in
  -- parallel and become authoritative in a later step.
  -- ─────────────────────────────────────────────────────────────────────────

  -- A governance boundary. Consumer users belong to the reserved platform
  -- tenant (NIL_ULID) so tenant_id is never null and the query path is uniform.
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('platform','organization','facility','program')),
    name TEXT NOT NULL,
    parent_tenant_id TEXT REFERENCES tenants(id),
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A human Steady holds data about. MAY EXIST WITHOUT AN ACCOUNT: Handoff C3
  -- ingests covered populations whose members have never logged in. This is the
  -- subject of every clinical record and every longitudinal event.
  -- A person. FABRICATED OR REAL, and the column has no default on purpose.
  --
  -- Until now the separation between the two was three conventions — the
  -- EMDR_DEMO environment flag, a "fabricated" key inside an event's
  -- provenance JSON, and a manifest check counting unmarked rows. None of them
  -- stops a cohort query spanning both, and the Observation type carried no
  -- provenance at all, so a follow-up completion rate computed over a mixed
  -- population returned one number with no way to tell.
  --
  -- That was survivable while every environment was entirely fabricated. It
  -- stops being survivable the moment synthetic agents run alongside a study
  -- with real participants, which is the stated intent.
  --
  -- NO DEFAULT, because neither default is safe. Default to 'real' and a seed
  -- that forgets to mark its rows contaminates a real metric; default to
  -- 'fabricated' and a signup that forgets marks a real person's data as
  -- invented. NOT NULL with no default forces every writer to say which it is
  -- at the point where somebody knows the answer.
  CREATE TABLE IF NOT EXISTS persons (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    display_name TEXT,
    timezone TEXT,
    locale TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_persons_tenant ON persons(tenant_id);

  -- A login. Optional, and distinct from the person it authenticates.
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES persons(id),
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    email TEXT NOT NULL,
    password_hash TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    token_epoch INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(email)
  );
  CREATE INDEX IF NOT EXISTS idx_accounts_person ON accounts(person_id);

  -- Role is a RELATIONSHIP, not an attribute. This fixes a modelling error in
  -- users.role: a clinician who is also a member is unrepresentable there.
  CREATE TABLE IF NOT EXISTS role_assignments (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES persons(id),
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    role TEXT NOT NULL CHECK (role IN ('member','clinician','care_manager','reviewer','organization','payer','demo_admin')),
    scope TEXT,
    effective_from TEXT NOT NULL DEFAULT (datetime('now')),
    effective_to TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(person_id, tenant_id, role)
  );
  CREATE INDEX IF NOT EXISTS idx_role_assignments_person ON role_assignments(person_id, tenant_id);

  -- Carries a person into an enterprise program without duplicating identity.
  -- Time-bounded: historical membership is preserved, never overwritten.
  CREATE TABLE IF NOT EXISTS enrollments (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES persons(id),
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    program_id TEXT,
    eligibility TEXT,
    effective_from TEXT NOT NULL DEFAULT (datetime('now')),
    effective_to TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_enrollments_person ON enrollments(person_id, tenant_id);

  -- Maps source-system IDs to canonical person IDs. Per Handoff C2, external
  -- identifiers are NEVER primary keys.
  CREATE TABLE IF NOT EXISTS external_identifiers (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES persons(id),
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    source_system TEXT NOT NULL,
    external_id TEXT NOT NULL,
    id_type TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tenant_id, source_system, external_id)
  );

  -- The authoritative history (ADR 0010). Append-only; corrections append a
  -- superseding event rather than updating. occurred_at (when it happened in
  -- the world) is distinct from recorded_at (when Steady learned of it) —
  -- Handoff D4 needs both to reconstruct a prediction's inputs without
  -- future-data leakage.
  CREATE TABLE IF NOT EXISTS longitudinal_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    person_id TEXT NOT NULL REFERENCES persons(id),
    event_type TEXT NOT NULL,
    payload_version INTEGER NOT NULL DEFAULT 1,
    payload TEXT NOT NULL DEFAULT '{}',
    actor_id TEXT,
    actor_type TEXT NOT NULL DEFAULT 'system'
      CHECK (actor_type IN ('patient','clinician','care_manager','system','model','integration')),
    occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
    recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
    source_system TEXT NOT NULL DEFAULT 'steady',
    provenance TEXT NOT NULL DEFAULT '{}',
    correlation_id TEXT,
    supersedes_event_id TEXT REFERENCES longitudinal_events(id)
  );
  CREATE INDEX IF NOT EXISTS idx_levents_person ON longitudinal_events(person_id, id);
  -- supersedes_event_id is a foreign key onto this same table, and an
  -- unindexed one makes every DELETE scan the whole table to prove no row
  -- references the one going away. At demo scale that was invisible; at 32,000
  -- events a single DELETE FROM longitudinal_events took 36 seconds, which
  -- is quadratic and would get worse, not better, in a real deployment. It
  -- also slows every correction, since a superseding write updates this
  -- column.
  CREATE INDEX IF NOT EXISTS idx_levents_supersedes ON longitudinal_events(supersedes_event_id);
  CREATE INDEX IF NOT EXISTS idx_levents_tenant ON longitudinal_events(tenant_id, id);
  -- Aggregate reporting asks a different question of this table than the
  -- record does: "how many distinct people in this tenant have an event of
  -- this type", not "what happened to this person". Neither index above helps
  -- with that, so the organization projections were doing full scans — the
  -- operating overview took 7.8 seconds and the location comparison 13.0.
  -- Ordered (tenant_id, event_type, person_id) so the tenant filter, the type
  -- filter and the DISTINCT are all served by the same index.
  CREATE INDEX IF NOT EXISTS idx_levents_tenant_type
    ON longitudinal_events(tenant_id, event_type, person_id);
  -- The access-pathway joins pair a person's referral with their later contact
  -- by (person_id, event_type), which the person index above cannot serve
  -- because its second column is the event id.
  CREATE INDEX IF NOT EXISTS idx_levents_person_type
    ON longitudinal_events(person_id, event_type, occurred_at);

  -- ── Payer domain (§26's ten payer screens, §30.2's enterprise domain) ──
  --
  -- A payer reports on a CONTRACTED POPULATION using CLAIMS, and neither
  -- existed here. The three tables below are the smallest model that lets the
  -- payer screens be counted rather than asserted.
  --
  -- The load-bearing column is claims.received_at. A claim is incurred on one
  -- date and arrives weeks later, so the most recent months are always
  -- incomplete — and a per-1,000 trend that ignores that draws utilisation
  -- falling off a cliff at the right-hand edge, every time, for every payer,
  -- purely because the post has not arrived. Storing both dates is what lets
  -- the chart say "incomplete" instead of "improved".
  CREATE TABLE IF NOT EXISTS payer_contracts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    cohort_version TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    -- Typical lag before a claim for a given service date has arrived, in
    -- days. Stated by the contract rather than inferred, because a reader
    -- needs to know the expected lag to judge whether the observed one is
    -- normal.
    claims_lag_days INTEGER NOT NULL DEFAULT 60,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contract_measures (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL REFERENCES payer_contracts(id),
    metric TEXT NOT NULL,
    label TEXT NOT NULL,
    target_value REAL NOT NULL,
    unit TEXT NOT NULL,
    -- Which direction counts as meeting the target. Stored, because "lower is
    -- better" is true of ED visits and false of follow-up, and a report that
    -- assumes one silently inverts half its own rows.
    better TEXT NOT NULL CHECK (better IN ('lower','higher')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    person_id TEXT NOT NULL REFERENCES persons(id),
    claim_type TEXT NOT NULL,
    incurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'accepted'
      CHECK (status IN ('accepted','pending','rejected','corrected')),
    supersedes_claim_id TEXT REFERENCES claims(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_claims_tenant_type
    ON claims(tenant_id, claim_type, incurred_at);
  CREATE INDEX IF NOT EXISTS idx_claims_person ON claims(person_id);
  -- Self-referencing foreign key, indexed. The event ledger shipped without
  -- the equivalent and one DELETE took 36 seconds at 32k rows.
  CREATE INDEX IF NOT EXISTS idx_claims_supersedes ON claims(supersedes_claim_id);

  -- ── Demographic attributes (handoff 07 §2.3, p13) ────────────────────────
  --
  -- A SEPARATE table from 'persons', and the separation is the control.
  --
  -- p13 permits these fields for exactly three purposes — representation
  -- audit, disparity audit, and access/fairness review — and forbids them as
  -- care-selection rules. Federal nondiscrimination rules (45 CFR 92.210)
  -- prohibit discriminatory use of patient-care decision-support tools and
  -- describe an ongoing duty to identify tools that use protected factors, so
  -- the audit path has to exist even while the first engine is descriptive.
  --
  -- Keeping them off 'persons' means a clinical query that selects a person
  -- does not carry race and ethnicity along by default. Reaching them is a
  -- join someone has to write, which is the moment a reviewer can ask why.
  --
  -- Every column is SELF-DESCRIBED and every one permits unknown or declined
  -- as a distinct value from missing. p13: show unknown, declined and missing
  -- separately; do not redistribute them.
  CREATE TABLE IF NOT EXISTS person_attributes (
    person_id TEXT PRIMARY KEY REFERENCES persons(id),
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    -- Stored exactly; DISPLAYED as a band. A screen cannot become
    -- person-identifying by being precise about an age.
    birth_year INTEGER,
    age_band TEXT,
    -- JSON array: p13 permits multiple values, so one column with one value
    -- would force the collapse it forbids.
    race_json TEXT NOT NULL DEFAULT '[]',
    -- A separate field from race, never collapsed into it or inferred.
    ethnicity TEXT,
    preferred_language TEXT,
    interpreter_needed INTEGER NOT NULL DEFAULT 0,
    -- Functional access needs, not labels alone (p13).
    access_needs_json TEXT NOT NULL DEFAULT '[]',
    -- U.S. Census region. A REPORTING dimension. If partner operating regions
    -- arrive later they get their own column — p11 is explicit that the two
    -- definitions must never be mixed in one chart.
    census_region TEXT,
    state TEXT,
    -- Authored insurance and access-barrier context. p13 forbids deriving a
    -- hidden deprivation score for person routing from it.
    socioeconomic_context TEXT,
    -- Where the value came from. p13 requires patient-reported provenance on
    -- a clinician surface, and a field with no provenance is a field that gets
    -- treated as fact.
    source TEXT NOT NULL DEFAULT 'self_reported',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_person_attributes_tenant
    ON person_attributes(tenant_id, census_region);

  -- ── Governed exports (§29.1, §30.4, §31.4) ───────────────────────────────
  --
  -- An export is a WRITE, not a read, which is why §30.4 gives it a POST. It
  -- takes data out of this system into a spreadsheet that is copied, emailed
  -- and outlives the screen it came from — so the record of it has to outlive
  -- the file too.
  --
  -- §31.4's export row names six things, and each is a column here rather than
  -- a convention: filter parity, cohort version, suppression, purpose, audit
  -- event, signed file. The one that does the most work is filter_hash: it
  -- is computed from the filter the SCREEN was showing, so a file can be
  -- checked against the view that produced it. An export that silently widened
  -- its own filter is a disclosure nobody authorised, and without the hash
  -- nobody could tell afterwards.
  CREATE TABLE IF NOT EXISTS export_jobs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    requested_by TEXT NOT NULL REFERENCES users(id),
    -- What the requester said they needed it for, in their own words. Recorded
    -- before the file exists, because a purpose supplied afterwards is a
    -- justification rather than a reason.
    purpose TEXT NOT NULL,
    surface TEXT NOT NULL,
    cohort_version TEXT NOT NULL,
    filter_json TEXT NOT NULL DEFAULT '{}',
    filter_hash TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    -- Cells withheld by small-cell suppression IN THE FILE. Suppression that
    -- only applies to the rendering is not suppression.
    suppressed_cells INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL,
    signature TEXT NOT NULL,
    -- No audit_event_id column. The audit log is hash-chained and append-only
    -- and audit() returns nothing, so such a column could only ever be NULL —
    -- and a null foreign key that claims to link a disclosure to its record is
    -- worse than no column, because it looks like the link is there. The tie
    -- is content_hash, which appears in both rows.
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_export_jobs_tenant ON export_jobs(tenant_id, created_at);

  -- A cost model is an ESTIMATE and its status is the whole point: a draft and
  -- an approved model must never render alike, and a superseded one must stay
  -- readable so an old report can be reproduced.
  CREATE TABLE IF NOT EXISTS cost_model_versions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    model_version TEXT NOT NULL,
    scenario TEXT NOT NULL,
    low REAL NOT NULL,
    point REAL NOT NULL,
    high REAL NOT NULL,
    unit TEXT NOT NULL DEFAULT 'PMPM',
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft','approved','superseded')),
    assumptions_json TEXT NOT NULL DEFAULT '[]',
    approved_by TEXT,
    approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ── The demo clock (handoff 07 §1.5, p9) ────────────────────────────────
  --
  -- p9's second control: "Advance clock — move demo date to a scripted
  -- milestone. Guard: demo only; clock shown in shell."
  --
  -- A ROW, not module state. Next.js instantiates a module more than once per
  -- process — route bundles carry their own copies — so a clock held in memory
  -- would read differently depending on which bundle served the request, and a
  -- presenter would watch two screens disagree about what day it is.
  --
  -- ONE ROW, enforced by the primary key. A clock with two values is not a
  -- clock, and a table that permits one invites a migration that leaves a
  -- stale row behind for something to read.
  --
  -- WHAT THIS MOVES, AND WHAT IT MUST NEVER MOVE. The clock changes the
  -- READING FRAME: what "the last ninety days" means, which window a metric
  -- reports, where a retention milestone falls. It does not change the RECORD.
  -- Audit entries, session issue and expiry, and rate limits stay on the real
  -- clock, and they have to: a demo clock that could backdate an audit row
  -- would make the tamper-evident chain a chain of whatever somebody set the
  -- date to, and one that could advance a session's expiry would be a
  -- privilege escalation with a friendly name.
  CREATE TABLE IF NOT EXISTS demo_clock (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    -- The instant the environment should be READ AS. Null means live: the
    -- clock is the real one and nothing is overridden.
    viewing_at TEXT,
    -- Which scripted milestone this is, when it is one. p9 says "a scripted
    -- milestone" rather than an arbitrary date, and the name is what a
    -- presenter says out loud.
    milestone TEXT,
    -- p9's guard on the reset control is a typed reason, and the same applies
    -- here: a clock somebody moved for no recorded purpose is a clock nobody
    -- can explain afterwards.
    reason TEXT,
    set_by TEXT,
    -- REAL time, always. When somebody moved the clock is a fact about the
    -- world, and recording it on the clock being moved is circular.
    set_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- ── Operational capacity (handoff 07 §3.4 p34; handoff 06 §26's capacity
  --    screen) ───────────────────────────────────────────────────────────────
  --
  -- Open first-visit slots, by site and week. p34's REGION_CAPACITY rule
  -- compares demand against this and produces nothing when it is stale or
  -- absent — which it was, in every deployment, because no scheduling feed
  -- existed anywhere in the schema. The organization capacity screen rendered
  -- half a ratio and said so above the chart.
  --
  -- This is a FABRICATED STAND-IN for a scheduling integration. It carries an
  -- as_of for exactly that reason: a capacity number with no age is a
  -- capacity number somebody will act on next quarter, and p34's staleness
  -- condition is the guard that stops them.
  CREATE TABLE IF NOT EXISTS capacity_slots (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    -- The reporting region, so a rule about regional capacity can group
    -- without joining through persons.
    census_region TEXT NOT NULL,
    -- A FOUR-WEEK period, not a week. The grain has to match the population it
    -- describes: 240 people over a year generate about three first-visit
    -- referrals per region per four weeks, and a weekly row for that is a
    -- column of noughts and ones that rounds away the thing being measured.
    period_start TEXT NOT NULL,
    period_days INTEGER NOT NULL DEFAULT 28,
    open_first_visit_slots INTEGER NOT NULL,
    -- When the scheduling system last told us. NOT when we wrote the row.
    --
    -- A CALENDAR DATE, with no time of day. A feed reports on a day; the hour
    -- is invented precision, and the seed guard is right to reject a
    -- fabricated timestamp that does not pin its own clock.
    as_of TEXT NOT NULL,
    source_system TEXT NOT NULL DEFAULT 'demo-scheduling',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (tenant_id, period_start)
  );
  CREATE INDEX IF NOT EXISTS idx_capacity_slots_region
    ON capacity_slots(census_region, period_start);

  -- ── Staffed review coverage (handoff 07 §3.4, p34) ───────────────────────
  --
  -- How many fixed review events the staffed rota can absorb in a week, and
  -- whether a coverage schedule exists at all. p34's SAFETY_REVIEW_LOAD
  -- produces nothing without both — "event classification or coverage schedule
  -- missing" — and until now the second was always missing.
  --
  -- Capacity is stated in EVENTS rather than in hours. Hours would need a
  -- minutes-per-review assumption to be useful, and an assumption buried in a
  -- unit conversion is an assumption nobody reviews. Same four-week period as
  -- the slot feed, so the two can be read side by side.
  CREATE TABLE IF NOT EXISTS review_coverage (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    census_region TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_days INTEGER NOT NULL DEFAULT 28,
    staffed_review_capacity INTEGER NOT NULL,
    -- The rota this capacity assumes. p32 requires the coverage schedule
    -- displayed beside time-to-review, and this is where that string comes
    -- from rather than from a constant in the metric.
    coverage_schedule TEXT NOT NULL DEFAULT 'business hours, weekdays',
    as_of TEXT NOT NULL,
    source_system TEXT NOT NULL DEFAULT 'demo-rota',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (tenant_id, period_start)
  );
  CREATE INDEX IF NOT EXISTS idx_review_coverage_region
    ON review_coverage(census_region, period_start);

  -- ── Planning policy thresholds (handoff 07 §3.4, p34) ────────────────────
  --
  -- p34 prints seven rules with numbers beside them, and then prints the
  -- sentence that decides where those numbers are allowed to live:
  --
  --   THRESHOLDS SHOWN HERE ARE PRODUCT DEFAULTS FOR TESTING, NOT VALIDATED
  --   CLINICAL CUTOFFS. STORE EVERY THRESHOLD IN POLICY CONFIGURATION, ATTACH
  --   ITS OWNER AND APPROVAL DATE, AND PREVENT QUIET EDITS.
  --
  -- A constant in a rules file satisfies none of that. It has no owner, no
  -- approval date, and moving 10 to 8 is a one-character diff that reads like
  -- a tuning adjustment — which is precisely the edit this table exists to
  -- make impossible to make quietly.
  --
  -- APPEND-ONLY, enforced by triggers rather than by convention. A changed
  -- threshold is a new version row; the old row stays readable, so a signal
  -- raised last month can still be read against the number that was actually
  -- in force when it fired. The only column an UPDATE may touch is
  -- superseded_at, and a DELETE is refused outright.
  CREATE TABLE IF NOT EXISTS policy_thresholds (
    key TEXT NOT NULL,
    version TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    value REAL NOT NULL,
    unit TEXT NOT NULL,
    -- A person, by name. p34 says "attach its owner"; a foreign key to users
    -- would tie the record to an account that can be deactivated or renamed,
    -- and the durability of the accountability is the whole point.
    owner TEXT NOT NULL,
    approved_at TEXT NOT NULL,
    -- What the number is and is not, stored beside it, so a reader who never
    -- opens p34 still gets p34's caveat.
    basis TEXT NOT NULL,
    superseded_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (key, version)
  );
  CREATE TRIGGER IF NOT EXISTS policy_thresholds_no_quiet_edit
    BEFORE UPDATE OF key, version, rule_id, value, unit, owner, approved_at, basis
    ON policy_thresholds
  BEGIN
    SELECT RAISE(ABORT, 'policy_thresholds is append-only: supersede the row and insert a new version');
  END;
  CREATE TRIGGER IF NOT EXISTS policy_thresholds_no_delete
    BEFORE DELETE ON policy_thresholds
  BEGIN
    SELECT RAISE(ABORT, 'policy_thresholds is append-only: a threshold is superseded, never deleted');
  END;

  -- ── Planning signals (handoff 07 §3.5 p35, §5.4 p49) ─────────────────────
  --
  -- An aggregate hypothesis about a COHORT. There is no person_id column here
  -- and there is not going to be one: p46 gives the planning rule engine
  -- "versioned aggregate triggers and signal lifecycle" and explicitly denies
  -- it "safety gates or person routing", and p35 closes with the rule that
  -- makes the lifecycle safe to build at all — no state transition changes a
  -- patient's permitted activity.
  --
  -- The evidence is FROZEN at detection. Re-running detection does not
  -- overwrite a row: a reviewer who advanced a signal did so against numbers
  -- they read, and silently refreshing those numbers underneath them attaches
  -- a human judgement to evidence nobody saw. A later reading that disagrees
  -- is a new signal, which is also why the id is derived from the rule, the
  -- cohort and the dataset version rather than from the clock.
  CREATE TABLE IF NOT EXISTS planning_signals (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    signal_type TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'draft'
      CHECK (state IN ('draft','analysis_requested','clinical_review','fairness_review',
                       'pilot_proposed','pilot_active','decision_recorded','retired')),
    rule_version TEXT NOT NULL,
    -- p36's release ladder level. 1 is descriptive, and every rule in this
    -- build produces level 1 — the permitted wording follows from it.
    evidence_level INTEGER NOT NULL DEFAULT 1,
    statement TEXT NOT NULL,
    cohort_ref TEXT NOT NULL,
    cohort_hash TEXT NOT NULL,
    reference_ref TEXT NOT NULL,
    threshold_json TEXT NOT NULL DEFAULT '{}',
    observed_json TEXT NOT NULL DEFAULT '{}',
    metric_refs_json TEXT NOT NULL DEFAULT '[]',
    limitations_json TEXT NOT NULL DEFAULT '[]',
    -- Set when a state that p35 gives an entry condition is reached, so the
    -- signal object can report a review as done rather than merely passed.
    clinical_review_json TEXT,
    fairness_review_json TEXT,
    detected_at TEXT NOT NULL,
    data_version TEXT NOT NULL,
    -- WHICH READING POINT PRODUCED THIS. Null when the demo clock was live.
    --
    -- Without it, a detection run at the half-year milestone and one run today
    -- collide: the id derives from rule, cohort, dataset and tenant, the
    -- insert is conflict-do-nothing, and the evidence is frozen — so whichever
    -- ran first wins and its numbers sit on the list looking current forever.
    -- A presenter who walked the clock forward and came back would be shown
    -- March's findings labelled as today's.
    --
    -- "What the console said at the half year" is a different artefact from
    -- "what it says now", so it gets a different id and says which it is.
    reading_point TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_planning_signals_tenant
    ON planning_signals(tenant_id, state);

  -- Every state change, with who made it and what they said. p44's audit row
  -- is "every view, comment, state change and export" — the hash-chained
  -- audit_log holds all four, and this table holds the state changes a second
  -- time as queryable history, because a signal's own screen has to show its
  -- trail without granting a reader the audit log.
  CREATE TABLE IF NOT EXISTS planning_signal_reviews (
    id TEXT PRIMARY KEY,
    signal_id TEXT NOT NULL REFERENCES planning_signals(id),
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    action TEXT NOT NULL,
    -- The reviewer. NOT the subject: a planning signal has no subject, it has
    -- a cohort. This column is the accountability record for the transition.
    actor_id TEXT NOT NULL REFERENCES users(id),
    actor_role TEXT NOT NULL,
    comment TEXT,
    -- p35: a clinical reviewer "comments and sets limits". The limits are a
    -- separate field because they outlive the comment thread and constrain
    -- what a later pilot may do.
    limits TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_planning_signal_reviews_signal
    ON planning_signal_reviews(signal_id, created_at);

  CREATE INDEX IF NOT EXISTS idx_levents_type ON longitudinal_events(event_type, id);
  CREATE INDEX IF NOT EXISTS idx_levents_correlation ON longitudinal_events(correlation_id);
  `);

  // Columns added after initial release; SQLite has no ADD COLUMN IF NOT EXISTS.
  ensureColumn(db, "checkins", "triggers_json", "TEXT NOT NULL DEFAULT '[]'");
  // Date of birth for the 18+ gate at account creation (compliance 4A.7).
  ensureColumn(db, "users", "dob", "TEXT");
  // Clinician override: a specialist may open a gated module ahead of the
  // program's pacing (prerequisites + readiness). Daily safety gates still hold.
  ensureColumn(db, "module_unlocks", "override", "INTEGER NOT NULL DEFAULT 0");
  // Tamper-evident audit chain: each row carries the hash of the previous row
  // and its own content hash, so retroactive edits/deletions are detectable
  // (see audit.ts verifyAuditChain).
  ensureColumn(db, "audit_log", "prev_hash", "TEXT");
  ensureColumn(db, "audit_log", "entry_hash", "TEXT");
  // Session revocation epoch: bumping it invalidates every issued token for the
  // user ("sign out everywhere" / password change). See auth.ts.
  ensureColumn(db, "users", "token_epoch", "INTEGER NOT NULL DEFAULT 0");

  // ── The fabricated/real boundary ─────────────────────────────────────────
  //
  // ALTER TABLE cannot add a NOT NULL column without a default, and neither
  // default is safe here (see the persons table above), so the column is added
  // nullable and the requirement is enforced by trigger instead. That is not a
  // compromise: a trigger can say WHY it refused, and a CHECK cannot.
  ensureColumn(db, "persons", "provenance", "TEXT");
  backfillProvenance(db);
  installProvenanceGuards(db);

  // ── The six demo roles (handoff 07 §1.2, p6) ─────────────────────────────
  //
  // `admin` is retired. In this codebase it meant the AGGREGATE reporting role
  // — it read a population and could reach no person — and it served the
  // organization AND payer consoles from one account. Handoff 07 needs those
  // separated, and uses "Demo Admin" for something close to the opposite:
  // visibility over every fabricated tenant, person and event.
  //
  // Keeping the name would have left the most dangerous ambiguity in the
  // project sitting in a CHECK constraint, so it goes. Existing `admin` rows
  // become `organization`, which is what the one seeded account actually was.
  widenRoleCheck(db);

  // ── Tenancy backfill (ADR 0011 steps 1–2) ────────────────────────────────
  // Every durable record carries a tenant, not just the ones where it seems
  // relevant — so isolation is a single invariant rather than a per-table
  // judgement call. Existing rows default to the platform tenant, which makes
  // this a non-breaking additive change.
  for (const table of TENANT_SCOPED_TABLES) {
    ensureColumn(db, table, "tenant_id", `TEXT NOT NULL DEFAULT '${PLATFORM_TENANT_ID}'`);
  }
  backfillIdentitySpine(db);
}

/**
 * Give every existing person a provenance, ONCE.
 *
 * A one-time inference for rows written before the column existed, and the
 * reasoning is stated here rather than left to be reconstructed: every
 * environment this code has ever run in is a demonstration environment, in
 * which every person is fabricated. Outside one, nothing was seeded and the
 * only persons present came through signup, so they are real.
 *
 * This is the only place the environment is allowed to decide a person's
 * provenance. Every row written after this states it at the insert, because by
 * then somebody knows the answer and the environment is a poor proxy for it —
 * the whole point of the column is that a demonstration environment is about
 * to contain both.
 */
function backfillProvenance(db: Database.Database) {
  const pending = db.prepare(
    "SELECT COUNT(*) AS n FROM persons WHERE provenance IS NULL").get() as { n: number };
  if (pending.n === 0) return;
  const inferred = process.env.EMDR_DEMO === "1" ? "fabricated" : "real";
  db.prepare("UPDATE persons SET provenance = ? WHERE provenance IS NULL").run(inferred);
}

/**
 * Make contamination impossible at the write, rather than detectable at the
 * read.
 *
 * Three triggers, each refusing one way the boundary can be crossed:
 *
 *   A PERSON MUST STATE WHICH THEY ARE. No default, so a writer that has not
 *   thought about it fails loudly at the insert instead of quietly at the
 *   first metric.
 *
 *   A PERSON DOES NOT BECOME REAL. Provenance is immutable. Allowing an update
 *   would mean a fabricated cohort could be relabelled after the fact and its
 *   history would join a real denominator — which is precisely the thing this
 *   exists to prevent, done deliberately.
 *
 *   A REAL PERSON CANNOT RECEIVE A FABRICATED EVENT. The direction that
 *   matters: a synthetic agent writing into a real participant's ledger. The
 *   reverse — a fabricated person with an unmarked event — is a labelling gap
 *   rather than contamination, and p29's manifest already counts it.
 */
function installProvenanceGuards(db: Database.Database) {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS persons_provenance_required
      BEFORE INSERT ON persons
      WHEN NEW.provenance IS NULL OR NEW.provenance NOT IN ('fabricated', 'real')
    BEGIN
      SELECT RAISE(ABORT, 'persons.provenance must be stated as fabricated or real at the insert');
    END;

    CREATE TRIGGER IF NOT EXISTS persons_provenance_immutable
      BEFORE UPDATE OF provenance ON persons
      WHEN OLD.provenance IS NOT NULL AND NEW.provenance IS NOT OLD.provenance
    BEGIN
      SELECT RAISE(ABORT, 'a person does not become real: provenance is immutable once stated');
    END;

    CREATE TRIGGER IF NOT EXISTS events_no_fabricated_into_real
      BEFORE INSERT ON longitudinal_events
      WHEN json_extract(NEW.provenance, '$.fabricated') = 1
       AND (SELECT provenance FROM persons WHERE id = NEW.person_id) = 'real'
    BEGIN
      SELECT RAISE(ABORT, 'a fabricated event cannot be written into a real person''s ledger');
    END;
  `);
}

/** The reserved platform tenant. Direct-to-consumer records live here so the
 *  tenant column is never null and every query path is uniform. */
export const PLATFORM_TENANT_ID = NIL_ULID;

/** Every table holding durable, person-scoped data. A test asserts this list
 *  matches the schema, so a new table cannot silently escape tenant scoping
 *  (ADR 0011 §4). */
export const TENANT_SCOPED_TABLES = [
  "users", "consents", "screenings", "checkins", "therapy_sessions",
  "post_session_checks", "module_unlocks", "alerts", "user_profiles",
  "user_triggers", "early_warning_signs", "readiness_assessments",
  "safety_plans", "ai_companion_preferences", "ai_memory_items",
  "ai_conversations", "ai_messages", "subscriptions", "payments",
  "program_plans", "care_tracks", "care_track_intake", "practice_completions",
  "upsell_events", "autopilot_plans", "autopilot_events", "lesson_reads",
  "review_notes", "screening_progress",
  // An export names the person who asked for it. It is a disclosure record
  // rather than care data, but it is scoped to exactly one tenant and reading
  // another's would show their cohorts, filters and stated purposes.
  "export_jobs",
  // Demographic attributes are the most sensitive person-scoped table in the
  // schema. p13 permits them for representation, disparity and access audit
  // only, and a query that forgets the tenant reads another organization's.
  "person_attributes",
  // Claims are person-scoped: a claim belongs to one covered life, and a query
  // that forgets the tenant reads another plan's members. It carries tenant_id
  // from creation rather than by backfill, but it belongs on this list so the
  // repository's scoping applies and the schema guard keeps counting it.
  "claims",
  // A planning signal is about a cohort, not a person — but the cohort belongs
  // to one tenant, and reading another's would show which groups they are
  // comparing and what they suspect. Scoped for that reason rather than for
  // the usual one.
  "planning_signals",
  // The reviewer named on a state change is a person, so this table is
  // person-scoped by the schema guard's rule (it references users) even though
  // its subject is not.
  "planning_signal_reviews",
  // Operational feeds. Not person-scoped — a slot is not anybody's — but
  // scoped to one organization, and reading another's would show their
  // staffing and their backlog.
  "capacity_slots",
  "review_coverage",
] as const;

/** Create the platform tenant and mirror `users` onto the identity spine
 *  (ADR 0011 steps 3–4).
 *
 *  `persons.id` is deliberately set equal to `users.id`. Every existing
 *  `user_id` foreign key is therefore already a valid `person_id`, which turns
 *  the ADR's step 5 ("repoint foreign keys") from a data migration into a
 *  rename. Accounts get their own ULID because a person may later hold more
 *  than one, or none.
 *
 *  Idempotent: safe to call any time to reconcile users created since the last
 *  run. Exported as `syncIdentitySpine` for that purpose — identity dual-write
 *  at the signup path is a later migration step. */
export function syncIdentitySpine(db?: Database.Database) {
  backfillIdentitySpine(db ?? getDb());
}

function backfillIdentitySpine(db: Database.Database) {
  db.prepare(
    `INSERT INTO tenants (id, kind, name) VALUES (?, 'platform', 'Steady Platform')
     ON CONFLICT(id) DO NOTHING`
  ).run(PLATFORM_TENANT_ID);

  const users = db
    .prepare("SELECT id, email, name, role, password_hash, status, token_epoch FROM users")
    .all() as {
      id: string; email: string; name: string; role: string;
      password_hash: string; status: string; token_epoch: number;
    }[];
  if (users.length === 0) return;

  const insPerson = db.prepare(
    // Reconstructing rows whose provenance nobody recorded, so the same
    // one-time inference `backfillProvenance` uses applies: this path exists
    // to mirror pre-existing `users` onto the spine, and every user that
    // predates the column came from a seed in a demonstration environment or
    // from a signup outside one. New persons do not come through here — the
    // signup path calls `provisionPerson`, which states 'real' at the insert.
    `INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  );
  const insAccount = db.prepare(
    `INSERT INTO accounts (id, person_id, tenant_id, email, password_hash, status, token_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING`
  );
  const insRole = db.prepare(
    `INSERT INTO role_assignments (id, person_id, tenant_id, role) VALUES (?, ?, ?, ?)
     ON CONFLICT(person_id, tenant_id, role) DO NOTHING`
  );

  db.transaction(() => {
    for (const u of users) {
      insPerson.run(u.id, PLATFORM_TENANT_ID, u.name,
        process.env.EMDR_DEMO === "1" ? "fabricated" : "real");
      // Derived, not random: the account and role rows for a given user are
      // reconstructions of facts that already exist, so re-running the backfill
      // — or resetting a demo environment — must produce the same ids. A random
      // ULID here made the seeded dataset unreproducible and its baseline hash
      // meaningless. `ulidFrom` keeps them time-ordered and idempotent, the
      // same construction the genesis backfill uses (ADR 0010 step 3).
      insAccount.run(
        ulidFrom(0, `accounts:${u.id}`), u.id, PLATFORM_TENANT_ID, u.email,
        u.password_hash, u.status ?? "active", u.token_epoch ?? 0
      );
      insRole.run(ulidFrom(0, `role_assignments:${u.id}:${u.role}`), u.id, PLATFORM_TENANT_ID, u.role);
    }
  })();
}

/**
 * Widen the role CHECK constraints, and migrate `admin` rows.
 *
 * SQLite cannot alter a CHECK constraint, so this is the documented twelve-step
 * table rebuild, narrowed to what is needed. It runs only when the stored
 * schema does not already mention a new role, so it is a no-op on every boot
 * after the first.
 *
 * Foreign keys are disabled around it because `users` is referenced by roughly
 * thirty tables and the swap would otherwise be rejected mid-flight. The
 * pragma cannot be changed inside a transaction, which is why the ordering
 * below is exact rather than tidy: pragma off, transaction, rebuild, verify,
 * commit, pragma on. `foreign_key_check` inside the transaction is what makes
 * the disabling safe — a rebuild that orphaned a row fails here rather than
 * silently.
 */
function widenRoleCheck(db: Database.Database) {
  const sqlOf = (t: string): string => {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?").get(t) as
      | { sql: string } | undefined;
    return row?.sql ?? "";
  };
  // "demo_admin" appears only in the widened constraint. Its presence is the
  // migration's own idempotence check.
  const usersStale = sqlOf("users") !== "" && !sqlOf("users").includes("demo_admin");
  const rolesStale = sqlOf("role_assignments") !== "" && !sqlOf("role_assignments").includes("demo_admin");
  if (!usersStale && !rolesStale) return;

  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      if (usersStale) {
        const cols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[])
          .map((c) => c.name);
        db.exec(`
          CREATE TABLE users_rebuild (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('member','clinician','reviewer','organization','payer','demo_admin')),
            password_hash TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            dob TEXT,
            token_epoch INTEGER NOT NULL DEFAULT 0,
            tenant_id TEXT NOT NULL DEFAULT '${PLATFORM_TENANT_ID}'
          );
        `);
        // Copy only the columns that exist on both sides, so a database from
        // before any given ensureColumn still migrates.
        const shared = ["id", "email", "name", "role", "password_hash", "status",
                        "created_at", "dob", "token_epoch", "tenant_id"]
          .filter((c) => cols.includes(c));
        // The role rewrite happens here, in the copy, rather than as a later
        // UPDATE — an UPDATE would have to run against the NEW constraint,
        // which no longer admits the value it is trying to read.
        const select = shared
          .map((c) => (c === "role" ? "CASE role WHEN 'admin' THEN 'organization' ELSE role END AS role" : c))
          .join(", ");
        db.exec(`INSERT INTO users_rebuild (${shared.join(", ")}) SELECT ${select} FROM users`);
        db.exec("DROP TABLE users");
        db.exec("ALTER TABLE users_rebuild RENAME TO users");
      }

      if (rolesStale) {
        db.exec(`
          CREATE TABLE role_assignments_rebuild (
            id TEXT PRIMARY KEY,
            person_id TEXT NOT NULL REFERENCES persons(id),
            tenant_id TEXT NOT NULL REFERENCES tenants(id),
            role TEXT NOT NULL CHECK (role IN ('member','clinician','care_manager','reviewer','organization','payer','demo_admin')),
            scope TEXT,
            effective_from TEXT NOT NULL DEFAULT (datetime('now')),
            effective_to TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(person_id, tenant_id, role)
          );
          INSERT INTO role_assignments_rebuild
            (id, person_id, tenant_id, role, scope, effective_from, effective_to, created_at)
            SELECT id, person_id, tenant_id,
                   CASE role WHEN 'admin' THEN 'organization' ELSE role END,
                   scope, effective_from, effective_to, created_at
              FROM role_assignments;
          DROP TABLE role_assignments;
          ALTER TABLE role_assignments_rebuild RENAME TO role_assignments;
          CREATE INDEX IF NOT EXISTS idx_role_assignments_person ON role_assignments(person_id, tenant_id);
        `);
      }

      const broken = db.pragma("foreign_key_check") as unknown[];
      if (broken.length > 0) {
        // Thrown inside the transaction, so the rebuild rolls back whole. A
        // half-migrated role table is worse than an un-migrated one.
        throw new Error(
          `role migration would orphan ${broken.length} row(s); rolled back`,
        );
      }
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function ensureColumn(db: Database.Database, table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

export function newId(): string {
  return crypto.randomUUID();
}

// Demo accounts for local development only. Production requires a real
// identity provider with AAL2 MFA for all roles (see executive plan).
// With EMDR_DEMO=1, a rich fictional dataset is seeded instead so demo
// deployments are interesting on first login.
/** Unconditionally (re)seed the demo dataset and give it a current check-in.
 *
 *  `seed()` below returns early when users exist, which is right for boot and
 *  wrong for a reset — a reset has just emptied the database and must rebuild
 *  it through the same path a fresh environment uses, so the two can never
 *  drift into producing subtly different datasets. */
export function seedDemo(db: Database.Database) {
  db.transaction(() => {
    seedDemoData(db);
    seedOrgData(db);
    seedPayerData(db);
    seedPopulationData(db);
    seedOperationalFeeds(db);
    generatePopulationHistory(db);
    // The reserved tail, LIVED rather than written: the last fortnight of
    // every person's history goes through the check-in routing rule and the
    // safety gate engine, so the window every metric and every planning rule
    // reads is one the engine actually saw.
    runAgents(db);
    bindAggregateAccounts(db);
  })();
  refreshDemoDaily(db);
}

/**
 * Bind the two aggregate accounts to the tenants they report on.
 *
 * This has to run AFTER the org and payer seeds, because it points at tenants
 * they create — which is why it is a third step rather than a column set at
 * insert time.
 *
 * It exists so scope stops being inferred. `resolveOrgTenant()` used to count
 * tenants and return the single organization-kind one, failing closed when
 * there was not exactly one. That worked for as long as there was exactly one,
 * and broke the moment the payer seed added a second — every organization
 * screen would have rendered "no organization in scope". It was patched by
 * excluding tenants that hold a payer contract, which is a second inference
 * standing on the first, and it would break again the moment handoff 07's Wave
 * 2 adds eight demo organizations.
 *
 * An account belongs to a tenant. That is a fact worth storing rather than
 * deducing, and §30.6 step 1 says to resolve it before anything else.
 */
function bindAggregateAccounts(db: Database.Database) {
  // Computed HERE, not at module load. A top-level `const NE_NETWORK_A =
  // orgTenantId("NE", "A")` forced demo-population-seed to finish evaluating
  // during this module's own evaluation — and that module imports
  // PLATFORM_TENANT_ID back from here, so the cycle resolved with one side
  // still undefined. It surfaced as "cannot read DATASET_VERSION of
  // undefined" in an unrelated test file, which is how import cycles always
  // announce themselves.
  const neNetworkA = orgTenantId("NE", "A");
  const bind = db.prepare("UPDATE users SET tenant_id = ? WHERE email = ? AND role = ?");
  bind.run(ORG_TENANT_ID, "org.demo@steady.local", "organization");
  bind.run(PAYER_TENANT_ID, "payer.demo@steady.local", "payer");
  // The network operator reports on a demo care network rather than on
  // Northside — the two organization populations are separate by design (the
  // 4,820 have no names; the 240 do), and one account cannot see both.
  bind.run(neNetworkA, "network.demo@steady.local", "organization");
  // The identity spine mirrors users onto persons, so the person row has to
  // move with the account or the two disagree about which tenant it is in.
  const bindPerson = db.prepare(
    "UPDATE persons SET tenant_id = ? WHERE id = (SELECT id FROM users WHERE email = ?)",
  );
  bindPerson.run(ORG_TENANT_ID, "org.demo@steady.local");
  bindPerson.run(PAYER_TENANT_ID, "payer.demo@steady.local");
  bindPerson.run(neNetworkA, "network.demo@steady.local");
}

function seed(db: Database.Database) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (count.n > 0) return;
  // Transactional so a failure can never leave a half-seeded database.
  db.transaction(() => {
    if (process.env.EMDR_DEMO === "1") {
      seedDemoData(db);
      seedOrgData(db);
      seedPayerData(db);
      seedPopulationData(db);
      seedOperationalFeeds(db);
      generatePopulationHistory(db);
      // The reserved tail, LIVED rather than written.
      runAgents(db);
      bindAggregateAccounts(db);
      return;
    }
    const insert = db.prepare(
      "INSERT INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)"
    );
    const memberId = newId();
    insert.run(memberId, "patient.demo@steady.local", "Demo Member", "member", hashPassword(demoPassword("member")));
    insert.run(newId(), "clinician.demo@steady.local", "Dr. Demo Clinician", "clinician", hashPassword(demoPassword("clinician")));
    // Dev member gets an active membership so local flows skip checkout.
    db.prepare(
      `INSERT INTO subscriptions (user_id, plan, status, price_cents, currency, provider, current_period_end)
       VALUES (?, 'monthly', 'active', 3499, 'usd', 'demo', datetime('now', '+1 month'))`
    ).run(memberId);
  })();
}
