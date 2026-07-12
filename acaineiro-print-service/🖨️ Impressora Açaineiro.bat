@echo off
title Açaineiro - Serviço de Impressão
cd /d "%~dp0"

if not exist "node_modules\" (
  echo Instalando dependencias...
  call npm install
)

echo Iniciando servico de impressao...
wscript.exe "%~dp0start-agent.vbs"
exit
