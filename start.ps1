# Whisperio — run without installation
# Usage: powershell -ExecutionPolicy Bypass -File start.ps1

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  Whisperio — Global Dictation" -ForegroundColor Magenta
Write-Host ""

# Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  Node.js not found. Install from https://nodejs.org" -ForegroundColor Red
    exit 1
}

$nodeVersion = (node -v) -replace 'v', ''
$major = [int]($nodeVersion.Split('.')[0])
if ($major -lt 18) {
    Write-Host "  Node.js $nodeVersion is too old. Need 18+." -ForegroundColor Red
    exit 1
}
Write-Host "  Node.js $nodeVersion" -ForegroundColor DarkGray

# Check if we're in the right directory
if (-not (Test-Path "package.json")) {
    Write-Host "  Run this script from the whisperio directory." -ForegroundColor Red
    Write-Host "  cd whisperio && powershell -ExecutionPolicy Bypass -File start.ps1" -ForegroundColor DarkGray
    exit 1
}

# Install dependencies if needed
if (-not (Test-Path "node_modules")) {
    Write-Host "  Installing dependencies..." -ForegroundColor Yellow
    npm install --loglevel error
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  npm install failed." -ForegroundColor Red
        exit 1
    }
    Write-Host "  Dependencies installed." -ForegroundColor Green
}

# Run in dev mode
Write-Host "  Starting Whisperio..." -ForegroundColor Green
Write-Host ""
npm run dev
