@echo off
setlocal
cd /d "%~dp0"
where pnpm >nul 2>nul
if errorlevel 1 (
  echo Install Node.js and pnpm, or use the packaged executable in the release folder.
  pause
  exit /b 1
)
call pnpm start
if errorlevel 1 pause
