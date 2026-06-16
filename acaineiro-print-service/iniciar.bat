@echo off
title Açaineiro - Serviço de Impressão
cd /d "%~dp0"

if not exist "node_modules\" (
  echo.
  echo ========================================
  echo    🖨️  AÇAINEIRO - Serviço de Impressão
  echo ========================================
  echo.
  echo 📦 Instalando dependencias (primeira vez)...
  call npm install
)

echo.
echo ========================================
echo    🖨️  AÇAINEIRO - Serviço de Impressão
echo ========================================
echo.
echo 🔄 Monitorando pedidos...
echo 📋 Admin local: http://localhost:3099/admin
echo    Feche esta janela para parar
echo.
node print-agent.js
pause
