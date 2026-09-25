#!/usr/bin/env bash
# Cross-tenant attack cases against real Postgres row-level security.
#
# tests/tenant-isolation.test.ts proves the APPLICATION layer scopes correctly.
# This proves the DATABASE layer does too — which is the half that still holds
# when the application layer has a bug. ADR 0011 §3 requires both.
#
# It spins up a throwaway Postgres cluster, applies scripts/pg-schema.sql, and
# then attacks it as the unprivileged `steady_app` role, exactly as a compromised
# application server would. Every attack must fail.
#
#   ./scripts/verify-rls.sh
#
# Requires a local Postgres 16 (postgresql-client + server binaries). Exits
# non-zero on the first failed assertion. Leaves nothing behind.

set -euo pipefail

# Auto-detect the server binaries so a runner image bumping its Postgres major
# does not silently skip this gate. Newest first; PGBIN overrides.
if [ -z "${PGBIN:-}" ]; then
  for d in $(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -Vr); do
    [ -x "$d/initdb" ] && PGBIN="$d" && break
  done
fi
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
if [ ! -x "$PGBIN/initdb" ]; then
  echo "FAIL — no Postgres server binaries found (looked for \$PGBIN/initdb at '$PGBIN')." >&2
  echo "       This gate must not be skipped silently: install postgresql or set PGBIN." >&2
  exit 1
fi
PGDIR="${PGDIR:-/var/tmp/steady-rls-verify-$$}"
PGPORT="${PGPORT:-55433}"
PGHOST=/tmp
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILURES=0

cleanup() {
  "$PGBIN/pg_ctl" -D "$PGDIR" stop -m immediate >/dev/null 2>&1 || \
    su postgres -c "$PGBIN/pg_ctl -D $PGDIR stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$PGDIR"
}
trap cleanup EXIT

# Postgres refuses to run as root, so drop to a non-root owner when we are it.
as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -c "$1"; else bash -c "$1"; fi; }
# Runs SQL and returns just the rows: psql echoes a command tag for each
# statement, and these queries are prefixed with `SET app.tenant_id`.
q() {
  psql -h "$PGHOST" -p "$PGPORT" -U "$1" -d postgres -tAc "$2" 2>&1 \
    | grep -Ev '^(SET|UPDATE [0-9]+|DELETE [0-9]+|INSERT 0 [0-9]+)$' || true
}

# assert <description> <expected> <actual>
assert() {
  if [ "$2" = "$3" ]; then
    printf '  ok    %s\n' "$1"
  else
    printf '  FAIL  %s\n        expected: %s\n        actual:   %s\n' "$1" "$2" "$3"
    FAILURES=$((FAILURES + 1))
  fi
}

# assert_blocked <description> <output> — output must contain an error.
assert_blocked() {
  case "$2" in
    *ERROR*) printf '  ok    %s\n' "$1" ;;
    *) printf '  FAIL  %s\n        the operation was NOT refused: %s\n' "$1" "$2"
       FAILURES=$((FAILURES + 1)) ;;
  esac
}

echo "==> starting throwaway cluster on port $PGPORT"
if [ "$(id -u)" = 0 ]; then id postgres >/dev/null 2>&1 || useradd -m postgres; fi
mkdir -p "$PGDIR"
if [ "$(id -u)" = 0 ]; then chown postgres "$PGDIR"; fi
chmod 700 "$PGDIR"
as_pg "$PGBIN/initdb -D $PGDIR -U postgres --auth=trust" >/dev/null
as_pg "$PGBIN/pg_ctl -D $PGDIR -o '-k $PGHOST -p $PGPORT -c listen_addresses=' -w start" >/dev/null

echo "==> applying scripts/pg-schema.sql (twice, to prove idempotency)"
psql -h "$PGHOST" -p "$PGPORT" -U postgres -q -v ON_ERROR_STOP=1 -f "$ROOT/scripts/pg-schema.sql" >/dev/null 2>&1
psql -h "$PGHOST" -p "$PGPORT" -U postgres -q -v ON_ERROR_STOP=1 -f "$ROOT/scripts/pg-schema.sql" >/dev/null 2>&1

