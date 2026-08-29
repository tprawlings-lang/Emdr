import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { seedDemoData, demoId } from "./demo-seed";
import { seedOrgData } from "./demo-org-seed";
import { seedPayerData } from "./demo-payer-seed";
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
  for (const email of ["demo@example.com", "demo2@example.com"]) {
    const m = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | undefined;
    if (!m) continue;
    const has = db.prepare("SELECT 1 FROM checkins WHERE user_id = ? AND checkin_date = ?").get(m.id, today);
    if (has) continue;
    db.prepare(
      `INSERT INTO checkins (id, user_id, checkin_date, activation, shutdown, harm_urge, feels_safe,
         dissociation, sleep_quality, substance_flag, recommended_action)
       VALUES (?, ?, ?, 3, 1, 0, 1, 1, 6, 0, 'processing_ok')`
      // Deterministic per member per day, so a reset reproduces it and a
      // second boot on the same day cannot create a duplicate.
    ).run(demoId(0, `checkin:${m.id}:${today}`), m.id, today);
  }
}

function migrate(db: Database.Database) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('member','clinician','admin')),
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
    role TEXT NOT NULL CHECK (role IN ('member','clinician','care_manager','admin')),
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
  // Claims are person-scoped: a claim belongs to one covered life, and a query
  // that forgets the tenant reads another plan's members. It carries tenant_id
  // from creation rather than by backfill, but it belongs on this list so the
  // repository's scoping applies and the schema guard keeps counting it.
  "claims",
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
    `INSERT INTO persons (id, tenant_id, display_name) VALUES (?, ?, ?)
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
      insPerson.run(u.id, PLATFORM_TENANT_ID, u.name);
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
  db.transaction(() => { seedDemoData(db); seedOrgData(db); seedPayerData(db); })();
  refreshDemoDaily(db);
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
      return;
    }
    const insert = db.prepare(
      "INSERT INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)"
    );
    const memberId = newId();
    insert.run(memberId, "demo@example.com", "Demo Member", "member", hashPassword("demo1234"));
    insert.run(newId(), "clinician@example.com", "Dr. Demo Clinician", "clinician", hashPassword("demo1234"));
    // Dev member gets an active membership so local flows skip checkout.
    db.prepare(
      `INSERT INTO subscriptions (user_id, plan, status, price_cents, currency, provider, current_period_end)
       VALUES (?, 'monthly', 'active', 3499, 'usd', 'demo', datetime('now', '+1 month'))`
    ).run(memberId);
  })();
}
