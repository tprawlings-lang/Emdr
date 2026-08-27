-- Postgres schema for Steady (migration from SQLite — ADR 0007 step 1).
--
-- Timestamps are kept as text in SQLite's 'YYYY-MM-DD HH:MM:SS' UTC format via
-- the steady_now() helper, so the application's existing string-based date
-- handling and lexical comparisons keep working unchanged during the migration.
-- Booleans stay integer 0/1 for the same reason. Only the storage engine
-- changes; the data shapes the app reads do not.

CREATE OR REPLACE FUNCTION steady_now() RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')
$$;

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('member','clinician','admin')),
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  dob text,
  token_epoch integer NOT NULL DEFAULT 0,
  created_at text NOT NULL DEFAULT steady_now()
);

CREATE TABLE IF NOT EXISTS consents (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  policy_version text NOT NULL,
  scope text NOT NULL,
  granted_at text NOT NULL DEFAULT steady_now(),
  revoked_at text
);

CREATE TABLE IF NOT EXISTS screenings (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  instrument text NOT NULL,
  instrument_version text NOT NULL,
  total_score integer NOT NULL,
  answers_json text NOT NULL,
  risk_flags_json text NOT NULL DEFAULT '[]',
  created_at text NOT NULL DEFAULT steady_now()
);

CREATE TABLE IF NOT EXISTS checkins (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  checkin_date text NOT NULL,
  activation integer NOT NULL,
  shutdown integer NOT NULL,
  harm_urge integer NOT NULL,
  feels_safe integer NOT NULL,
  dissociation integer NOT NULL,
  sleep_quality integer NOT NULL,
  substance_flag integer NOT NULL,
  recommended_action text NOT NULL,
  triggers_json text NOT NULL DEFAULT '[]',
  created_at text NOT NULL DEFAULT steady_now(),
  UNIQUE (user_id, checkin_date)
);

CREATE TABLE IF NOT EXISTS therapy_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  module_id text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress','completed','hard_stop','abandoned')),
  pre_suds integer,
  post_suds integer,
  peak_suds integer,
  hard_stop_reason text,
  detail_json text NOT NULL DEFAULT '{}',
  started_at text NOT NULL DEFAULT steady_now(),
  ended_at text
);

CREATE TABLE IF NOT EXISTS post_session_checks (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES therapy_sessions(id),
  user_id text NOT NULL REFERENCES users(id),
  distress integer NOT NULL,
  oriented integer NOT NULL,
  safe_tonight integer NOT NULL,
  delayed_risk integer NOT NULL,
  recovery_confirmed integer NOT NULL,
  escalated integer NOT NULL DEFAULT 0,
  created_at text NOT NULL DEFAULT steady_now()
);

CREATE TABLE IF NOT EXISTS module_unlocks (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  module_id text NOT NULL,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','unlocked','denied','revoked')),
  member_note text,
  clinician_id text REFERENCES users(id),
  decision_reason text,
  override integer NOT NULL DEFAULT 0,
  requested_at text NOT NULL DEFAULT steady_now(),
  decided_at text,
  UNIQUE (user_id, module_id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  alert_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('urgent','high','moderate','info')),
  detail text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed')),
  reviewed_by text REFERENCES users(id),
  review_note text,
  created_at text NOT NULL DEFAULT steady_now(),
  reviewed_at text
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id text,
  actor_role text,
  event_family text NOT NULL,
  event_type text NOT NULL,
  target text,
  detail_json text NOT NULL DEFAULT '{}',
  prev_hash text,
  entry_hash text,
  created_at text NOT NULL DEFAULT steady_now()
);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id text PRIMARY KEY REFERENCES users(id),
  therapist_status text,
  emdr_experience text,
  goals_json text NOT NULL DEFAULT '[]',
  trauma_areas_json text NOT NULL DEFAULT '[]',
  restricted_topics_json text NOT NULL DEFAULT '[]',
  profile_complete integer NOT NULL DEFAULT 0,
  created_at text NOT NULL DEFAULT steady_now(),
  updated_at text NOT NULL DEFAULT steady_now()
);

