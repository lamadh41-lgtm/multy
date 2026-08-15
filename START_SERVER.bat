@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Story Mode Server
echo.
echo ========================================
echo   Story Mode Server
echo ========================================
echo.

set "PYEXE="
where python >nul 2>&1 && set "PYEXE=python"
if not defined PYEXE (
  where py >nul 2>&1 && set "PYEXE=py -3"
)

if defined PYEXE goto run_server

echo [!] Python not found — installing automatically...
echo.

set "INSTALLER=%~dp0python-installer.exe"
if not exist "%INSTALLER%" (
  echo Downloading Python from python.org ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe' -OutFile '%INSTALLER%' -UseBasicParsing } catch { exit 1 }"
  if errorlevel 1 (
    echo Download failed. Install manually from https://www.python.org/downloads/
    echo Enable: Add python.exe to PATH
    pause
    exit /b 1
  )
)

echo Installing (1-2 minutes)...
"%INSTALLER%" /quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 Include_test=0 SimpleInstall=1
if errorlevel 1 (
  echo Silent install failed — opening normal installer...
  start /wait "" "%INSTALLER%"
)

set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;%ProgramFiles%\Python312;%ProgramFiles%\Python312\Scripts;%PATH%"

set "PYEXE="
where python >nul 2>&1 && set "PYEXE=python"
if not defined PYEXE (
  if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PYEXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
)
if not defined PYEXE (
  if exist "%ProgramFiles%\Python312\python.exe" set "PYEXE=%ProgramFiles%\Python312\python.exe"
)
if not defined PYEXE (
  where py >nul 2>&1 && set "PYEXE=py -3"
)

if not defined PYEXE (
  echo Python still not found. Close and reopen START_SERVER.bat after install.
  pause
  exit /b 1
)

:run_server
echo Starting lan_host.py ...
echo.
%PYEXE% lan_host.py
echo.
echo Server stopped.
pause
