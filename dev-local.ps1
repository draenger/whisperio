# Whisperio dev
$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "[dev-local] node not on PATH."
    exit 1
}

Write-Host "[dev-local] installing deps (if needed)..."
npm install --silent

Write-Host "[dev-local] launching electron-vite dev..."
npm run dev
