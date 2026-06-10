# Whisperio — one-click launcher (Windows)
#
# Run-and-done: just execute this file and the app starts. It does EVERYTHING:
#   * works around PowerShell's execution policy (re-launches itself bypassed)
#   * finds a usable Node.js, or downloads a portable copy into ./.node
#   * installs dependencies on first run
#   * launches the app — no build step, no migrations, no global installs
#
# Nothing is written outside this folder. Delete the folder and it's gone.
#
# Easiest ways to run:
#   - Right-click run.ps1  ->  "Run with PowerShell"
#   - or in a terminal:  powershell -ExecutionPolicy Bypass -File run.ps1

# --- 0. Self-relaunch with a bypassed execution policy if we're blocked. ------
# This lets a plain double-click / "Run with PowerShell" work even when the
# machine's policy would otherwise refuse to run unsigned scripts.
if ((Get-ExecutionPolicy) -in @('Restricted', 'AllSigned', 'Undefined') -and
    -not $env:WHISPERIO_RELAUNCHED) {
    $env:WHISPERIO_RELAUNCHED = '1'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath @args
    exit $LASTEXITCODE
}

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Portable Node version used when no suitable system Node is found.
$NodeVersion = "v22.11.0"
$MinMajor    = 18

# Always operate from the script's own directory.
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host ""
Write-Host "  Whisperio - Global Dictation" -ForegroundColor Magenta
Write-Host ""

if (-not (Test-Path "package.json")) {
    Write-Host "  package.json not found next to run.ps1 - is the repo complete?" -ForegroundColor Red
    Read-Host "  Press Enter to close"
    exit 1
}

function Test-NodeOk($exe) {
    if (-not $exe) { return $false }
    try {
        $v = (& $exe -v) -replace 'v', ''
        return ([int]($v.Split('.')[0]) -ge $MinMajor)
    } catch { return $false }
}

# --- 1. Prefer a usable system Node, otherwise fall back to a portable one. ---
$systemNode = (Get-Command node -ErrorAction SilentlyContinue).Source
if (Test-NodeOk $systemNode) {
    Write-Host "  Using system Node.js $((& node -v))" -ForegroundColor DarkGray
} else {
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { $arch = "arm64" } else { $arch = "x64" }
    $nodeName = "node-$NodeVersion-win-$arch"
    $nodeDir  = Join-Path $Root ".node\$nodeName"
    $nodeExe  = Join-Path $nodeDir "node.exe"

    if (-not (Test-Path $nodeExe)) {
        $url = "https://nodejs.org/dist/$NodeVersion/$nodeName.zip"
        $zip = Join-Path $Root ".node\$nodeName.zip"
        Write-Host "  No suitable Node.js found - downloading portable $NodeVersion ($arch)..." -ForegroundColor Yellow
        New-Item -ItemType Directory -Force (Join-Path $Root ".node") | Out-Null
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
        Write-Host "  Extracting..." -ForegroundColor Yellow
        Expand-Archive -Path $zip -DestinationPath (Join-Path $Root ".node") -Force
        Remove-Item $zip -Force
    }

    # Put the portable Node first on PATH for this session only.
    $env:Path = "$nodeDir;$env:Path"
    Write-Host "  Using portable Node.js $((& $nodeExe -v))" -ForegroundColor DarkGray
}

# --- 2. Install dependencies if missing. --------------------------------------
if (-not (Test-Path "node_modules")) {
    Write-Host "  Installing dependencies (first run, this can take a few minutes)..." -ForegroundColor Yellow
    npm install --loglevel error
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  npm install failed." -ForegroundColor Red
        Read-Host "  Press Enter to close"
        exit 1
    }
    Write-Host "  Dependencies installed." -ForegroundColor Green
}

# --- 3. Launch. ---------------------------------------------------------------
Write-Host "  Starting Whisperio..." -ForegroundColor Green
Write-Host ""
npm run dev
