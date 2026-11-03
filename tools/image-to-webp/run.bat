@echo off
setlocal
cd /d "%~dp0..\.."

if not exist "node_modules\sharp" (
  echo sharp 모듈이 없습니다. 저장소 루트에서 npm install 을 실행하세요.
  pause
  exit /b 1
)

node "%~dp0convert.js" %*

if "%~1"=="" pause
