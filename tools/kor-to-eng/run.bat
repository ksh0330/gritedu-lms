@echo off
setlocal
cd /d "%~dp0..\.."

node "%~dp0convert.js" %*

if "%~1"=="" pause
