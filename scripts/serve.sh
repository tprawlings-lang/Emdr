#!/usr/bin/env bash
# Start the built app and prove THIS build is the one answering.
#
#   scripts/serve.sh [start|stop|status]
#
# WHY THIS EXISTS. `curl localhost:3000` returning 200 does not mean your build
# is running. It means SOMETHING is listening. Those are different claims, and
# the gap between them cost two rounds of verification in one session:
#
#   1. `pkill -f next-server` matched the pkill command's own line, killed the
#      shell running it, and returned 144. The server survived.
#   2. `next start` then failed with EADDRINUSE — into a log nobody read.
#   3. The readiness check was `curl until 200`, and the OLD server answered it
#      happily. Two changes were then "verified" against a build that did not
#      contain them, and a bug was chased that had already been fixed.
#
# So this script asks the only question that matters: is the process I started
# serving the build I just made? `.next/BUILD_ID` answers it, and Next.js emits
# it into the HTML of every page.
#
# KILL BY PORT, NEVER BY NAME. A pattern match on "next-server" also matches
# the grep, the pkill, and the shell wrapping them. Ports have exactly one
# owner.

set -uo pipefail

PORT="${PORT:-3000}"
LOG="${SERVE_LOG:-/tmp/steady-serve.log}"

# The demo environment's variables, in one place. Every one of these has been
# forgotten at least once, and the failure is always further away than the
# cause: a missing session secret fails a production config assertion at boot,
# a missing data key fails on the first encrypted read.
export NODE_ENV=production
export EMDR_DEMO="${EMDR_DEMO:-1}"
export EMDR_DATA_DIR="${EMDR_DATA_DIR:-.e2e-data}"
export EMDR_SESSION_SECRET="${EMDR_SESSION_SECRET:-e2e-placeholder-session-secret-not-a-real-secret}"
export EMDR_DATA_KEY="${EMDR_DATA_KEY:-e2e-placeholder-data-key}"
export EMDR_REVIEW_ACCESS_CODE="${EMDR_REVIEW_ACCESS_CODE:-e2e-placeholder-review-code}"

# WHO IS LISTENING, without lsof.
#
# `lsof -ti tcp:3000` returns NOTHING in this container even while a server is
# answering — it cannot map the socket to its owner here. The first version of
# this script trusted it, so `free_port` silently did nothing and the whole
# exercise reproduced the bug it was written to prevent.
#
# `pgrep -x next-server` does not work either: the process comm is truncated by
# the kernel to "next-server (v1", so an exact match never fires. Matching on
# `comm` via ps does work, and matching comm rather than the full command line
# is what keeps it from also matching the grep, the shell, and this script.
server_pids() {
  ps -eo pid=,comm= 2>/dev/null | awk '$2 ~ /^next-server/ { print $1 }'
}

# THE INVARIANT EVERYTHING ELSE RESTS ON: does anything answer on this port?
# It asks the port the same way a browser would, so it is true regardless of
# what the process table or lsof can see.
port_answers() {
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 \
        "http://localhost:${PORT}/login" 2>/dev/null)" != "000" ]
}

# A CHUNK PATH FROM THE SERVED PAGE, which is the fingerprint that actually
# exists in this Next version.
#
# The obvious marker — the build id — is NOT rendered into the HTML here. That
# was tried first and silently matched nothing, which would have made this
# script report a verification it had not performed. Chunk filenames carry a
# content hash and change with every build, so a chunk the running server
# advertises can be checked against `.next/static/` on disk: if it is missing,
# something built elsewhere is answering.
#
# Defined once and used by both `start` and `status`. Two copies would be two
# answers to "which build is running", which is the confusion this script
# exists to end.
served_chunk() {
  curl -s "http://localhost:${PORT}/login" \
    | grep -o '/_next/static/chunks/[A-Za-z0-9._-]*\.js' | head -1
}

