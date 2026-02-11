#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
#  Oligool – one-click launcher (macOS / Linux)
# ──────────────────────────────────────────────────────────
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# ── colours ────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}▸${NC} $1"; }
ok()    { echo -e "${GREEN}✔${NC} $1"; }
fail()  { echo -e "${RED}✖ $1${NC}"; exit 1; }

# ── prerequisite checks ───────────────────────────────────
command -v python3 >/dev/null 2>&1 || fail "Python 3 is required but not found. Install from https://python.org"
command -v node    >/dev/null 2>&1 || fail "Node.js is required but not found. Install from https://nodejs.org"
command -v npm     >/dev/null 2>&1 || fail "npm is required but not found. Install Node.js from https://nodejs.org"

ok "Python $(python3 --version 2>&1 | awk '{print $2}')"
ok "Node   $(node --version)"

# ── Python virtual-env & dependencies ─────────────────────
if [ ! -d "$ROOT/.venv" ]; then
    info "Creating Python virtual environment…"
    python3 -m venv "$ROOT/.venv"
fi
source "$ROOT/.venv/bin/activate"
info "Installing Python dependencies…"
pip install -q -r "$ROOT/backend/requirements.txt"
ok "Python packages ready"

# ── Node dependencies ─────────────────────────────────────
if [ ! -d "$ROOT/frontend/node_modules" ]; then
    info "Installing Node dependencies (first run)…"
    (cd "$ROOT/frontend" && npm install)
fi
ok "Node packages ready"

# ── cleanup on exit ───────────────────────────────────────
BACKEND_PID=""
FRONTEND_PID=""
cleanup() {
    echo ""
    info "Shutting down…"
    [ -n "$BACKEND_PID"  ] && kill "$BACKEND_PID"  2>/dev/null && ok "Backend stopped"
    [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null && ok "Frontend stopped"
    exit 0
}
trap cleanup INT TERM

# ── start backend ─────────────────────────────────────────
info "Starting backend on http://localhost:8000 …"
(cd "$ROOT" && python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000) &
BACKEND_PID=$!

# ── start frontend ────────────────────────────────────────
info "Starting frontend on http://localhost:5173 …"
(cd "$ROOT/frontend" && npm run dev -- --host 0.0.0.0) &
FRONTEND_PID=$!

# ── wait a moment then open the browser ───────────────────
sleep 3
info "Opening browser…"
if command -v open >/dev/null 2>&1; then
    open "http://localhost:5173"
elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:5173"
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Oligool is running!                          ║${NC}"
echo -e "${GREEN}║  Frontend → http://localhost:5173              ║${NC}"
echo -e "${GREEN}║  Backend  → http://localhost:8000              ║${NC}"
echo -e "${GREEN}║  Press Ctrl+C to stop                         ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════╝${NC}"
echo ""

# keep alive until Ctrl+C
wait
