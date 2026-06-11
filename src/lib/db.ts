import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { seedDemoData } from "./demo-seed";

const DATA_DIR = process.env.EMDR_DATA_DIR ?? path.join(process.cwd(), ".data");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(path.join(DATA_DIR, "emdr.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seed(db);
  return db;
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

  CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at);

  CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_screenings_user ON screenings(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_triggers_user ON user_triggers(user_id, active);
  CREATE INDEX IF NOT EXISTS idx_readiness_user ON readiness_assessments(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_memory_user ON ai_memory_items(user_id, memory_type, active);
  CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id, created_at);
  `);

  // Columns added after initial release; SQLite has no ADD COLUMN IF NOT EXISTS.
  ensureColumn(db, "checkins", "triggers_json", "TEXT NOT NULL DEFAULT '[]'");
  // Date of birth for the 18+ gate at account creation (compliance 4A.7).
  ensureColumn(db, "users", "dob", "TEXT");
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
function seed(db: Database.Database) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (count.n > 0) return;
  // Transactional so a failure can never leave a half-seeded database.
  db.transaction(() => {
    if (process.env.EMDR_DEMO === "1") {
      seedDemoData(db);
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
       VALUES (?, 'monthly', 'active', 2499, 'usd', 'demo', datetime('now', '+1 month'))`
    ).run(memberId);
  })();
}
