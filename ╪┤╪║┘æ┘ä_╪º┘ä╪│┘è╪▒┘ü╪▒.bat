@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Story Mode Server
echo.
echo ========================================
echo   Story Mode - تشغيل السيرفر
echo ========================================
echo.

set "PYEXE="
where python >nul 2>&1 && set "PYEXE=python"
if not defined PYEXE (
  where py >nul 2>&1 && set "PYEXE=py -3"
)

if defined PYEXE goto run_server

echo [!] Python مش موجود — هنثبته تلقائي...
echo.

set "INSTALLER=%~dp0python-installer.exe"
if not exist "%INSTALLER%" (
  echo جاري تحميل Python من الموقع الرسمي...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe' -OutFile '%INSTALLER%' -UseBasicParsing } catch { exit 1 }"
  if errorlevel 1 (
    echo.
    echo فشل التحميل. تأكد من الإنترنت أو ثبت يدويا من:
    echo https://www.python.org/downloads/
    echo وفعّل: Add python.exe to PATH
    echo.
    pause
    exit /b 1
  )
)

echo جاري التثبيت (دقيقة أو دقيقتين)...
"%INSTALLER%" /quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 Include_test=0 SimpleInstall=1
if errorlevel 1 (
  echo.
  echo فشل التثبيت الصامت — هنفتح المثبت العادي...
  start /wait "" "%INSTALLER%"
)

echo.
echo تحديث PATH...
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
  echo.
  echo Python لسه مش ظاهر. اقفل النافذة وافتح START_SERVER.bat من جديد بعد التثبيت.
  echo.
  pause
  exit /b 1
)

echo تم العثور على Python.
echo.

:run_server
echo تشغيل lan_host.py ...
echo.
%PYEXE% lan_host.py
echo.
echo السيرفر اتوقف.
pause
