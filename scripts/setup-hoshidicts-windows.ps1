param(
  [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $InstallDir) {
  $InstallDir = Join-Path $repoRoot "hoshidicts-local"
}

$installPath = [System.IO.Path]::GetFullPath($InstallDir)
$srcPath = Join-Path $installPath "src"
$buildPath = Join-Path $installPath "build"
$serverSource = Join-Path $repoRoot "scripts\hoshidicts-http-server.cpp"
$localServerSource = Join-Path $installPath "moku-hoshidicts-http.cpp"
$wrapperCmake = Join-Path $installPath "CMakeLists.txt"
$commit = "be5cdd4b1b6cba28858919fe28a00396d285a865"

function Assert-NativeSuccess([string]$Message) {
  if ($LASTEXITCODE -ne 0) { throw $Message }
}

New-Item -ItemType Directory -Force -Path $installPath | Out-Null

if (-not (Test-Path (Join-Path $srcPath ".git"))) {
  git clone --recurse-submodules https://github.com/1Selxo/hoshidicts.git $srcPath
  Assert-NativeSuccess "Failed to clone hoshidicts"
} else {
  git -C $srcPath fetch --all --tags
  Assert-NativeSuccess "Failed to fetch hoshidicts"
  git -C $srcPath submodule update --init --recursive
  Assert-NativeSuccess "Failed to update hoshidicts submodules"
}

git -C $srcPath checkout $commit
Assert-NativeSuccess "Failed to checkout hoshidicts commit $commit"
git -C $srcPath submodule update --init --recursive
Assert-NativeSuccess "Failed to update hoshidicts submodules"

Copy-Item -Force $serverSource $localServerSource

@"
cmake_minimum_required(VERSION 3.22.1)
project(moku_hoshidicts_http LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_subdirectory(src hoshidicts-build)

add_executable(moku-hoshidicts-http
  moku-hoshidicts-http.cpp
)

target_compile_features(moku-hoshidicts-http PRIVATE cxx_std_23)
target_link_libraries(moku-hoshidicts-http PRIVATE hoshidicts)

if(WIN32)
  target_link_libraries(moku-hoshidicts-http PRIVATE ws2_32)
endif()
"@ | Set-Content -Path $wrapperCmake -Encoding UTF8

$dictRoot = Join-Path $installPath "dictionaries"
New-Item -ItemType Directory -Force -Path (Join-Path $dictRoot "Term") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $dictRoot "Frequency") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $dictRoot "Pitch") | Out-Null

$compilerArgs = @()
if (Get-Command g++ -ErrorAction SilentlyContinue) {
  $compilerArgs = @("-DCMAKE_CXX_COMPILER=g++")
}

cmake -S $installPath -B $buildPath -G Ninja @compilerArgs
if ($LASTEXITCODE -ne 0) { throw "CMake configure failed" }
cmake --build $buildPath --target moku-hoshidicts-http
if ($LASTEXITCODE -ne 0) { throw "hoshidicts adapter build failed" }

Write-Host ""
Write-Host "hoshidicts adapter built."
Write-Host "Dictionary folders:"
Write-Host "  Term:      $(Join-Path $dictRoot "Term")"
Write-Host "  Frequency: $(Join-Path $dictRoot "Frequency")"
Write-Host "  Pitch:     $(Join-Path $dictRoot "Pitch")"
Write-Host ""
Write-Host "Start it with:"
Write-Host "  pnpm dict:dev"
Write-Host ""
Write-Host "Import a Yomitan zip by POSTing to http://127.0.0.1:3031/import with JSON:"
Write-Host '  {"zipPath":"C:\\path\\JMdict.zip","type":"term"}'
