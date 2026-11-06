@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   AgentHub - local dev server
echo   Folder: %CD%
echo ============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found on your PATH.
  echo         Install it from https://nodejs.org/ then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [setup] node_modules not found - installing dependencies ^(first run only^)...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed. Check your internet connection and retry.
    pause
    exit /b 1
  )
  echo.
)

echo [run] Starting the dev server...
echo       URL:  http://localhost:3000
echo       Stop: press Ctrl+C in this window
echo.
start "" "http://localhost:3000"
call npm run dev

echo.
echo Dev server stopped.
pause
