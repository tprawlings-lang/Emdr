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
