param(
  [string]$Caminho = "",
  [switch]$Remover
)

$ErrorActionPreference = "Stop"
$scriptDir = if ($Caminho) { $Caminho } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$taskName = "AcaineiroPrintService"

if ($Remover) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Servico removido!"
  exit
}

# Verificar Node.js
$node = (Get-Command node).Source
if (-not $node) {
  Write-Host "Node.js nao encontrado! Instale em https://nodejs.org"
  exit 1
}

# Instalar dependencias se necessario
if (-not (Test-Path (Join-Path $scriptDir "node_modules"))) {
  Write-Host "Instalando dependencias..."
  Push-Location $scriptDir
  npm install
  Pop-Location
}

# A VBS roda sem janela
$vbsPath = Join-Path $scriptDir "start-agent.vbs"
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbsPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited -Force

Write-Host "Servico instalado! Inicia automaticamente no login."
Write-Host ""
Write-Host "Iniciar agora:     Start-ScheduledTask '$taskName'"
Write-Host "Parar agora:       Stop-ScheduledTask '$taskName'"
Write-Host "Remover:           .\instalar-servico.ps1 -Remover"
