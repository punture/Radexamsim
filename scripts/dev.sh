#!/usr/bin/env bash
# Local development: database, migrations, seed, then API (:4000), worker and web (:3000).
# Uses development fixtures and dev-only settings; never point this at production data.
set -euo pipefail
cd "$(dirname "$0")/.."
# Load a local .env if present (never commit it), then development-only defaults.
if [ -f .env ]; then set -a; . ./.env; set +a; fi
export NODE_ENV="${NODE_ENV:-development}"
if [ "$NODE_ENV" = "production" ]; then echo "scripts/dev.sh is for local development only" >&2; exit 1; fi
# Without model keys, results come from the labelled development baseline assessor.
export ALLOW_DEV_BASELINE_ASSESSOR="${ALLOW_DEV_BASELINE_ASSESSOR:-true}"
export DATABASE_URL="${DATABASE_URL:-postgres://sim:sim_dev_password@127.0.0.1:5432/sim_dev}"
bash scripts/dev-db.sh start
pnpm db:migrate
pnpm db:seed
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM
pnpm dev:api & pids+=($!)
pnpm dev:worker & pids+=($!)
pnpm dev:web & pids+=($!)
echo "Web http://localhost:3000 · API http://localhost:4000 (Ctrl-C stops all)"
wait
