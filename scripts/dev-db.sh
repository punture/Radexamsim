#!/usr/bin/env bash
# Local PostgreSQL for development and tests.
#   bash scripts/dev-db.sh start   # start (Docker if available, else a local PostgreSQL 16 cluster)
#   bash scripts/dev-db.sh stop
#   bash scripts/dev-db.sh status
# Creates role "sim" (development password only) and databases sim_dev / sim_test.
# Never use these credentials outside local development.
set -euo pipefail
ACTION="${1:-start}"
PGPORT="${PGPORT:-5432}"
CONTAINER="sim-postgres"
DEV_PASSWORD="sim_dev_password"

use_docker() { command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; }

# Runs one SQL statement as the PostgreSQL superuser, however the server was started.
run_sql() {
  local sql="$1"
  if use_docker && docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    docker exec -i "$CONTAINER" psql -U postgres -tAc "$sql"
  elif id postgres >/dev/null 2>&1; then
    su postgres -c "psql -p ${PGPORT} -tAc \"${sql//\"/\\\"}\""
  else
    psql -h 127.0.0.1 -p "$PGPORT" -U postgres -tAc "$sql"
  fi
}

ensure_roles() {
  run_sql "SELECT 1 FROM pg_roles WHERE rolname='sim'" | grep -q 1 \
    || run_sql "CREATE ROLE sim LOGIN CREATEDB PASSWORD '${DEV_PASSWORD}'"
  for db in sim_dev sim_test; do
    run_sql "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1 \
      || run_sql "CREATE DATABASE ${db} OWNER sim"
  done
}

case "$ACTION" in
  start)
    if pg_isready -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1; then
      echo "PostgreSQL already accepting connections on ${PGPORT}."
    elif use_docker; then
      if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then docker start "$CONTAINER" >/dev/null
      else docker run -d --name "$CONTAINER" -p "127.0.0.1:${PGPORT}:5432" -e POSTGRES_PASSWORD="$DEV_PASSWORD" -v sim-postgres-data:/var/lib/postgresql/data postgres:16 >/dev/null
      fi
      for _ in $(seq 1 30); do pg_isready -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1 && break; sleep 1; done
    elif command -v pg_ctlcluster >/dev/null 2>&1; then
      pg_ctlcluster 16 main start || true
      for _ in $(seq 1 30); do pg_isready -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1 && break; sleep 1; done
    else
      echo "No Docker and no local PostgreSQL 16 found. Install one of them first." >&2; exit 1
    fi
    ensure_roles
    echo "PostgreSQL ready: postgres://sim:${DEV_PASSWORD}@127.0.0.1:${PGPORT}/sim_dev"
    ;;
  stop)
    if use_docker && docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then docker stop "$CONTAINER" >/dev/null
    elif command -v pg_ctlcluster >/dev/null 2>&1; then pg_ctlcluster 16 main stop || true
    fi
    echo "stopped"
    ;;
  status)
    pg_isready -h 127.0.0.1 -p "$PGPORT" || exit 1
    ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
