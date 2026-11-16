#!/usr/bin/env bash
# One-command case intake for the owner's computer (no cloud tokens needed).
#
#   pnpm intake "<path to a folder with one subfolder per case, or a .zip>" [batch-name]
#
# Examples with Box Drive:
#   macOS:          pnpm intake "$HOME/Library/CloudStorage/Box-Box/Neuro Oral Simulator - Intake batch 1"
#   Windows (WSL):  pnpm intake "/mnt/c/Users/<you>/Box/Neuro Oral Simulator - Intake batch 1"
#
# Steps:
#   1. Copy the raw files into a private, git-ignored quarantine folder.
#   2. Screen them (identifier text, metadata, OCR for burned-in names, numbers and dates).
#   3. Build one draft package per case folder.
#   4. Import only the packages with no high-severity finding, as DRAFT cases.
# Nothing is approved or published. Held-back cases are listed for the owner's decision.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:?usage: pnpm intake <case-folder-or-zip> [batch-name]}"
BATCH="quarantine/${2:-batch-$(date +%Y%m%d-%H%M%S)}"
PY=tools/ingestion/.venv/bin/python
if ! "$PY" -I -c 'import ingest' >/dev/null 2>&1; then
  echo "Setting up the ingestion tool's Python environment (one time)..."
  # Recreate a venv that an earlier failed attempt left without pip (Ubuntu before python3-venv).
  "$PY" -I -m pip --version >/dev/null 2>&1 || python3 -m venv --clear tools/ingestion/.venv
  "$PY" -m pip install -q -r tools/ingestion/requirements.txt
  "$PY" -m pip install -q --no-deps -e tools/ingestion
fi
command -v tesseract >/dev/null 2>&1 || echo "Note: OCR (tesseract) is not installed, so burned-in text is NOT checked. Install it first (macOS: brew install tesseract; Ubuntu or WSL: sudo apt install tesseract-ocr)."
# Case ids are unique per batch (e.g. batch-20261115-1012-03), so batches never collide.
PREFIX="$(basename "$BATCH" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-' '-' | sed -E 's/-+/-/g; s/^-|-$//g' | cut -c1-60)"
"$PY" -I tools/ingestion/scripts/intake_by_folder.py --src "$SRC" --batch "$BATCH" --case-prefix "$PREFIX"
CLEAN=()  # bash 3.2 compatible (macOS default shell): no mapfile
while IFS= read -r z; do [ -n "$z" ] && CLEAN+=("$z"); done < <("$PY" -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print("\n".join(c["zip"] for c in d["cases"] if c["privacyStatus"]=="checked"))' "$BATCH/intake-summary.json")
if [ "${#CLEAN[@]}" -eq 0 ]; then
  echo "No package passed screening; nothing imported. Review the findings in $BATCH/."
  exit 0
fi
ABS=()
for z in "${CLEAN[@]}"; do ABS+=("$(cd "$(dirname "$z")" && pwd)/$(basename "$z")"); done
pnpm --silent --filter @sim/api run import-cases "${ABS[@]}" || true
echo "Done. Open the owner console (Cases) to review the drafts. Raw files stay in $BATCH (git-ignored)."
