@echo off
setlocal
cd /d "%~dp0"
title Render Studio
if not exist ".venv\Scripts\python.exe" (
  call "%~dp0Install Render Studio.cmd"
  exit /b %errorlevel%
)
start "" powershell.exe -NoLogo -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8001/'"
".venv\Scripts\python.exe" run.py
if errorlevel 1 pause