CREATE TABLE IF NOT EXISTS user_triggers (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  trigger_name text NOT NULL,
  trigger_category text NOT NULL,
  intensity_score integer,
  common_responses_json text NOT NULL DEFAULT '[]',
  notes text,
  active integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT steady_now(),
  updated_at text NOT NULL DEFAULT steady_now(),
  UNIQUE (user_id, trigger_name)
);

CREATE TABLE IF NOT EXISTS early_warning_signs (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  sign_name text NOT NULL,
  active integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT steady_now(),
  UNIQUE (user_id, sign_name)
);

CREATE TABLE IF NOT EXISTS readiness_assessments (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  stability_score integer NOT NULL,
  body_safety_score integer NOT NULL,
  present_connection_score integer NOT NULL,
  symptom_intensity_score integer NOT NULL,
  sleep_quality text NOT NULL,
  support_available text NOT NULL,
  processing_readiness text NOT NULL,
  pause_capacity text NOT NULL,
  pace_preference text,
  risk_flag text NOT NULL DEFAULT 'none',
  calculated_readiness_score integer NOT NULL,
  recommended_track text NOT NULL,
  source text NOT NULL DEFAULT 'onboarding',
  created_at text NOT NULL DEFAULT steady_now()
);

CREATE TABLE IF NOT EXISTS safety_plans (
  user_id text PRIMARY KEY REFERENCES users(id),
  grounding_tools_json text NOT NULL DEFAULT '[]',
  support_contact_name text,
  support_contact_method text,
  reminder_phrase text,
  stop_signs text,
  careful_topics text,
  created_at text NOT NULL DEFAULT steady_now(),
  updated_at text NOT NULL DEFAULT steady_now()
);

CREATE TABLE IF NOT EXISTS ai_companion_preferences (
  user_id text PRIMARY KEY REFERENCES users(id),
  preferred_user_name text,
  tone text NOT NULL DEFAULT 'gentle',
  support_modes_json text NOT NULL DEFAULT '[]',
  avoidances_json text NOT NULL DEFAULT '[]',
  memory_enabled text NOT NULL DEFAULT 'yes',
  created_at text NOT NULL DEFAULT steady_now(),
  updated_at text NOT NULL DEFAULT steady_now()
);

CREATE TABLE IF NOT EXISTS ai_memory_items (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  memory_type text NOT NULL,
  memory_key text NOT NULL,
  memory_value text NOT NULL,
  source_type text NOT NULL,
  source_id text,
  active integer NOT NULL DEFAULT 1,
  created_at text NOT NULL DEFAULT steady_now(),
  updated_at text NOT NULL DEFAULT steady_now()
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  context_type text NOT NULL DEFAULT 'general',
  risk_level text NOT NULL DEFAULT 'none',
  started_at text NOT NULL DEFAULT steady_now(),
  ended_at text
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES ai_conversations(id),
  user_id text NOT NULL REFERENCES users(id),
  sender text NOT NULL CHECK (sender IN ('member','companion')),
  message_text text NOT NULL,
  risk_flag integer NOT NULL DEFAULT 0,
  created_at text NOT NULL DEFAULT steady_now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id text PRIMARY KEY REFERENCES users(id),
  plan text NOT NULL DEFAULT 'monthly',
  status text NOT NULL CHECK (status IN ('trialing','active','past_due','canceled')),
  price_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  provider text NOT NULL DEFAULT 'demo',
  provider_ref text,
  cancel_at_period_end integer NOT NULL DEFAULT 0,
  current_period_end text NOT NULL,
  created_at text NOT NULL DEFAULT steady_now(),
  updated_at text NOT NULL DEFAULT steady_now()
);

CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL CHECK (status IN ('succeeded','failed','refunded')),
  description text NOT NULL,
  provider text NOT NULL DEFAULT 'demo',
  created_at text NOT NULL DEFAULT steady_now()
);

