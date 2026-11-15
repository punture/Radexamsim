#!/usr/bin/env bash
# Local development: database, migrations, seed, then API (:4000), worker and web (:3000).
# Uses development fixtures and dev-only settings; never point this at production data.
set -euo pipefail
cd "$(dirname "$0")/.."
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
