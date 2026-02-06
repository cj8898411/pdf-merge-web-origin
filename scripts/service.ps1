param(
  [ValidateSet("install", "uninstall", "start", "stop", "restart", "status", "logs")]
  [string]$Action = "status"
)

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$NssmExe = Join-Path $ProjectRoot "tools\nssm.exe"
$ServiceName = "cj_account_easy"
$DisplayName = "cj account easy"
$LogDir = Join-Path $ProjectRoot "logs"
$LogFile = Join-Path $LogDir "server.log"

function Ensure-Nssm {
  if (-not (Test-Path $NssmExe)) {
    Write-Host "nssm.exe not found at $NssmExe"
    Write-Host "Run scripts\\setup_nssm.ps1 first."
    exit 1
  }
}

function Resolve-Python {
  $venvPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
  if (Test-Path $venvPython) { return $venvPython }
  return "python"
}

function Ensure-LogDir {
  if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir | Out-Null
  }
}

function Install-Service {
  Ensure-Nssm
  $python = Resolve-Python
  Ensure-LogDir
  $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "Service already installed: $ServiceName"
    return
  }
  & $NssmExe install $ServiceName $python "server\\app.py"
  & $NssmExe set $ServiceName AppDirectory $ProjectRoot
  & $NssmExe set $ServiceName DisplayName $DisplayName
  & $NssmExe set $ServiceName AppStdout $LogFile
  & $NssmExe set $ServiceName AppStderr $LogFile
  & $NssmExe set $ServiceName AppRotateFiles 1
  & $NssmExe set $ServiceName AppRotateOnline 1
  & $NssmExe set $ServiceName AppRotateBytes 10485760
  & $NssmExe set $ServiceName AppRotateSeconds 86400
  Write-Host "Installed service: $ServiceName"
}

function Uninstall-Service {
  Ensure-Nssm
  $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if (-not $existing) {
    Write-Host "Service not installed: $ServiceName"
    return
  }
  & $NssmExe stop $ServiceName | Out-Null
  & $NssmExe remove $ServiceName confirm
  Write-Host "Removed service: $ServiceName"
}

function Start-ServiceSafe {
  Ensure-Nssm
  & $NssmExe start $ServiceName
}

function Stop-ServiceSafe {
  Ensure-Nssm
  & $NssmExe stop $ServiceName
}

function Restart-ServiceSafe {
  Stop-ServiceSafe
  Start-ServiceSafe
}

function Show-Status {
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if (-not $svc) {
    Write-Host "Service not installed: $ServiceName"
    return
  }
  Write-Host ("{0}: {1}" -f $ServiceName, $svc.Status)
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
  "install" { Install-Service }
  "uninstall" { Uninstall-Service }
  "start" { Start-ServiceSafe }
  "stop" { Stop-ServiceSafe }
  "restart" { Restart-ServiceSafe }
  "status" { Show-Status }
  "logs" { Tail-Logs }
}
