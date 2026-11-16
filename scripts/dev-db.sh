#!/usr/bin/env bash
# Local PostgreSQL for development and tests.
#   bash scripts/dev-db.sh start   # start (Docker if available, else a local PostgreSQL 16 cluster)
#   bash scripts/dev-db.sh stop
#   bash scripts/dev-db.sh status
# Creates role "sim" (development password only) and databases sim_dev / sim_test.
# Never use these credentials outside local development.
#
# Works as an ordinary user too (for example in WSL). Once the role exists, it needs no database
# superuser access. It never prompts for a password: without Docker, root or password-free sudo,
# it prints the one-time command that creates the role.
set -euo pipefail
ACTION="${1:-start}"
PGPORT="${PGPORT:-5432}"
CONTAINER="sim-postgres"
DEV_PASSWORD="sim_dev_password"

use_docker() { command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; }
is_root() { [ "$(id -u)" -eq 0 ]; }
can_sudo() { command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; }
ready() { pg_isready -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1; }
wait_ready() { for _ in $(seq 1 30); do ready && return 0; sleep 1; done; return 1; }

# Runs one SQL statement as the PostgreSQL superuser, however the server was started.
run_sql() {
  local sql="$1"
  if use_docker && docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    docker exec -i "$CONTAINER" psql -U postgres -tAc "$sql"
  elif id postgres >/dev/null 2>&1 && is_root; then
    su postgres -c "psql -p ${PGPORT} -tAc \"${sql//\"/\\\"}\""
  elif id postgres >/dev/null 2>&1 && can_sudo; then
    (cd / && sudo -n -u postgres psql -p "$PGPORT" -tAc "$sql")
  else
    psql -w -h 127.0.0.1 -p "$PGPORT" -U postgres -tAc "$sql"
  fi
}

# Runs one SQL statement as the development role itself.
sim_sql() { PGPASSWORD="$DEV_PASSWORD" PGCONNECT_TIMEOUT=5 psql -w -h 127.0.0.1 -p "$PGPORT" -U sim -d postgres -tAc "$1"; }
sim_can_login() {
  command -v psql >/dev/null 2>&1 \
    && sim_sql "SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user" 2>/dev/null | grep -qx t
}

port_flag() { [ "$PGPORT" = 5432 ] || printf ' -p %s' "$PGPORT"; }

setup_help() {
  local port
  port="$(port_flag)"
  cat >&2 <<EOF
PostgreSQL is running, but the development role "sim" is not set up yet, and this script can't
act as the database superuser without a password. Run this once (sudo asks for your computer
password), then run the same command again:

  sudo -u postgres psql${port} -c "CREATE ROLE sim LOGIN CREATEDB PASSWORD '${DEV_PASSWORD}'"

If PostgreSQL answers that the role already exists, run it with ALTER ROLE instead of CREATE ROLE.
EOF
}

ensure_roles() {
  if ! sim_can_login; then
    run_sql "SELECT 1" >/dev/null 2>&1 || { setup_help; exit 1; }
    run_sql "SELECT 1 FROM pg_roles WHERE rolname='sim'" | grep -q 1 \
      || run_sql "CREATE ROLE sim LOGIN CREATEDB PASSWORD '${DEV_PASSWORD}'"
  fi
  for db in sim_dev sim_test; do
    if sim_can_login; then
      sim_sql "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1 || sim_sql "CREATE DATABASE ${db}"
    else
      run_sql "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1 \
        || run_sql "CREATE DATABASE ${db} OWNER sim"
    fi
  done
  if command -v psql >/dev/null 2>&1 && ! sim_can_login; then
    echo "The role \"sim\" exists but can't log in at 127.0.0.1:${PGPORT} with the development password, or lacks CREATEDB." >&2
    echo "Reset it once: sudo -u postgres psql$(port_flag) -c \"ALTER ROLE sim LOGIN CREATEDB PASSWORD '${DEV_PASSWORD}'\"" >&2
    exit 1
  fi
}

case "$ACTION" in
  start)
    if ready; then
      echo "PostgreSQL already accepting connections on ${PGPORT}."
    elif use_docker; then
      if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then docker start "$CONTAINER" >/dev/null
      else docker run -d --name "$CONTAINER" -p "127.0.0.1:${PGPORT}:5432" -e POSTGRES_PASSWORD="$DEV_PASSWORD" -v sim-postgres-data:/var/lib/postgresql/data postgres:16 >/dev/null
      fi
      wait_ready || { echo "The PostgreSQL container did not become ready (see: docker logs ${CONTAINER})." >&2; exit 1; }
    elif command -v pg_ctlcluster >/dev/null 2>&1; then
      if is_root; then pg_ctlcluster 16 main start || true; wait_ready || true
      elif can_sudo; then sudo -n pg_ctlcluster 16 main start || true; wait_ready || true
      fi
      ready || { echo "PostgreSQL is installed but not running on port ${PGPORT}. Start it with: sudo service postgresql start" >&2; exit 1; }
    else
      echo "No Docker and no local PostgreSQL 16 found. Install one of them first." >&2; exit 1
    fi
    ensure_roles
    echo "PostgreSQL ready: postgres://sim:${DEV_PASSWORD}@127.0.0.1:${PGPORT}/sim_dev"
    ;;
  stop)
    if use_docker && docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then docker stop "$CONTAINER" >/dev/null
    elif command -v pg_ctlcluster >/dev/null 2>&1; then
      if is_root; then pg_ctlcluster 16 main stop || true
      elif can_sudo; then sudo -n pg_ctlcluster 16 main stop || true
      else echo "Stop it with: sudo service postgresql stop" >&2; exit 1
      fi
    fi
    echo "stopped"
    ;;
  status)
    pg_isready -h 127.0.0.1 -p "$PGPORT" || exit 1
    ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
