@echo off
setlocal
title LINEOA 一鍵更新
PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-LINEOA.ps1"
if errorlevel 1 (
  echo.
  echo LINEOA 更新失敗，請將上方錯誤畫面提供給管理者。
)
echo.
pause
