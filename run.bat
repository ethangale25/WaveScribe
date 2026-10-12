@echo off
rem One-click launcher: installs dependencies on first run, then starts WaveScribe in dev mode.
cd /d "%~dp0"
if not exist node_modules call npm install || exit /b 1
call npm run dev
