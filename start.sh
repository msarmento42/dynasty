#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_PORT="${API_PORT:-8001}"

cd "$ROOT_DIR"

if [ ! -d "frontend/node_modules" ]; then
  echo "Frontend dependencies are missing. Run: cd frontend && npm install"
  exit 1
fi

if ! python3 -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  echo "Backend dependencies are missing. Run: pip install -r requirements.txt"
  exit 1
fi

cleanup() {
  if [ -n "${BACKEND_PID:-}" ]; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

echo "Starting Dynasty backend on http://localhost:${API_PORT}"
python3 -m uvicorn backend.main:app --port "$API_PORT" &
BACKEND_PID=$!

echo "Starting Dynasty frontend on http://localhost:5173"
cd frontend
VITE_API_PORT="$API_PORT" npm run dev
