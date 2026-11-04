@echo off
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo Python was not found.
  echo Install Python from https://www.python.org/downloads/
  echo During install, check "Add python.exe to PATH".
  echo.
  pause
  exit /b 1
)
python server.py
if errorlevel 1 pause
