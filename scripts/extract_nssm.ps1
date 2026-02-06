param(
  [string]$PackagePath = ""
)

$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $PackagePath) {
  $PackagePath = Join-Path $ProjectRoot "tools\nssm.nupkg"
}

if (-not (Test-Path $PackagePath)) {
  Write-Host "Package not found: $PackagePath"
  exit 1
}

$ExtractDir = Join-Path $ProjectRoot "tools\nssm_pkg"
if (Test-Path $ExtractDir) { Remove-Item -Recurse -Force $ExtractDir }

# Expand-Archive requires a .zip extension, so copy if needed.
$ArchivePath = $PackagePath
if ([System.IO.Path]::GetExtension($PackagePath).ToLower() -ne ".zip") {
  $ArchivePath = Join-Path $ProjectRoot "tools\nssm.zip"
  Copy-Item -Path $PackagePath -Destination $ArchivePath -Force
}

Expand-Archive -Path $ArchivePath -DestinationPath $ExtractDir -Force

$nssmExe = Get-ChildItem -Path $ExtractDir -Recurse -Filter nssm.exe | Select-Object -First 1
if (-not $nssmExe) {
  Write-Host "nssm.exe not found in package."
  exit 1
}

$TargetPath = Join-Path $ProjectRoot "tools\nssm.exe"
Copy-Item -Path $nssmExe.FullName -Destination $TargetPath -Force
Write-Host "Copied to $TargetPath"
