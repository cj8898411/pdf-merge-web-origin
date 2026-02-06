param(
  [string]$NssmPath = ""
)

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$TargetPath = Join-Path $ProjectRoot "tools\nssm.exe"

if (-not $NssmPath) {
  $NssmPath = Read-Host "Enter full path to nssm.exe"
}

if (-not (Test-Path $NssmPath)) {
  Write-Host "nssm.exe not found: $NssmPath"
  exit 1
}

Copy-Item -Path $NssmPath -Destination $TargetPath -Force
Write-Host "Copied to $TargetPath"
