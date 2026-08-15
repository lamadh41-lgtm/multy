@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Story Mode - فتح اللعبة
echo.
echo كل جهاز بياخد منفذ/رابط مختلف تلقائي.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve_game.ps1"
echo.
pause
