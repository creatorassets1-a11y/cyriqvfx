#!/usr/bin/env bash
# Starts/stops PostgreSQL, the API and the Vite dev server for local work.
#
# Processes are matched by command line rather than by PID file alone: `npx`
# spawns a node child that owns the port, so killing only the launcher leaves
# that child running and the next start silently keeps serving the old code.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${ROOT}/.run"
mkdir -p "$RUN_DIR"

API_PORT=4000
WEB_PORT=5173

# Kills whatever is listening on a port. Matching by port rather than by
# command line is what makes this reliable: `npx` spawns a node child whose
# command line differs from the launcher's, and that child owns the socket.
stop_one() {
  local name="$1"
  local port="$2"
  local pidfile="${RUN_DIR}/${name}.pid"

  if [[ -f "$pidfile" ]]; then
    local pid
    pid="$(cat "$pidfile")"
    # setsid made this pid a process-group leader; a negative pid signals the group.
    kill -TERM -- "-${pid}" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    rm -f "$pidfile"
  fi

  for _ in $(seq 1 20); do
    fuser -s "${port}/tcp" 2>/dev/null || return 0
    fuser -s -k -KILL "${port}/tcp" 2>/dev/null || true
    sleep 0.3
  done
}

ensure_db() {
  if ! pg_isready -h 127.0.0.1 -p 5432 > /dev/null 2>&1; then
    echo "postgres: starting"
    su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/pgdata -l /var/lib/pgdata/pg.log -o '-c listen_addresses=127.0.0.1 -p 5432' start" > /dev/null 2>&1
    for _ in $(seq 1 30); do
      pg_isready -h 127.0.0.1 -p 5432 > /dev/null 2>&1 && break
      sleep 0.5
    done
  fi
  if ! pg_isready -h 127.0.0.1 -p 5432 > /dev/null 2>&1; then
    echo "postgres: FAILED to start"
    return 1
  fi
}

start_api() {
  ensure_db || return 1
  stop_one api "$API_PORT"
  cd "${ROOT}/backend" || return 1
  setsid npx tsx src/server.ts > "${RUN_DIR}/api.log" 2>&1 < /dev/null &
  echo $! > "${RUN_DIR}/api.pid"
  for _ in $(seq 1 60); do
    if curl -sf localhost:4000/api/health > /dev/null 2>&1; then
      echo "api: ready"
      return 0
    fi
    sleep 0.5
  done
  echo "api: FAILED to become ready"
  tail -20 "${RUN_DIR}/api.log"
  return 1
}

start_web() {
  stop_one web "$WEB_PORT"
  cd "${ROOT}/frontend" || return 1
  setsid npx vite --host 127.0.0.1 --port 5173 > "${RUN_DIR}/web.log" 2>&1 < /dev/null &
  echo $! > "${RUN_DIR}/web.pid"
  for _ in $(seq 1 60); do
    if curl -sf localhost:5173 > /dev/null 2>&1; then
      echo "web: ready"
      return 0
    fi
    sleep 0.5
  done
  echo "web: FAILED to become ready"
  tail -20 "${RUN_DIR}/web.log"
  return 1
}

case "${1:-start}" in
  start) start_api && start_web ;;
  db)    ensure_db && echo "postgres: ready" ;;
  api)   start_api ;;
  web)   start_web ;;
  stop)  stop_one api "$API_PORT"; stop_one web "$WEB_PORT"; echo "stopped" ;;
  status)
    pg_isready -h 127.0.0.1 -p 5432 > /dev/null 2>&1 && echo "postgres: up" || echo "postgres: down"
    curl -sf localhost:4000/api/health > /dev/null 2>&1 && echo "api: up" || echo "api: down"
    curl -sf -o /dev/null localhost:5173 2>/dev/null && echo "web: up" || echo "web: down"
    ;;
  *) echo "usage: $0 {start|db|api|web|stop|status}"; exit 1 ;;
esac
