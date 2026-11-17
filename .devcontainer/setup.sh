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

PNPM_VERSION="$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '').split('+')[0]")"
echo "Installing pnpm ${PNPM_VERSION}..."
npm install -g "pnpm@${PNPM_VERSION}" || sudo npm install -g "pnpm@${PNPM_VERSION}"
pnpm install --frozen-lockfile
echo "Setup finished. The app starts with the codespace; its log is var/log/codespace-dev.log."
