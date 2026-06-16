param(
  [string]$Caminho = "",
  [switch]$Remover
)

$ErrorActionPreference = "Stop"
$scriptDir = if ($Caminho) { $Caminho } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$agentScript = Join-Path $scriptDir "print-agent.js"
$node = (Get-Command node).Source

if (-not $node) {
  Write-Host "❌ Node.js não encontrado! Instale em https://nodejs.org"
  exit 1
}

$taskName = "AcaineiroPrintService"
$batPath = Join-Path $scriptDir "iniciar.bat"

if ($Remover) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "✅ Serviço removido!"
  exit
}

# Já rodou npm install?
if (-not (Test-Path (Join-Path $scriptDir "node_modules"))) {
  Write-Host "📦 Instalando dependencias..."
  Push-Location $scriptDir
  npm install
  Pop-Location
}

# Criar ação: executar o bat (mais simples)
$action = New-ScheduledTaskAction -Execute $batPath -WorkingDirectory $scriptDir

# Executar no login do usuário
$trigger = New-ScheduledTaskTrigger -AtLogOn

# Opções: reiniciar se falhar
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

# Criar tarefa
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited -Force

Write-Host "✅ Serviço instalado! Vai iniciar automaticamente no próximo login."
Write-Host "📌 Para testar agora, execute:"
Write-Host "   Start-ScheduledTask -TaskName '$taskName'"
Write-Host ""
Write-Host "❌ Para remover:"
Write-Host "   .\instalar-servico.ps1 -Remover"
