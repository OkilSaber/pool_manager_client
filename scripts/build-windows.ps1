# Build Windows sur une machine Windows : installeurs .exe (NSIS) et .msi dans dist\.
# Prérequis : Rust (rustup, toolchain MSVC), Node.js >= 20, « Build Tools for Visual Studio »
# (Développement Desktop en C++) et WebView2 (déjà présent sur Windows 10/11).
# Usage : powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$version = node -p "require('./package.json').version"
New-Item -ItemType Directory -Force -Path dist | Out-Null

npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm ci a échoué' }
npm run tauri build -- --bundles nsis,msi
if ($LASTEXITCODE -ne 0) { throw 'tauri build a échoué' }

$targetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { 'src-tauri\target' }
Copy-Item "$targetDir\release\bundle\nsis\*.exe", "$targetDir\release\bundle\msi\*.msi" dist\
Get-ChildItem dist -Include "*$version*.exe", "*$version*.msi" -Recurse |
  Get-FileHash -Algorithm SHA256 |
  ForEach-Object { "$($_.Hash.ToLower())  $(Split-Path $_.Path -Leaf)" } |
  Set-Content "dist\SHA256SUMS-windows-$version"
Get-ChildItem dist
