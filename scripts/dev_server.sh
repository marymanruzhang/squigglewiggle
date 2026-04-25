#!/usr/bin/env bash
# From repo root. Uses .venv; create with: python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if ! [[ -x "$ROOT/.venv/bin/python" ]]; then
  echo "Create venv first: python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt" >&2
  exit 1
fi
# shellcheck source=/dev/null
. "$ROOT/.venv/bin/activate"
export FLASK_DEBUG="${FLASK_DEBUG:-1}"
exec python app.py
