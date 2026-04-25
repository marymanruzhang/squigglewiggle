#!/usr/bin/env bash
# Double-click is not supported in all terminals; run from Terminal: ./start.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
VENV="$ROOT/.venv"
if [[ ! -x "$VENV/bin/python" ]]; then
  echo "Creating virtual environment and installing dependencies (first run may take a few minutes)…"
  python3 -m venv "$VENV"
  # shellcheck source=/dev/null
  . "$VENV/bin/activate"
  pip install -U pip -q
  pip install -r requirements.txt
else
  # shellcheck source=/dev/null
  . "$VENV/bin/activate"
fi
echo ""
echo "  → Open in your browser:  http://localhost:5001"
echo ""
exec python app.py
