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

CREATE TABLE IF NOT EXISTS companion_proposals (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('trigger','focus_area')),
  title text NOT NULL,
  detail text,
  category text,
  source_conversation_id text,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','dismissed')),
  created_at text NOT NULL DEFAULT steady_now(),
  decided_at text
);

CREATE TABLE IF NOT EXISTS program_enrollments (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  program_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','left','finished')),
  created_at text NOT NULL DEFAULT steady_now(),
  updated_at text NOT NULL DEFAULT steady_now(),
  UNIQUE(user_id, program_id)
);

CREATE TABLE IF NOT EXISTS program_unit_completions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  program_id text NOT NULL,
  unit_id text NOT NULL,
  created_at text NOT NULL DEFAULT steady_now(),
  UNIQUE(user_id, program_id, unit_id)
);

CREATE TABLE IF NOT EXISTS activity_entries (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  program_id text NOT NULL,
  unit_id text NOT NULL,
  kind text NOT NULL,
  payload_enc text NOT NULL,
  created_at text NOT NULL DEFAULT steady_now(),
  updated_at text NOT NULL DEFAULT steady_now(),
  deleted_at text
);
CREATE INDEX IF NOT EXISTS idx_activity_entries_user ON activity_entries(user_id, program_id, unit_id);

CREATE TABLE IF NOT EXISTS program_entry_screens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  program_id text NOT NULL,
  screen_id text NOT NULL,
  withheld integer NOT NULL CHECK (withheld IN (0,1)),
  note_keys text NOT NULL DEFAULT '',
  created_at text NOT NULL DEFAULT steady_now(),
  cleared_at text
);
CREATE INDEX IF NOT EXISTS idx_program_entry_screens_user ON program_entry_screens(user_id, program_id);

CREATE TABLE IF NOT EXISTS member_thought_records (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  payload_enc text NOT NULL,
  created_at text NOT NULL DEFAULT steady_now(),
  updated_at text NOT NULL DEFAULT steady_now(),
  deleted_at text
);
CREATE INDEX IF NOT EXISTS idx_member_thought_records_user ON member_thought_records(user_id, created_at);


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
-- Handoff 11: 'evaluation' locks PHI fields (steady_phi_lock, below).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'standard' CHECK (mode IN ('standard','evaluation'));

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