# Stop whatever is serving, and PROVE the port went quiet.
#
# Proving it is the point. Killing a pid says a process died; only silence on
# the port says the next start will get to bind. Those came apart in the very
# session this script was written in.
free_port() {
  port_answers || return 0

  local pids
  pids="$(server_pids)"
  if [ -n "$pids" ]; then
    echo "serve: stopping $(echo "$pids" | tr '\n' ' ')"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    for _ in $(seq 1 20); do
      port_answers || return 0
      sleep 0.5
    done
    echo "serve: still answering — SIGKILL"
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
    for _ in $(seq 1 10); do
      port_answers || return 0
      sleep 0.5
    done
  fi

  # Something holds the port that this script cannot identify or cannot kill.
  # REFUSING IS THE WHOLE VALUE HERE. Starting anyway is what produced two
  # rounds of verification against somebody else's build.
  echo "serve: port ${PORT} is still answering and cannot be freed" >&2
  return 1
}

case "${1:-start}" in
  stop)
    free_port && echo "serve: port ${PORT} is free"
    exit 0
    ;;
  status)
    if ! port_answers; then echo "serve: nothing answering on port ${PORT}"; exit 1; fi
    echo "serve: answering on port ${PORT} (pids: $(server_pids | tr '\n' ' '))"
    chunk="$(served_chunk)"
    echo "serve: disk BUILD_ID $(cat .next/BUILD_ID 2>/dev/null || echo '<none>')"
    if [ -z "$chunk" ]; then
      echo "serve: served chunk  <unreadable>"
    elif [ -f ".next/static/${chunk#/_next/static/}" ]; then
      echo "serve: served chunk  ${chunk##*/} — matches this build"
    else
      echo "serve: served chunk  ${chunk##*/} — NOT IN THIS BUILD"
    fi
    exit 0
    ;;
esac

# ---------------------------------------------------------------------------

if [ ! -f .next/BUILD_ID ]; then
  echo "serve: no .next/BUILD_ID — run 'npm run build' first" >&2
  exit 1
fi
WANT="$(cat .next/BUILD_ID)"

free_port || { echo "serve: could not free port ${PORT}" >&2; exit 1; }

echo "serve: starting (build ${WANT})"
setsid npm run start < /dev/null > "$LOG" 2>&1 &

# A 200 NOW MEANS OURS, because `free_port` proved nothing answered a moment
# ago. That ordering is the fix: the original bug was a readiness check that
# could not tell our server from the one already there, and no amount of
# polling distinguishes them once both are possible.
#
# The log is watched too. A start that dies on EADDRINUSE, a bad config or a
# failed migration never opens the port, and polling curl alone turns that into
# a silent two-minute timeout instead of the one line the log already holds.
STARTED=""
for _ in $(seq 1 120); do
  if grep -qE 'EADDRINUSE|Failed to start server|Error:' "$LOG" 2>/dev/null; then
    echo "serve: START FAILED" >&2
    tail -20 "$LOG" >&2
    exit 1
  fi
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/login" 2>/dev/null)" = "200" ]; then
    STARTED=1; break
  fi
  sleep 1
done

if [ -z "$STARTED" ]; then
  echo "serve: timed out waiting for the server" >&2
  tail -20 "$LOG" >&2
  exit 1
fi

# THE CHECK THAT WAS MISSING: does the server's own asset exist in the build I
# just made? A stale server advertises chunks that were deleted when this build
# replaced them.
CHUNK="$(served_chunk)"
if [ -z "$CHUNK" ]; then
  # Said rather than swallowed. A marker that stops matching after a framework
  # upgrade must announce itself, or this script goes back to reporting a
  # verification it did not perform — which is the original bug wearing a
  # script.
  echo "serve: WARNING could not read a chunk path; the build check did NOT run" >&2
elif [ ! -f ".next/static/${CHUNK#/_next/static/}" ]; then
  echo "serve: WRONG BUILD — the server is serving ${CHUNK##*/}, which is not in this build" >&2
  echo "serve: something else owns port ${PORT}. Run 'scripts/serve.sh stop' and retry." >&2
  exit 1
fi

echo "serve: ready on http://localhost:${PORT} (build ${WANT}, log ${LOG})"
