@echo off
REM ──────────────────────────────────────────────────────────
REM  Oligool – one-click launcher (Windows)
REM ──────────────────────────────────────────────────────────
setlocal enabledelayedexpansion
title Oligool

set "ROOT=%~dp0"
cd /d "%ROOT%"

REM ── prerequisite checks ──────────────────────────────────
where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is required but not found. Install from https://python.org
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is required but not found. Install from https://nodejs.org
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm is required but not found. Install Node.js from https://nodejs.org
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo [OK] %%v
for /f "tokens=*" %%v in ('node --version 2^>^&1') do echo [OK] Node %%v

REM ── Python virtual-env & dependencies ────────────────────
if not exist "%ROOT%.venv" (
    echo [..] Creating Python virtual environment...
    python -m venv "%ROOT%.venv"
)
call "%ROOT%.venv\Scripts\activate.bat"
echo [..] Installing Python dependencies...
pip install -q -r "%ROOT%backend\requirements.txt"
echo [OK] Python packages ready

REM ── Node dependencies ────────────────────────────────────
if not exist "%ROOT%frontend\node_modules" (
    echo [..] Installing Node dependencies (first run)...
    cd /d "%ROOT%frontend"
    call npm install
    cd /d "%ROOT%"
)
echo [OK] Node packages ready

REM ── start backend ────────────────────────────────────────
echo [..] Starting backend on http://localhost:8000 ...
start "Oligool-Backend" /min cmd /c "cd /d "%ROOT%" && "%ROOT%.venv\Scripts\python.exe" -m uvicorn backend.main:app --host 0.0.0.0 --port 8000"

REM ── start frontend ───────────────────────────────────────
echo [..] Starting frontend on http://localhost:5173 ...
start "Oligool-Frontend" /min cmd /c "cd /d "%ROOT%frontend" && npm run dev -- --host 0.0.0.0"

REM ── open browser after a short delay ─────────────────────
timeout /t 4 /nobreak >nul
start http://localhost:5173

echo.
echo ╔═══════════════════════════════════════════════╗
echo ║  Oligool is running!                          ║
echo ║  Frontend → http://localhost:5173              ║
echo ║  Backend  → http://localhost:8000              ║
echo ║  Close this window to stop                    ║
echo ╚═══════════════════════════════════════════════╝
echo.
echo Press any key to stop all servers and exit...
pause >nul

REM ── cleanup ──────────────────────────────────────────────
echo [..] Shutting down...
taskkill /fi "WINDOWTITLE eq Oligool-Backend*" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq Oligool-Frontend*" /f >nul 2>&1
echo [OK] Stopped.
