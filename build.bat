@echo off
set PATH=C:\Users\86186\Documents\Qoder\2026-11-07\1b422ce1\node-portable\node-v22.16.0-win-x64;%PATH%
cd /d C:\Users\86186\Documents\Qoder\2026-11-07\1b422ce1\thai-learn
echo Installing dependencies...
call npm install
echo.
echo Building project...
call npm run build
echo.
echo Done!
pause