echo "==> seeding two tenants that must never see each other"
psql -h "$PGHOST" -p "$PGPORT" -U postgres -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
-- The schema creates steady_app NOLOGIN on purpose: the operator grants LOGIN
-- with a real credential. This is that step, for the test only.
ALTER ROLE steady_app LOGIN;
CREATE ROLE steady_admin LOGIN IN ROLE steady_platform_admin;
GRANT USAGE ON SCHEMA public TO steady_app, steady_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO steady_admin;

INSERT INTO tenants (id, kind, name) VALUES ('T_ALPHA','organization','Alpha'),('T_BETA','organization','Beta');
INSERT INTO users (id,email,name,role,password_hash,tenant_id) VALUES
  ('u-a','a@x.test','A','member','x','T_ALPHA'),
  ('u-b','b@x.test','B','member','x','T_BETA');
INSERT INTO checkins (id,user_id,checkin_date,activation,shutdown,harm_urge,feels_safe,
                      dissociation,sleep_quality,substance_flag,recommended_action,tenant_id)
VALUES ('ck-a','u-a','2026-05-01',5,2,0,1,3,6,0,'processing_ok','T_ALPHA'),
       ('ck-b','u-b','2026-05-01',5,2,0,1,3,6,0,'processing_ok','T_BETA');
SQL

echo
echo "==> coverage"
assert "every table carrying tenant_id has RLS enabled AND forced" "" \
  "$(q postgres "SELECT string_agg(c.relname, ',') FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname='public' AND c.relkind='r' AND a.attname='tenant_id'
        AND NOT a.attisdropped AND NOT (c.relrowsecurity AND c.relforcerowsecurity)")"

echo
echo "==> attacks, run as the application role \`steady_app\`"
assert "an unfiltered read returns only the caller's tenant" "ck-a" \
  "$(q steady_app "SET app.tenant_id='T_ALPHA'; SELECT id FROM checkins ORDER BY id")"

assert "naming the foreign row by its exact id yields nothing" "0" \
  "$(q steady_app "SET app.tenant_id='T_ALPHA'; SELECT count(*) FROM checkins WHERE id='ck-b'")"

assert "an aggregate does not leak the other tenant's volume" "1" \
  "$(q steady_app "SET app.tenant_id='T_ALPHA'; SELECT count(*) FROM checkins")"

q steady_app "SET app.tenant_id='T_ALPHA'; UPDATE checkins SET recommended_action='crisis' WHERE id='ck-b'" >/dev/null
assert "updating the foreign row changes nothing" "processing_ok" \
  "$(q postgres "SELECT recommended_action FROM checkins WHERE id='ck-b'")"

q steady_app "SET app.tenant_id='T_ALPHA'; DELETE FROM checkins WHERE id='ck-b'" >/dev/null
assert "deleting the foreign row leaves it in place" "1" \
  "$(q postgres "SELECT count(*) FROM checkins WHERE id='ck-b'")"

assert_blocked "writing a row stamped with a foreign tenant is refused by WITH CHECK" \
  "$(q steady_app "SET app.tenant_id='T_ALPHA'; INSERT INTO checkins
      (id,user_id,checkin_date,activation,shutdown,harm_urge,feels_safe,dissociation,
       sleep_quality,substance_flag,recommended_action,tenant_id)
      VALUES ('ck-evil','u-a','2026-05-02',1,1,0,1,1,1,0,'processing_ok','T_BETA')")"

assert "a query with NO tenant set sees nothing — never everything" "0" \
  "$(q steady_app "SELECT count(*) FROM checkins")"

assert_blocked "the application role cannot assume the platform-admin role" \
  "$(q steady_app "SET ROLE steady_platform_admin")"

assert_blocked "the application role cannot delete from the event log" \
  "$(q steady_app "DELETE FROM longitudinal_events")"

assert_blocked "the application role cannot update the event log" \
  "$(q steady_app "UPDATE longitudinal_events SET payload='{}'")"

