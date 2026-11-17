#!/usr/bin/env bash
# Runs once, when the codespace is created (postCreateCommand), on GitHub's machine:
# PostgreSQL 16 from the PostgreSQL project's Debian repository, pnpm (the version pinned in
# package.json) and the workspace packages. See docs/runbooks/CODESPACES.md.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -x /usr/lib/postgresql/16/bin/postgres ]; then
  echo "Installing PostgreSQL 16..."
  sudo install -d /usr/share/postgresql-common/pgdg
  sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  . /etc/os-release
  sudo tee /etc/apt/sources.list.d/pgdg.sources >/dev/null <<EOF
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: ${VERSION_CODENAME}-pgdg
Architectures: $(dpkg --print-architecture)
Components: main
Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
EOF
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends postgresql-16
fi
# The package normally creates the "16 main" cluster; create it if it did not.
pg_lsclusters --no-header | grep -qE '^16[[:space:]]+main[[:space:]]' || sudo pg_createcluster 16 main

# The development role "sim" (development password only). scripts/dev-db.sh would create it with
# "sudo -u postgres", which this container's sudo rule (root only) refuses; runuser works.
sudo pg_ctlcluster 16 main start 2>/dev/null || true
for _ in $(seq 1 30); do pg_isready -q -h 127.0.0.1 -p 5432 && break; sleep 1; done
as_postgres() { (cd / && sudo runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tAc "$1"); }
as_postgres "SELECT 1 FROM pg_roles WHERE rolname = 'sim'" | grep -qx 1 \
  || as_postgres "CREATE ROLE sim LOGIN CREATEDB PASSWORD 'sim_dev_password'"

PNPM_VERSION="$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '').split('+')[0]")"
echo "Installing pnpm ${PNPM_VERSION}..."
npm install -g "pnpm@${PNPM_VERSION}" || sudo npm install -g "pnpm@${PNPM_VERSION}"
pnpm install --frozen-lockfile
echo "Setup finished. The app starts with the codespace; its log is var/log/codespace-dev.log."