CREATE TABLE IF NOT EXISTS program_plans (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  plan_json text NOT NULL,
  generated_by text NOT NULL DEFAULT 'rules',
  source text NOT NULL DEFAULT 'trigger_map',
  created_at text NOT NULL DEFAULT steady_now()
);

CREATE TABLE IF NOT EXISTS care_tracks (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  track_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at text NOT NULL DEFAULT steady_now(),
  UNIQUE (user_id, track_id)
);

CREATE TABLE IF NOT EXISTS care_track_intake (
  user_id text PRIMARY KEY REFERENCES users(id),
  goal_text text,
  tags_json text NOT NULL DEFAULT '[]',
  updated_at text NOT NULL DEFAULT steady_now()
);

CREATE INDEX IF NOT EXISTS idx_program_plans_user ON program_plans(user_id, created_at);
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
  id text PRIMARY KEY,
  rule_id text NOT NULL,
  config_version text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('agree','needs_change')),
  note text,
  clinician_id text REFERENCES users(id),
  created_at text NOT NULL DEFAULT steady_now()
);
CREATE INDEX IF NOT EXISTS idx_signoffs_rule ON autonomous_signoffs(rule_id, config_version, created_at);

-- Reviewer change requests (Phase 4 testing cycle).
--
-- reviewer_id carries NO foreign key, and tenant/name are stored rather than
-- joined: a demo reset deletes and re-seeds users, and a change request has to
-- outlive that because it is feedback about the product, not a record about a
-- person. tenant_id is stamped at write time from the reviewer's own row, so
-- the RLS policy generated below scopes it like every other tenanted table.
CREATE TABLE IF NOT EXISTS review_notes (
  id text PRIMARY KEY,
  reviewer_id text NOT NULL,
  reviewer_name text NOT NULL DEFAULT '',
  reviewer_role text NOT NULL,
  surface text NOT NULL,
  category text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('blocker','change','question','idea')),
  observed text NOT NULL,
  requested text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','actioned','declined')),
  subject_id text,
  config_version text,
  policy_version text,
  created_at text NOT NULL DEFAULT steady_now()
);
CREATE INDEX IF NOT EXISTS idx_review_notes ON review_notes(status, created_at);

-- Practice, lesson, upsell, and Autopilot tables. These were added to the
-- SQLite schema during the tiering and Autopilot work and had drifted out of
-- this file — the tenancy ALTERs below referenced tables Postgres had never
-- been told to create. Caught by executing this schema against a real cluster
-- rather than reading it.

CREATE TABLE IF NOT EXISTS practice_completions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  practice_id text NOT NULL,
  practice_type text NOT NULL,
  duration_sec integer NOT NULL DEFAULT 0,
  created_at text NOT NULL DEFAULT steady_now()
);
CREATE INDEX IF NOT EXISTS idx_practice_completions_user ON practice_completions(user_id, created_at);