echo
echo "==> sanctioned cross-tenant access still works for platform administration"
assert "the platform-admin role sees both tenants" "2" \
  "$(q steady_admin "SELECT count(*) FROM checkins")"

echo
echo "==> the PHI lock holds in an evaluation tenant (Handoff 11)"
q postgres "INSERT INTO tenants (id, kind, name, mode) VALUES ('T_EVAL','organization','Eval','evaluation')" >/dev/null
q postgres "INSERT INTO users (id,email,name,role,password_hash,tenant_id) VALUES ('u-e','e@x.test','E','member','x','T_EVAL')" >/dev/null
q postgres "INSERT INTO persons (id, tenant_id, display_name) VALUES ('u-e','T_EVAL','E')" >/dev/null
# Controls: the same writes WITHOUT the locked value go through, so a refusal
# below is the lock and not a foreign key or a missing column.
assert "the same external id is accepted in an ordinary tenant" "1" \
  "$(q postgres "INSERT INTO persons (id, tenant_id, display_name) VALUES ('u-a2','T_ALPHA','A2'); INSERT INTO external_identifiers (id,person_id,tenant_id,source_system,external_id) VALUES ('x-a','u-a2','T_ALPHA','ehr','MRN1'); SELECT count(*) FROM external_identifiers WHERE id='x-a'")"
assert_blocked "a date of birth is refused in an evaluation tenant" \
  "$(q postgres "UPDATE users SET dob='1990-01-01' WHERE id='u-e'")"
assert_blocked "an external record number is refused in an evaluation tenant" \
  "$(q postgres "INSERT INTO external_identifiers (id,person_id,tenant_id,source_system,external_id) VALUES ('x-e','u-e','T_EVAL','ehr','MRN123')")"
assert_blocked "a safe person's contact is refused in an evaluation tenant" \
  "$(q postgres "INSERT INTO safety_plans (user_id, support_contact_method, tenant_id) VALUES ('u-e','555-0100','T_EVAL')")"
assert "the same date of birth is accepted in an ordinary tenant" "1990-01-01" \
  "$(q postgres "UPDATE users SET dob='1990-01-01' WHERE id='u-a'; SELECT dob FROM users WHERE id='u-a'")"

echo
echo "==> a row takes its person's tenant when the writer names none (Handoff 11)"
# The live writers omit tenant_id. Without the inherit trigger the default
# files the row in the platform tenant, and the policy refuses the insert from
# a session in the person's own tenant.
assert "a check-in written without a tenant lands in its member's tenant" "T_EVAL" \
  "$(q steady_app "SET app.tenant_id='T_EVAL'; INSERT INTO checkins (id,user_id,checkin_date,activation,shutdown,harm_urge,feels_safe,dissociation,sleep_quality,substance_flag,recommended_action) VALUES ('ck-e','u-e','2026-09-25',3,3,0,1,1,6,0,'continue'); SELECT tenant_id FROM checkins WHERE id='ck-e'")"
assert "a writer that names a tenant keeps it" "T_ALPHA" \
  "$(q postgres "INSERT INTO checkins (id,user_id,tenant_id,checkin_date,activation,shutdown,harm_urge,feels_safe,dissociation,sleep_quality,substance_flag,recommended_action) VALUES ('ck-n','u-e','T_ALPHA','2026-09-24',3,3,0,1,1,6,0,'continue'); SELECT tenant_id FROM checkins WHERE id='ck-n'")"
assert_blocked "the inherited tenant still cannot be written from another tenant's session" \
  "$(q steady_app "SET app.tenant_id='T_ALPHA'; INSERT INTO checkins (id,user_id,checkin_date,activation,shutdown,harm_urge,feels_safe,dissociation,sleep_quality,substance_flag,recommended_action) VALUES ('ck-x','u-e','2026-09-23',3,3,0,1,1,6,0,'continue')")"

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "PASS — row-level security holds against every cross-tenant attack case."
else
  echo "FAIL — $FAILURES assertion(s) failed."
  exit 1
fi
