param(
  [ValidateSet("start", "stop", "status", "logs", "tail")]
  [string]$Action = "status"
)

$ScriptBase = if ($PSScriptRoot) { $PSScriptRoot } elseif ($PSCommandPath) { Split-Path -Parent $PSCommandPath } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { [System.AppDomain]::CurrentDomain.BaseDirectory }
$ProjectRoot = if ($ScriptBase -and (Split-Path -Leaf $ScriptBase) -eq "scripts") { Split-Path -Parent $ScriptBase } else { $ScriptBase }
$LogDir = Join-Path $ProjectRoot "logs"
$LogFile = Join-Path $LogDir "server.log"
$ErrLogFile = Join-Path $LogDir "server.err.log"
$PidFile = Join-Path $LogDir "server.pid"
$VenvPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

function Ensure-LogDir {
  if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir | Out-Null
  }
}

function Resolve-Python {
  if (Test-Path $VenvPython) { return $VenvPython }
  $py = Get-Command python -ErrorAction SilentlyContinue
  if ($py) { return "python" }
  Write-Host "Python not found. Install Python or create .venv first."
  exit 1
}

function Start-Server {
  Ensure-LogDir
  if (Test-Path $PidFile) {
    $procId = Get-Content $PidFile -ErrorAction SilentlyContinue
    if ($procId -and (Get-Process -Id $procId -ErrorAction SilentlyContinue)) {
      Write-Host "Already running. PID: $procId"
      return
    }
    Remove-Item $PidFile -ErrorAction SilentlyContinue
  }

  $python = Resolve-Python
  $args = @("server\app.py")
  $proc = Start-Process -FilePath $python -ArgumentList $args -WorkingDirectory $ProjectRoot `
    -NoNewWindow -RedirectStandardOutput $LogFile -RedirectStandardError $ErrLogFile -PassThru

  Set-Content -Path $PidFile -Value $proc.Id
  Write-Host "Started. PID: $($proc.Id)"
}

function Stop-Server {
  if (-not (Test-Path $PidFile)) {
    Write-Host "No PID file. Not running?"
    return
  }
  $procId = Get-Content $PidFile -ErrorAction SilentlyContinue
  if (-not $procId) {
    Write-Host "PID file empty."
    return
  }
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($proc) {
    Stop-Process -Id $procId -Force
    Write-Host "Stopped. PID: $procId"
  } else {
    Write-Host "Process not found. Cleaning PID file."
  }
  Remove-Item $PidFile -ErrorAction SilentlyContinue
}

function Show-Status {
  if (-not (Test-Path $PidFile)) {
    Write-Host "Stopped"
    return
  }
  $procId = Get-Content $PidFile -ErrorAction SilentlyContinue
  if ($procId -and (Get-Process -Id $procId -ErrorAction SilentlyContinue)) {
    Write-Host "Running. PID: $procId"
  } else {
    Write-Host "Stopped"
  }
}

function Show-Logs {
  Ensure-LogDir
  if (-not (Test-Path $LogFile)) {
    Write-Host "Log file not found: $LogFile"
    return
  }
  Get-Content -Path $LogFile -Tail 200
}

function Tail-Logs {
  Ensure-LogDir
  if (-not (Test-Path $LogFile)) {
    Write-Host "Log file not found: $LogFile"
    return
  }
  Get-Content -Path $LogFile -Tail 200 -Wait
}

switch ($Action) {
  "start" { Start-Server }
  "stop" { Stop-Server }
  "status" { Show-Status }
  "logs" { Show-Logs }
  "tail" { Tail-Logs }
}