-- Handoff 10 Phase 3 runs. Here rather than beside the other member tables
-- because they reference persons, created just above.
CREATE TABLE IF NOT EXISTS intervention_runs (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  person_id text NOT NULL REFERENCES persons(id),
  assignment_id text NOT NULL,
  module_id text NOT NULL,
  module_version text NOT NULL,
  started_at text NOT NULL,
  ended_at text,
  status text NOT NULL CHECK (status IN ('started','completed','stopped_by_patient','hard_stopped_by_policy')),
  gate_snapshot_json text NOT NULL,
  stop_reason_code text,
  distress_before integer NOT NULL CHECK (distress_before BETWEEN 0 AND 10),
  distress_after integer CHECK (distress_after BETWEEN 0 AND 10),
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intervention_runs_assignment ON intervention_runs(person_id, assignment_id, started_at);

CREATE TABLE IF NOT EXISTS intervention_run_responses (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  person_id text NOT NULL REFERENCES persons(id),
  run_id text NOT NULL REFERENCES intervention_runs(id),
  step_id text NOT NULL,
  response_schema_version text NOT NULL,
  structured_response_json text NOT NULL DEFAULT '{}',
  encrypted_free_text text,
  recorded_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intervention_run_responses_run ON intervention_run_responses(run_id);

-- Handoff 11: visits and primary-care links (they reference persons).
CREATE TABLE IF NOT EXISTS care_visits (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  person_id text NOT NULL REFERENCES persons(id),
  clinician_person_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('visit','checkup')),
  minutes integer NOT NULL,
  scheduled_at text NOT NULL,
  status text NOT NULL CHECK (status IN ('scheduled','completed','missed','canceled')),
  created_at text NOT NULL DEFAULT steady_now()
);
CREATE INDEX IF NOT EXISTS idx_care_visits_person ON care_visits(tenant_id, person_id, scheduled_at);

CREATE TABLE IF NOT EXISTS primary_care_links (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  pcp_person_id text NOT NULL REFERENCES persons(id),
  person_id text NOT NULL REFERENCES persons(id),
  started_at text NOT NULL,
  ended_at text
);
CREATE INDEX IF NOT EXISTS idx_primary_care_links_pcp ON primary_care_links(tenant_id, pcp_person_id);

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
ALTER TABLE companion_proposals ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE program_enrollments ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE program_unit_completions ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE activity_entries ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE program_entry_screens ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE member_thought_records ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';
ALTER TABLE review_notes ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '00000000000000000000000000';

-- ---------------------------------------------------------------------------
-- Clinician thoughts, clinical memory and threads
-- ---------------------------------------------------------------------------
--
-- The Postgres mirror of the clinician thinking layer (Clinician Thoughts spec
-- §6; SQLite original in src/lib/db.ts). Phase 0's definition of done requires
-- the schema plan to be mirrored for both, and this file is the mirror.
--
-- Every table below carries tenant_id, so the RLS block that follows picks them
-- up with no edit: its policy loop enumerates the catalog rather than a
-- hardcoded list, which is what makes "a new tenant-scoped table cannot be added
-- and left unprotected" true rather than a convention.
--
-- Types differ from SQLite where Postgres has a better one — timestamptz for
-- instants, jsonb for structured columns — because a mirror that keeps TEXT
-- everywhere would carry SQLite's limitations into a database that does not
-- have them. The logical schema is the same; the storage types are the right
-- ones for each engine.

CREATE TABLE IF NOT EXISTS clinician_thoughts (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  person_id text NOT NULL REFERENCES persons(id),
  clinician_person_id text NOT NULL REFERENCES persons(id),
  -- Seven states, not §6's six: §8.1's state machine produces
  -- review_transcript_only when the transcript lands and extraction fails, and
  -- §17.4 writes the copy for it. See the note on the SQLite original.
  status text NOT NULL CHECK (
    status IN (
      'capturing','processing','review','review_transcript_only',
      'saved','discarded','failed'
    )
  ),
  audio_storage_key text,
  audio_retention_policy text NOT NULL DEFAULT 'delete_after_verified_transcript',
  audio_deleted_at timestamptz,
  current_transcript_id text,
  source_session_id text,
  recorded_at timestamptz NOT NULL,
  saved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_thoughts_person_time
  ON clinician_thoughts(tenant_id, person_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS clinician_thought_transcripts (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  person_id text NOT NULL REFERENCES persons(id),
  thought_id text NOT NULL REFERENCES clinician_thoughts(id),
  version integer NOT NULL,
  transcript_text text NOT NULL,
  transcript_hash text NOT NULL,
  provider text,
  provider_model text,
  language text,
  confidence_json jsonb,
  created_by text NOT NULL CHECK (created_by IN ('transcription_service','clinician')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(thought_id, version)
);

CREATE TABLE IF NOT EXISTS clinical_memory_items (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  person_id text NOT NULL REFERENCES persons(id),
  source_thought_id text,
  source_transcript_id text,
  source_span_json jsonb,
  item_type text NOT NULL,
  statement_class text NOT NULL CHECK (
    statement_class IN (
      'clinician_observation','patient_report',
      'clinician_hypothesis','clinician_uncertainty'
    )
  ),
  normalized_label text,
  display_text text NOT NULL,
  status text NOT NULL CHECK (status IN ('candidate','approved','rejected','superseded')),
  approved_by text,
  approved_at timestamptz,
  supersedes_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_person_type_status
  ON clinical_memory_items(tenant_id, person_id, item_type, status);
CREATE INDEX IF NOT EXISTS idx_memory_person_label
  ON clinical_memory_items(tenant_id, person_id, normalized_label);

CREATE TABLE IF NOT EXISTS clinical_threads (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  person_id text NOT NULL REFERENCES persons(id),
  thread_type text NOT NULL,
  canonical_label text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','resolved','archived')),
  created_by text NOT NULL CHECK (created_by IN ('clinician','system')),
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_threads_person_status
  ON clinical_threads(tenant_id, person_id, status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS clinical_thread_memberships (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  person_id text NOT NULL REFERENCES persons(id),
  thread_id text NOT NULL REFERENCES clinical_threads(id),
  memory_item_id text NOT NULL REFERENCES clinical_memory_items(id),
  relationship text NOT NULL DEFAULT 'supports',
  status text NOT NULL CHECK (status IN ('proposed','accepted','rejected')),
  proposed_by text NOT NULL CHECK (proposed_by IN ('clinician','model','system')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(thread_id, memory_item_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_thread_status
  ON clinical_thread_memberships(tenant_id, thread_id, status);

CREATE TABLE IF NOT EXISTS clinical_inferences (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  person_id text NOT NULL REFERENCES persons(id),
  inference_type text NOT NULL,
  display_text text NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed','accepted','dismissed','expired')),
  ai_inference_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  decided_by text,
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_inference_person_status
  ON clinical_inferences(tenant_id, person_id, status, created_at DESC);

-- No tenant_id, and therefore no RLS policy of its own: this is a join table
-- reachable only through an inference that carries one. A tenant_id column here
-- that nothing sets would make the policy loop count a protection that is not
-- actually enforcing anything.
CREATE TABLE IF NOT EXISTS clinical_inference_evidence (
  inference_id text NOT NULL REFERENCES clinical_inferences(id),
  evidence_type text NOT NULL,
  evidence_id text NOT NULL,
  rank integer NOT NULL,
  PRIMARY KEY(inference_id, evidence_type, evidence_id)
);

CREATE TABLE IF NOT EXISTS clinical_retrieval_documents (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  person_id text NOT NULL REFERENCES persons(id),
  source_type text NOT NULL,
  source_id text NOT NULL,
  text_for_retrieval text NOT NULL,
  content_hash text NOT NULL,
  embedding_model text,
  embedding_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, source_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_retrieval_person
  ON clinical_retrieval_documents(tenant_id, person_id, source_type);

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

-- ---------------------------------------------------------------------------
-- Handoff 11: the PHI lock. An evaluation tenant runs on synthetic people, so
-- the fields that exist only to hold a real identifier refuse any value there.
-- The list is src/lib/tenants/phi.ts (PHI_FIELDS); SQLite gets the same lock
-- from it, and tests/phi-lock.test.ts checks this file names every field.
-- SECURITY DEFINER so the tenant lookup is not itself filtered by RLS: the
-- lock must hold whoever writes.
CREATE OR REPLACE FUNCTION steady_phi_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v text := to_jsonb(NEW) ->> TG_ARGV[0];
  t text;
BEGIN
  IF v IS NULL OR v = '' THEN RETURN NEW; END IF;
  IF TG_ARGV[1] = 'user_id' THEN
    SELECT u.tenant_id INTO t FROM users u WHERE u.id = to_jsonb(NEW) ->> 'user_id';
  ELSE
    t := to_jsonb(NEW) ->> 'tenant_id';
  END IF;
  IF (SELECT mode FROM tenants WHERE id = t) = 'evaluation' THEN
    RAISE EXCEPTION '%.% is a PHI field and is locked in an evaluation tenant', TG_TABLE_NAME, TG_ARGV[0];
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS phi_lock_users_dob ON users;
CREATE TRIGGER phi_lock_users_dob BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION steady_phi_lock('dob', 'tenant_id');
DROP TRIGGER IF EXISTS phi_lock_external_identifiers_external_id ON external_identifiers;
CREATE TRIGGER phi_lock_external_identifiers_external_id BEFORE INSERT OR UPDATE ON external_identifiers
  FOR EACH ROW EXECUTE FUNCTION steady_phi_lock('external_id', 'tenant_id');
DROP TRIGGER IF EXISTS phi_lock_safety_plans_support_contact_name ON safety_plans;
CREATE TRIGGER phi_lock_safety_plans_support_contact_name BEFORE INSERT OR UPDATE ON safety_plans
  FOR EACH ROW EXECUTE FUNCTION steady_phi_lock('support_contact_name', 'user_id');
DROP TRIGGER IF EXISTS phi_lock_safety_plans_support_contact_method ON safety_plans;
CREATE TRIGGER phi_lock_safety_plans_support_contact_method BEFORE INSERT OR UPDATE ON safety_plans
  FOR EACH ROW EXECUTE FUNCTION steady_phi_lock('support_contact_method', 'user_id');

-- ---------------------------------------------------------------------------
-- Handoff 11 package 2: a row about a person belongs to that person's tenant.
-- The live writers never name a tenant, so the column default files every row
-- in the platform tenant — and the tenant_isolation policy above then refuses
-- the insert from a session in any other tenant. The row takes its person's
-- tenant when the writer left the platform default; a named tenant is kept.
-- The list is src/lib/tenants/inherit.ts over TENANT_SCOPED_TABLES; a test
-- holds this array to it. BEFORE INSERT, so the policy's WITH CHECK sees the
-- filled tenant. SECURITY DEFINER for the same reason as the PHI lock.
CREATE OR REPLACE FUNCTION steady_tenant_inherit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  owner text := to_jsonb(NEW) ->> TG_ARGV[0];
  t text;
BEGIN
  IF NEW.tenant_id <> '00000000000000000000000000' OR owner IS NULL THEN RETURN NEW; END IF;
  SELECT COALESCE((SELECT tenant_id FROM users WHERE id = owner), (SELECT tenant_id FROM persons WHERE id = owner)) INTO t;
  IF t IS NOT NULL THEN NEW.tenant_id := t; END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  pair text;
  tbl text;
  col text;
BEGIN
  FOREACH pair IN ARRAY ARRAY[
    'caseload_assignments:person_id',
    'consents:user_id',
    'screenings:user_id',
    'checkins:user_id',
    'therapy_sessions:user_id',
    'clinical_notes:person_id',
    'post_session_checks:user_id',
    'module_unlocks:user_id',
    'alerts:user_id',
    'user_profiles:user_id',
    'user_triggers:user_id',
    'early_warning_signs:user_id',
    'readiness_assessments:user_id',
    'safety_plans:user_id',
    'ai_companion_preferences:user_id',
    'ai_memory_items:user_id',
    'companion_proposals:user_id',
    'program_enrollments:user_id',
    'program_unit_completions:user_id',
    'activity_entries:user_id',
    'program_entry_screens:user_id',
    'member_thought_records:user_id',
    'intervention_runs:person_id',
    'intervention_run_responses:person_id',
    'care_visits:person_id',
    'primary_care_links:person_id',
    'ai_conversations:user_id',
    'ai_messages:user_id',
    'subscriptions:user_id',
    'payments:user_id',
    'program_plans:user_id',
    'care_tracks:user_id',
    'care_track_intake:user_id',
    'practice_completions:user_id',
    'upsell_events:user_id',
    'autopilot_plans:user_id',
    'autopilot_events:user_id',
    'lesson_reads:user_id',
    'screening_progress:user_id',
    'support_assignments:person_id',
    'care_handoffs:person_id',
    'person_attributes:person_id',
    'claims:person_id',
    'clinician_thoughts:person_id',
    'clinician_thought_transcripts:person_id',
    'intervention_instances:person_id',
    'intervention_response_observations:person_id',
    'response_fingerprint_snapshots:person_id',
    'clinical_attention_signals:person_id',
    'between_visit_care_actions:person_id',
    'recovery_trajectory_snapshots:person_id',
    'recovery_trajectory_reviews:person_id',
    'therapeutic_load_snapshots:person_id',
    'therapeutic_load_reviews:person_id',
    'return_to_life_goals:person_id',
    'return_to_life_goal_levels:person_id',
    'return_to_life_observations:person_id',
    'clinical_memory_items:person_id',
    'clinical_threads:person_id',
    'clinical_thread_memberships:person_id',
    'clinical_inferences:person_id',
    'clinical_retrieval_documents:person_id'
  ] LOOP
    tbl := split_part(pair, ':', 1);
    col := split_part(pair, ':', 2);
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = tbl AND column_name = col)
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = tbl AND column_name = 'tenant_id') THEN
      EXECUTE format('DROP TRIGGER IF EXISTS tenant_inherit ON %I', tbl);
      EXECUTE format('CREATE TRIGGER tenant_inherit BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION steady_tenant_inherit(%L)', tbl, col);
    END IF;
  END LOOP;
END
$$;
