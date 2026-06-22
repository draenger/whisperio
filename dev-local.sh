#!/usr/bin/env bash
# Whisperio dev — Electron app via electron-vite.
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "[dev-local] node not on PATH." >&2
  exit 1
fi

echo "[dev-local] installing deps (if needed)..."
npm install --silent

echo "[dev-local] launching electron-vite dev..."
npm run dev
