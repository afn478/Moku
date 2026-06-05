$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$version = "v2.2.2100"
$assetName = "Suwayomi-Server-v2.2.2100-windows-x64.zip"
$expectedZipSha256 = "66D88286C8DECDB5F58929DAF8243363AB23A07DD30FD91FD012411F9260E5A4"
$downloadUrl = "https://github.com/Suwayomi/Suwayomi-Server/releases/download/$version/$assetName"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$zipPath = Join-Path $repoRoot "suwayomi-windows.zip"
$stagePath = Join-Path $repoRoot "suwayomi-raw"
$bundlePath = Join-Path $repoRoot "src-tauri\binaries\suwayomi-bundle"

function Get-FullPath([string] $path) {
  return [System.IO.Path]::GetFullPath($path)
}

function Assert-InRepo([string] $path) {
  $fullPath = Get-FullPath $path
  if (-not $fullPath.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to touch path outside repository: $fullPath"
  }
  return $fullPath
}

function Test-Hash([string] $path, [string] $expectedHash) {
  if (-not (Test-Path -LiteralPath $path)) {
    return $false
  }

  $actualHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToUpperInvariant()
  return $actualHash -eq $expectedHash.ToUpperInvariant()
}

Assert-InRepo $zipPath | Out-Null
Assert-InRepo $stagePath | Out-Null
Assert-InRepo $bundlePath | Out-Null

if (-not (Test-Hash $zipPath $expectedZipSha256)) {
  Write-Host "Downloading $assetName..."
  Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath
}

if (-not (Test-Hash $zipPath $expectedZipSha256)) {
  $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
  throw "Downloaded zip hash mismatch. Expected $expectedZipSha256, got $actualHash."
}

foreach ($path in @($stagePath, $bundlePath)) {
  $safePath = Assert-InRepo $path
  if (Test-Path -LiteralPath $safePath) {
    Remove-Item -LiteralPath $safePath -Recurse -Force
  }
}

New-Item -ItemType Directory -Path $stagePath -Force | Out-Null
Expand-Archive -LiteralPath $zipPath -DestinationPath $stagePath -Force

$extractedRoot = Join-Path $stagePath "Suwayomi-Server-v2.2.2100-windows-x64"
$jarSource = Join-Path $extractedRoot "bin\Suwayomi-Server.jar"
$jreSource = Join-Path $extractedRoot "jre"

if (-not (Test-Path -LiteralPath $jarSource)) {
  throw "Could not find Suwayomi server jar at $jarSource."
}

if (-not (Test-Path -LiteralPath (Join-Path $jreSource "bin\java.exe"))) {
  throw "Could not find bundled Java runtime at $jreSource."
}

New-Item -ItemType Directory -Path (Join-Path $bundlePath "bin") -Force | Out-Null
Copy-Item -LiteralPath $jarSource -Destination (Join-Path $bundlePath "bin\Suwayomi-Server.jar") -Force
Copy-Item -LiteralPath $jreSource -Destination $bundlePath -Recurse -Force

$javaPath = Join-Path $bundlePath "jre\bin\java.exe"
$jarPath = Join-Path $bundlePath "bin\Suwayomi-Server.jar"

Write-Host "Suwayomi bundle ready:"
Write-Host "  $jarPath"
Write-Host "  $javaPath"
