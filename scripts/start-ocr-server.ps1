param(
  [ValidateSet("lens", "oneocr")]
  [string] $Engine = "lens",

  [string] $Ip = "127.0.0.1",

  [ValidateRange(1, 65535)]
  [int] $Port = 3000,

  [switch] $Debug
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$serverPath = Join-Path $repoRoot "ocr-server-local"
$entryPath = Join-Path $serverPath "server.py"

if (-not (Test-Path -LiteralPath $entryPath)) {
  throw "OCR server is not set up yet. Run: corepack pnpm setup:ocr:windows"
}

if (-not (Get-Command "uv" -ErrorAction SilentlyContinue)) {
  throw "Required command 'uv' was not found in PATH."
}

$env:MANGATAN_OCR_IP = $Ip
$env:MANGATAN_OCR_PORT = [string] $Port

$uvArgs = @("run", "server.py", "--engine", $Engine)
if ($Debug) {
  $uvArgs += "--debug"
}

Write-Host "Starting Moku OCR server with $Engine at http://$Ip`:$Port"
Push-Location $serverPath
try {
  & uv @uvArgs
}
finally {
  Pop-Location
}
