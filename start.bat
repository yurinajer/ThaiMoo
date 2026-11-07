@echo off
echo ========================================
echo   Thai Learning App - Start
echo ========================================
echo.

set NODE_DIR=C:\Users\86186\Documents\Qoder\2026-11-07\1b422ce1\node-portable\node-v22.16.0-win-x64
set PATH=%NODE_DIR%;%PATH%

cd /d "%~dp0"

echo [1/3] Checking Node.js...
"%NODE_DIR%\node.exe" --version
if errorlevel 1 (
    echo ERROR: Node.js not found
    pause
    exit /b 1
)

echo.
echo [2/3] Checking dependencies...
if not exist "node_modules" (
    echo Installing dependencies...
    "%NODE_DIR%\npm.cmd" install
)

echo.
echo [3/3] Starting dev server...
echo.
echo ========================================
echo   Open browser to: http://localhost:5173
echo   Press Ctrl+C to stop
echo ========================================
echo.

"%NODE_DIR%\npm.cmd" run dev

pause
