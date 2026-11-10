@echo off
setlocal
cd /d "%~dp0"
node "app\preview-v2.mjs" %*
if errorlevel 1 pause
