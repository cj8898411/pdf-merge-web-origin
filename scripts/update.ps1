param(
  [Parameter(Mandatory=$true)]
  [string]$PackagePath
)

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ServiceName = "cj_account_easy"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupPath = Join-Path $ProjectRoot ("pdf-merge-web_" + $Timestamp)

function Stop-ServiceIfRunning {
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -ne "Stopped") {
    Stop-Service -Name $ServiceName -Force
    $svc.WaitForStatus("Stopped", "00:00:30") | Out-Null
  }
}

function Start-ServiceIfInstalled {
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -ne "Running") {
    Start-Service -Name $ServiceName
  }
}

function Backup-Current {
  $excludeDirs = @(".git", ".venv")
  $args = @($ProjectRoot, $BackupPath, "/E")
  foreach ($d in $excludeDirs) { $args += @("/XD", $d) }
  robocopy @args | Out-Null
}

function Copy-Update($SourcePath) {
  $excludeDirs = @(".git", ".venv", "logs", "uploads", "merged", "tools")
  $args = @($SourcePath, $ProjectRoot, "/E")
  foreach ($d in $excludeDirs) { $args += @("/XD", $d) }
  robocopy @args | Out-Null
}

if (-not (Test-Path $PackagePath)) {
  Write-Host "Package not found: $PackagePath"
  exit 1
}

Stop-ServiceIfRunning
Backup-Current

$SourcePath = $PackagePath
$TempDir = ""

if ($PackagePath.ToLower().EndsWith(".zip")) {
  $TempDir = Join-Path $env:TEMP ("pdf-merge-web_update_" + $Timestamp)
  New-Item -ItemType Directory -Path $TempDir | Out-Null
  Expand-Archive -Path $PackagePath -DestinationPath $TempDir -Force
  $SourcePath = $TempDir
}

Copy-Update $SourcePath

if ($TempDir -and (Test-Path $TempDir)) {
  Remove-Item -Path $TempDir -Recurse -Force
}

Start-ServiceIfInstalled
Write-Host "Update complete."
