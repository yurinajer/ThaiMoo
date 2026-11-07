@echo off
echo ========================================
echo   Thai Learning App - Deploy to GitHub
echo ========================================
echo.

set GIT_DIR=C:\Users\86186\.qoder-cn\bin\git\mingw64\bin
set PATH=%GIT_DIR%;%PATH%

cd /d "%~dp0"

echo [1/4] Initializing git repo...
"%GIT_DIR%\git.exe" init
"%GIT_DIR%\git.exe" add .
"%GIT_DIR%\git.exe" commit -m "Initial commit: Thai learning PWA"
"%GIT_DIR%\git.exe" branch -M main

echo.
echo [2/4] Adding GitHub remote...
echo Please enter your GitHub username:
set /p GITHUB_USER=
"%GIT_DIR%\git.exe" remote add origin https://github.com/%GITHUB_USER%/thai-learn.git

echo.
echo [3/4] Pushing to GitHub...
echo (A login window will pop up - use your GitHub account)
"%GIT_DIR%\git.exe" push -u origin main

echo.
echo [4/4] Done!
echo.
echo Next steps:
echo 1. Go to https://pages.cloudflare.com
echo 2. Create a project and connect to your GitHub repo
echo 3. Build command: npm run build
echo 4. Build output directory: dist
echo.
pause
