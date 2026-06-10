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

  CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_screenings_user ON screenings(user_id, created_at);
  `);
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
    insert.run(newId(), "demo@example.com", "Demo Member", "member", hashPassword("demo1234"));
    insert.run(newId(), "clinician@example.com", "Dr. Demo Clinician", "clinician", hashPassword("demo1234"));
  })();
}
