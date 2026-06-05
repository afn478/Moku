param(
  [int]$Port = 3031,
  [string]$DataDir = "",
  [string]$Language = "ja"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$installPath = Join-Path $repoRoot "hoshidicts-local"
$exe = Join-Path $installPath "build\moku-hoshidicts-http.exe"

if (-not $DataDir) {
  $DataDir = Join-Path $installPath "dictionaries"
}

if (-not (Test-Path $exe)) {
  throw "hoshidicts adapter is not built yet. Run: pnpm setup:hoshidicts:windows"
}

New-Item -ItemType Directory -Force -Path (Join-Path $DataDir "Term") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataDir "Frequency") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataDir "Pitch") | Out-Null

& $exe --port $Port --data-dir $DataDir --language $Language