CREATE TABLE IF NOT EXISTS lesson_reads (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  lesson_id text NOT NULL,
  created_at text NOT NULL DEFAULT steady_now(),
  UNIQUE(user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS upsell_events (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  created_at text NOT NULL DEFAULT steady_now()
);
CREATE INDEX IF NOT EXISTS idx_upsell_events_user ON upsell_events(user_id, created_at);

CREATE TABLE IF NOT EXISTS autopilot_plans (
  user_id text NOT NULL REFERENCES users(id),
  plan_date text NOT NULL,
  checkin_state text NOT NULL DEFAULT 'none',
  plan_json text NOT NULL,
  created_at text NOT NULL DEFAULT steady_now(),
  updated_at text NOT NULL DEFAULT steady_now(),
  PRIMARY KEY (user_id, plan_date)
);

CREATE TABLE IF NOT EXISTS autopilot_events (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  created_at text NOT NULL DEFAULT steady_now()
);
CREATE INDEX IF NOT EXISTS idx_autopilot_events_user ON autopilot_events(user_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Longitudinal spine (ADR 0010) + identity/tenancy model (ADR 0011).
-- Mirrors the SQLite definitions in src/lib/db.ts migrate(). Additive: the
-- application still reads and writes the current-state tables above.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('platform','organization','facility','program')),
  name text NOT NULL,
  parent_tenant_id text REFERENCES tenants(id),
  status text NOT NULL DEFAULT 'active',
  created_at text NOT NULL DEFAULT steady_now()
);

CREATE TABLE IF NOT EXISTS persons (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  display_name text,
  timezone text,
  locale text,
  status text NOT NULL DEFAULT 'active',
  created_at text NOT NULL DEFAULT steady_now(),
  updated_at text NOT NULL DEFAULT steady_now()
);
CREATE INDEX IF NOT EXISTS idx_persons_tenant ON persons(tenant_id);

CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES persons(id),
  tenant_id text NOT NULL REFERENCES tenants(id),
  email text NOT NULL UNIQUE,
  password_hash text,
  status text NOT NULL DEFAULT 'active',
  token_epoch integer NOT NULL DEFAULT 0,
  created_at text NOT NULL DEFAULT steady_now()
);
CREATE INDEX IF NOT EXISTS idx_accounts_person ON accounts(person_id);

CREATE TABLE IF NOT EXISTS role_assignments (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES persons(id),
  tenant_id text NOT NULL REFERENCES tenants(id),
  role text NOT NULL CHECK (role IN ('member','clinician','care_manager','admin')),
  scope text,
  effective_from text NOT NULL DEFAULT steady_now(),
  effective_to text,
  created_at text NOT NULL DEFAULT steady_now(),
  UNIQUE(person_id, tenant_id, role)
);
CREATE INDEX IF NOT EXISTS idx_role_assignments_person ON role_assignments(person_id, tenant_id);

CREATE TABLE IF NOT EXISTS enrollments (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES persons(id),
  tenant_id text NOT NULL REFERENCES tenants(id),
  program_id text,
  eligibility text,
  effective_from text NOT NULL DEFAULT steady_now(),
  effective_to text,
  created_at text NOT NULL DEFAULT steady_now()
);
CREATE INDEX IF NOT EXISTS idx_enrollments_person ON enrollments(person_id, tenant_id);

CREATE TABLE IF NOT EXISTS external_identifiers (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES persons(id),
  tenant_id text NOT NULL REFERENCES tenants(id),
  source_system text NOT NULL,
  external_id text NOT NULL,
  id_type text,
  created_at text NOT NULL DEFAULT steady_now(),
  UNIQUE(tenant_id, source_system, external_id)
);

