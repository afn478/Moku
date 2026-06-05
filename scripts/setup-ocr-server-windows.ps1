$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$sourceRepo = "https://github.com/1Selxo/Mangatan.git"
$sourceCommit = "c0dd60363f0b5fbf562d0608d1339fc109cc73cd"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$bundlePath = Join-Path $repoRoot "ocr-server-local"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "moku-mangatan-ocr"
$clonePath = Join-Path $tempRoot "Mangatan"

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

function Assert-InTempRoot([string] $path) {
  $fullPath = Get-FullPath $path
  $fullTempRoot = Get-FullPath $tempRoot
  if (-not $fullPath.StartsWith($fullTempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to touch path outside temp staging root: $fullPath"
  }
  return $fullPath
}

function Require-Command([string] $name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Required command '$name' was not found in PATH."
  }
}

function Patch-OcrServer([string] $serverPath) {
  $serverText = Get-Content -LiteralPath $serverPath -Raw -Encoding UTF8

  $serverText = $serverText.Replace(
    'IP_ADDRESS = "0.0.0.0"',
    'IP_ADDRESS = os.environ.get("MANGATAN_OCR_IP", "127.0.0.1")'
  )
  $serverText = $serverText.Replace(
    'PORT = 3000',
    'PORT = int(os.environ.get("MANGATAN_OCR_PORT", "3000"))'
  )
  $serverText = $serverText.Replace(
    'app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER',
    @'
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

@app.after_request
def add_moku_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response
'@
  )
  $serverText = $serverText.Replace(
    'SERVER_URL_BASE = "http://127.0.0.1:3000"',
    'SERVER_URL_BASE = f"http://127.0.0.1:{PORT}"'
  )

  Set-Content -LiteralPath $serverPath -Value $serverText -Encoding UTF8
}

Require-Command "git"
Require-Command "uv"

New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

if (Test-Path -LiteralPath $clonePath) {
  $safeClonePath = Assert-InTempRoot $clonePath
  Remove-Item -LiteralPath $safeClonePath -Recurse -Force
}

Write-Host "Cloning Mangatan OCR server source..."
git clone --quiet --filter=blob:none $sourceRepo $clonePath
git -C $clonePath checkout --quiet $sourceCommit

$sourceServerPath = Join-Path $clonePath "ocr-server"
if (-not (Test-Path -LiteralPath (Join-Path $sourceServerPath "server.py"))) {
  throw "Could not find Mangatan ocr-server/server.py at $sourceServerPath."
}

$safeBundlePath = Assert-InRepo $bundlePath
if (Test-Path -LiteralPath $safeBundlePath) {
  Remove-Item -LiteralPath $safeBundlePath -Recurse -Force
}

Copy-Item -LiteralPath $sourceServerPath -Destination $safeBundlePath -Recurse -Force
Patch-OcrServer (Join-Path $safeBundlePath "server.py")

Push-Location $safeBundlePath
try {
  Write-Host "Installing OCR server Python dependencies with uv..."
  uv sync --frozen --no-dev
}
finally {
  Pop-Location
}

Write-Host "OCR server ready:"
Write-Host "  $safeBundlePath"
Write-Host "Run it with:"
Write-Host "  corepack pnpm ocr:dev"
