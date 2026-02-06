param(
  [string]$OutputPath = ""
)

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Source = Join-Path $ProjectRoot "scripts\launcher.ps1"
if (-not (Test-Path $Source)) {
  Write-Host "Source not found: $Source"
  exit 1
}

if (-not $OutputPath) {
  $OutputPath = Join-Path $ProjectRoot "launcher.exe"
}

if (-not (Get-Module -ListAvailable -Name ps2exe)) {
  Write-Host "ps2exe module not found. Installing for current user..."
  try {
    Install-Module -Name ps2exe -Scope CurrentUser -Force -AllowClobber
  } catch {
    Write-Host "Failed to install ps2exe: $($_.Exception.Message)"
    exit 1
  }
}

Import-Module ps2exe -ErrorAction Stop

Invoke-ps2exe -inputFile $Source -outputFile $OutputPath -noConsole
Write-Host "Built: $OutputPath"