CREATE TABLE IF NOT EXISTS longitudinal_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  person_id text NOT NULL REFERENCES persons(id),
  event_type text NOT NULL,
  payload_version integer NOT NULL DEFAULT 1,
  payload text NOT NULL DEFAULT '{}',
  actor_id text,
  actor_type text NOT NULL DEFAULT 'system'
    CHECK (actor_type IN ('patient','clinician','care_manager','system','model','integration')),
  occurred_at text NOT NULL DEFAULT steady_now(),
  recorded_at text NOT NULL DEFAULT steady_now(),
  source_system text NOT NULL DEFAULT 'steady',
  provenance text NOT NULL DEFAULT '{}',
  correlation_id text,
  supersedes_event_id text REFERENCES longitudinal_events(id)
);
CREATE INDEX IF NOT EXISTS idx_levents_person ON longitudinal_events(person_id, id);
CREATE INDEX IF NOT EXISTS idx_levents_tenant ON longitudinal_events(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_levents_type ON longitudinal_events(event_type, id);
CREATE INDEX IF NOT EXISTS idx_levents_correlation ON longitudinal_events(correlation_id);

-- Tenancy backfill (ADR 0011 steps 1-2). Postgres supports ADD COLUMN IF NOT
-- EXISTS, so this is the equivalent of ensureColumn() on the SQLite path.
-- Existing rows default to the platform tenant: non-breaking and additive.

INSERT INTO tenants (id, kind, name) VALUES ('00000000000000000000000000', 'platform', 'Steady Platform')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE consents ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE screenings ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE therapy_sessions ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE post_session_checks ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE module_unlocks ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE user_triggers ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE early_warning_signs ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE readiness_assessments ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE safety_plans ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE ai_companion_preferences ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE ai_memory_items ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE program_plans ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE care_tracks ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE care_track_intake ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE practice_completions ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE upsell_events ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE autopilot_plans ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE autopilot_events ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE lesson_reads ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE review_notes ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';

-- ---------------------------------------------------------------------------
-- Row-level security (ADR 0011 §3 — the second half of tenant isolation)
-- ---------------------------------------------------------------------------
--
-- src/lib/repository.ts enforces tenant scoping in the application layer. That
-- layer is only as good as its own correctness: one raw query that bypasses the
-- repository, or one bug inside it, is cross-tenant PHI exposure. RLS closes
-- that gap by moving the predicate into the database, where the application
-- cannot forget it.
--
-- How it fits together:
--
--   * The app connects as `steady_app` — deliberately NOT the schema owner, and
--     not a superuser, because both bypass RLS. It is created NOLOGIN here on
--     purpose: this file must not mint a passwordless login role. The operator
--     runs `ALTER ROLE steady_app LOGIN PASSWORD '<from the secret store>'` as a
--     deployment step, and the same for steady_platform_admin members.
--   * Every transaction sets `app.tenant_id` from the authenticated session's
--     TenantContext. A statement issued without it matches no rows at all: the
--     failure mode of a forgotten scope is "sees nothing", never "sees
--     everything".
--   * Cross-tenant access is a ROLE, not a flag. `steady_platform_admin` gets a
--     second permissive policy. The app's own role cannot grant itself that
--     policy by setting a GUC, so an application-layer compromise still cannot
--     cross a tenant boundary. crossTenantContext() in the application layer
--     mirrors this, and both are audited.
--
-- FORCE ROW LEVEL SECURITY is applied so the policies bind the table owner too;
-- without it a migration run as owner would silently see everything.
--
-- Policies are generated from the catalog rather than a hardcoded list: any
-- table carrying a tenant_id column is covered automatically, so a new
-- tenant-scoped table cannot be added and left unprotected. Re-running is
-- idempotent.

DO $$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'steady_app') THEN
    CREATE ROLE steady_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'steady_platform_admin') THEN
    CREATE ROLE steady_platform_admin NOLOGIN;
  END IF;

  FOR r IN
    SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
     WHERE c.relkind = 'r'
       AND n.nspname = current_schema()
       AND a.attname = 'tenant_id'
       AND a.attnum > 0
       AND NOT a.attisdropped
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.table_name);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', r.table_name);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true))
    $f$, r.table_name);

    -- Platform administration. Membership in the role is the grant; no session
    -- variable can substitute for it.
    EXECUTE format('DROP POLICY IF EXISTS platform_admin_access ON %I', r.table_name);
    EXECUTE format($f$
      CREATE POLICY platform_admin_access ON %I
        USING (pg_has_role(current_user, 'steady_platform_admin', 'member'))
        WITH CHECK (pg_has_role(current_user, 'steady_platform_admin', 'member'))
    $f$, r.table_name);

    -- Append-only tables are append-only at the privilege level too, not merely
    -- by convention: the application role is never granted UPDATE or DELETE on
    -- the event log, so immutability (ADR 0010 §1) survives a bug in the
    -- application layer as well as a decision to write around it.
    IF r.table_name IN ('longitudinal_events', 'audit_log') THEN
      EXECUTE format('GRANT SELECT, INSERT ON %I TO steady_app', r.table_name);
      EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM steady_app', r.table_name);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO steady_app', r.table_name);
    END IF;
  END LOOP;
END
$$;
